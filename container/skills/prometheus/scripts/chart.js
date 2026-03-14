#!/usr/bin/env node
/**
 * chart.js — Prometheus 监控图表 IPC 写入脚本
 *
 * 用法：
 *   node chart.js --metric cpu --instances "10.0.0.1,10.0.0.2" [--range 1h] [--datasource portal] --chat-jid "$NANOCLAW_CHAT_JID"
 *
 * 写入 /workspace/ipc/messages/chart-{ts}.json，主进程 IPC watcher 读取后渲染为前端折线图卡片。
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { rangeQuery } from './query.js';

// ── 指标定义 ──────────────────────────────────────────────────────────────────

const METRICS = {
  cpu: {
    title: 'CPU 使用率',
    unit: '%',
    promql: (instance) =>
      `100 - (avg by (instance) (irate(node_cpu_seconds_total{instance="${instance}:9100",mode="idle"}[5m])) * 100)`,
  },
  memory: {
    title: '内存使用率',
    unit: '%',
    promql: (instance) =>
      `(node_memory_MemTotal_bytes{instance="${instance}:9100"} - node_memory_MemAvailable_bytes{instance="${instance}:9100"}) / node_memory_MemTotal_bytes{instance="${instance}:9100"} * 100`,
  },
  disk: {
    title: '磁盘使用率',
    unit: '%',
    promql: (instance) =>
      `100 - (node_filesystem_avail_bytes{instance="${instance}:9100",mountpoint="/"} / node_filesystem_size_bytes{instance="${instance}:9100",mountpoint="/"} * 100)`,
  },
  load: {
    title: '系统负载 (1m)',
    unit: '',
    promql: (instance) => `node_load1{instance="${instance}:9100"}`,
  },
  network_rx: {
    title: '网络接收',
    unit: 'B/s',
    promql: (instance) =>
      `rate(node_network_receive_bytes_total{instance="${instance}:9100",device!="lo"}[5m])`,
  },
  network_tx: {
    title: '网络发送',
    unit: 'B/s',
    promql: (instance) =>
      `rate(node_network_transmit_bytes_total{instance="${instance}:9100",device!="lo"}[5m])`,
  },
};

// ── 网段 → datasource 自动检测 ────────────────────────────────────────────────

const PAAS_RANGES = [
  [0x0aff1700, 0x0aff17ff], // 10.255.23.x
  [0x0aff1e00, 0x0aff1eff], // 10.255.30.x
  [0x0aff4300, 0x0aff43ff], // 10.255.67.x
  [0x0aff8000, 0x0aff80ff], // 10.255.128.x
  [0x0aff8300, 0x0aff83ff], // 10.255.131.x
  [0x0a467600, 0x0a4676ff], // 10.70.118.x
  [0x0a397600, 0x0a3976ff], // 10.57.118.x
  [0x0a447b00, 0x0a447bff], // 10.68.123.x
  [0x0a257c00, 0x0a257cff], // 10.37.131.x
  [0x0a278000, 0x0a2780ff], // 10.39.128.x
  [0x0afd1700, 0x0afd17ff], // 10.253.23.x
  [0x0a047a00, 0x0a047aff], // 10.4.122.x
];

function ipToInt(ip) {
  return ip.split('.').reduce((acc, oct) => (acc << 8) + parseInt(oct, 10), 0) >>> 0;
}

function detectDatasource(ip) {
  const n = ipToInt(ip);
  for (const [lo, hi] of PAAS_RANGES) {
    if (n >= lo && n <= hi) return 'paas';
  }
  return 'portal';
}

// ── CLI 参数解析 ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      args[argv[i].slice(2)] = argv[i + 1] ?? true;
      i++;
    }
  }
  return args;
}

// ── 时间范围解析 ──────────────────────────────────────────────────────────────

function parseRange(range) {
  const match = range.match(/^(\d+)(m|h|d)$/);
  if (!match) throw new Error(`Invalid range: "${range}". Use e.g. 15m, 1h, 6h, 24h`);
  const [, n, unit] = match;
  const multipliers = { m: 60, h: 3600, d: 86400 };
  return parseInt(n, 10) * multipliers[unit];
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const metric = args['metric'];
  const instancesRaw = args['instances'];
  const range = args['range'] || '1h';
  const chatJid = args['chat-jid'] || process.env.NANOCLAW_CHAT_JID;
  const forceDatasource = args['datasource'] || null;

  // Validate required args
  if (!metric) { console.error('Error: --metric is required'); process.exit(1); }
  if (!instancesRaw) { console.error('Error: --instances is required'); process.exit(1); }
  if (!chatJid) { console.error('Error: --chat-jid or $NANOCLAW_CHAT_JID is required'); process.exit(1); }

  const metricDef = METRICS[metric];
  if (!metricDef) {
    console.error(`Error: Unknown metric "${metric}". Available: ${Object.keys(METRICS).join(', ')}`);
    process.exit(1);
  }

  const instances = instancesRaw.split(',').map((s) => s.trim()).filter(Boolean);
  const rangeSeconds = parseRange(range);
  const now = Math.floor(Date.now() / 1000);
  const start = String(now - rangeSeconds);
  const end = String(now);

  // Query each instance separately so we can show multi-node lines
  const seriesResults = await Promise.all(
    instances.map(async (ip) => {
      const datasource = forceDatasource || detectDatasource(ip);
      const promql = metricDef.promql(ip);
      try {
        const result = await rangeQuery(promql, start, end, { instance: datasource, step: 60 });
        // result.result is an array of { metric: {...}, values: [[ts, val], ...] }
        const vectors = result.result ?? [];
        // Sum all matching series for this IP (e.g. per-CPU rolled up)
        const merged = new Map();
        for (const vec of vectors) {
          for (const [ts, val] of vec.values) {
            const v = parseFloat(val);
            if (!isNaN(v)) {
              merged.set(ts, (merged.get(ts) ?? 0) + v);
            }
          }
        }
        // Average if multiple series (e.g. multi-CPU)
        const count = vectors.length || 1;
        const data = [...merged.entries()].map(([ts, sum]) => [ts, sum / count]);
        data.sort((a, b) => a[0] - b[0]);
        return { instance: ip, data };
      } catch (err) {
        console.error(`Warning: Failed to query ${ip}: ${err.message}`);
        return { instance: ip, data: [] };
      }
    }),
  );

  // Determine displayed datasource label
  const detectedSources = instances.map((ip) => forceDatasource || detectDatasource(ip));
  const uniqueSources = [...new Set(detectedSources)];
  const displayDatasource = uniqueSources.length === 1 ? uniqueSources[0] : 'mixed';

  const chartBlock = {
    type: 'prometheus_chart',
    title: metricDef.title,
    unit: metricDef.unit,
    timeRange: range,
    datasource: displayDatasource,
    series: seriesResults,
  };

  const ipcMessagesDir = join(process.env.IPC_DIR || '/workspace/ipc', 'messages');
  mkdirSync(ipcMessagesDir, { recursive: true });

  const filename = `chart-${Date.now()}.json`;
  const ipcPayload = {
    type: 'chart_message',
    chatJid,
    chart: chartBlock,
  };

  writeFileSync(join(ipcMessagesDir, filename), JSON.stringify(ipcPayload));
  console.log(`Chart written: ${filename} (${seriesResults.length} series)`);
}

main().catch((err) => {
  console.error('chart.js error:', err.message);
  process.exit(1);
});
