# Prometheus 监控卡片 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 当 Agent 调用 prometheus skill 的 `chart.js` 脚本时，前端聊天界面自动以 Grafana 风格折线图卡片展示监控数据，取代原来的纯文本 JSON 输出。

**Architecture:** 新增 `chart_message` IPC 消息类型——Agent 在容器内调用 `chart.js` 写入 `/workspace/ipc/messages/`，主进程 IPC watcher 读取并调用 `sendMessage()` 存入 DB，前端 `MessageList` 识别 `prometheus_chart` content block 渲染 `PrometheusChartCard` 组件。

**Tech Stack:** Node.js ESM (chart.js), TypeScript (ipc.ts), React 19 + Recharts + Tailwind (前端)

**Spec:** `docs/superpowers/specs/2026-03-13-prometheus-monitoring-cards-design.md`

---

## File Map

| 文件 | 动作 | 说明 |
|------|------|------|
| `src/ipc.ts` | 修改 | 在 messages 循环中新增 `chart_message` 处理，提取 `processChartMessageIpc` 以便单测 |
| `src/ipc-chart-message.test.ts` | 新增 | `processChartMessageIpc` 单测 |
| `container/skills/prometheus/scripts/chart.js` | 新增 | Agent 调用入口：查询 range 数据 → 写 IPC 文件 |
| `container/skills/prometheus/SKILL.md` | 修改 | 补充 chart.js 用法文档 |
| `frontend/package.json` | 修改 | 新增 `recharts` 依赖 |
| `frontend/src/lib/types.ts` | 修改 | `ContentBlock` 扩展为判别联合，新增 `PrometheusChartBlock` |
| `frontend/src/components/PrometheusChartCard.tsx` | 新增 | Grafana 风格折线图卡片组件 |
| `frontend/src/components/Chat/MessageList.tsx` | 修改 | `hasVisibleContent` 和渲染逻辑加 `prometheus_chart` 分支 |

---

## Chunk 1: 后端 — IPC 处理 + chart.js 脚本

### Task 1: 在 `src/ipc.ts` 新增 `chart_message` 处理

**Files:**
- Modify: `src/ipc.ts:75-93`（messages 循环内）
- Create: `src/ipc-chart-message.test.ts`

- [ ] **Step 1: 写失败测试**

在 `src/ipc-chart-message.test.ts` 中：

```typescript
import { describe, it, expect, vi } from 'vitest';
import { processChartMessageIpc } from './ipc.js';
import type { IpcDeps } from './ipc.js';
import { RegisteredGroup } from './types.js';

const MAIN_GROUP: RegisteredGroup = {
  name: 'Main', folder: 'main', trigger: 'always',
  added_at: '2024-01-01T00:00:00.000Z',
};
const OTHER_GROUP: RegisteredGroup = {
  name: 'Other', folder: 'other-group', trigger: '@Bot',
  added_at: '2024-01-01T00:00:00.000Z',
};

const CHART_BLOCK = {
  type: 'prometheus_chart',
  title: 'CPU 使用率',
  unit: '%',
  timeRange: '1h',
  datasource: 'portal',
  series: [{ instance: '10.0.0.1', data: [[1710000000, 67.3]] }],
};

function makeDeps(groups: Record<string, RegisteredGroup>): IpcDeps & { sent: string[] } {
  const sent: string[] = [];
  return {
    sent,
    sendMessage: vi.fn(async (_jid: string, text: string) => { sent.push(text); }),
    registeredGroups: () => groups,
    registerGroup: vi.fn(),
    syncGroupMetadata: vi.fn(),
    getAvailableGroups: vi.fn(() => []),
    writeGroupsSnapshot: vi.fn(),
  };
}

describe('processChartMessageIpc', () => {
  it('sends chart message when authorized (main group)', async () => {
    const deps = makeDeps({ 'other@g.us': OTHER_GROUP });
    await processChartMessageIpc(
      { type: 'chart_message', chatJid: 'other@g.us', chart: CHART_BLOCK },
      'main', true, deps,
    );
    expect(deps.sendMessage).toHaveBeenCalledOnce();
    const sent = JSON.parse((deps.sendMessage as any).mock.calls[0][1]);
    expect(sent).toEqual([CHART_BLOCK]);
  });

  it('sends chart message when group owns the chatJid', async () => {
    const deps = makeDeps({ 'other@g.us': OTHER_GROUP });
    await processChartMessageIpc(
      { type: 'chart_message', chatJid: 'other@g.us', chart: CHART_BLOCK },
      'other-group', false, deps,
    );
    expect(deps.sendMessage).toHaveBeenCalledOnce();
  });

  it('blocks unauthorized cross-group chart message', async () => {
    const deps = makeDeps({ 'other@g.us': OTHER_GROUP });
    await processChartMessageIpc(
      { type: 'chart_message', chatJid: 'other@g.us', chart: CHART_BLOCK },
      'evil-group', false, deps,
    );
    expect(deps.sendMessage).not.toHaveBeenCalled();
  });

  it('does nothing when chart field is missing', async () => {
    const deps = makeDeps({ 'other@g.us': OTHER_GROUP });
    await processChartMessageIpc(
      { type: 'chart_message', chatJid: 'other@g.us', chart: undefined as any },
      'main', true, deps,
    );
    expect(deps.sendMessage).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd /root/project/CNP_Bot
npm test -- src/ipc-chart-message.test.ts
```

预期：`processChartMessageIpc` not exported，FAIL。

- [ ] **Step 3: 在 `src/ipc.ts` 实现 `processChartMessageIpc` 并在消息循环中调用**

在 `src/ipc.ts` 的 `processTaskIpc` 函数定义之后（文件末尾）添加：

```typescript
export async function processChartMessageIpc(
  data: {
    type: string;
    chatJid?: string;
    chart?: unknown;
  },
  sourceGroup: string,
  isMain: boolean,
  deps: IpcDeps,
): Promise<void> {
  if (!data.chatJid || !data.chart) return;

  const registeredGroups = deps.registeredGroups();
  const targetGroup = registeredGroups[data.chatJid];

  if (isMain || (targetGroup && targetGroup.folder === sourceGroup)) {
    await deps.sendMessage(data.chatJid, JSON.stringify([data.chart]));
    logger.info({ chatJid: data.chatJid, sourceGroup }, 'IPC chart message sent');
  } else {
    logger.warn(
      { chatJid: data.chatJid, sourceGroup },
      'Unauthorized chart_message attempt blocked',
    );
  }
}
```

在 `processIpcFiles` 的 messages 循环（`src/ipc.ts` 约 75 行），在现有 `message` 类型判断块之后、`fs.unlinkSync` 之前，新增：

```typescript
              if (data.type === 'chart_message') {
                await processChartMessageIpc(data, sourceGroup, isMain, deps);
              }
```

完整上下文位置（原有代码 + 新增部分）：

```typescript
              const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
              if (data.type === 'message' && data.chatJid && data.text) {
                // ... 现有代码不变 ...
              }
              if (data.type === 'chart_message') {
                await processChartMessageIpc(data, sourceGroup, isMain, deps);
              }
              fs.unlinkSync(filePath);
```

- [ ] **Step 4: 运行测试确认��过**

```bash
cd /root/project/CNP_Bot
npm test -- src/ipc-chart-message.test.ts
```

预期：4 tests PASS。

- [ ] **Step 5: 运行全量测试确认无回归**

```bash
cd /root/project/CNP_Bot
npm test
```

预期：所有测试 PASS。

- [ ] **Step 6: Commit**

```bash
cd /root/project/CNP_Bot
git add src/ipc.ts src/ipc-chart-message.test.ts
git commit -m "feat(ipc): add chart_message type for prometheus chart cards"
```

---

### Task 2: 创建 `container/skills/prometheus/scripts/chart.js`

**Files:**
- Create: `container/skills/prometheus/scripts/chart.js`

此脚本由 Agent 在容器内调用，查询 Prometheus range 数据并写入 IPC 文件。

- [ ] **Step 1: 创建脚本**

创建 `container/skills/prometheus/scripts/chart.js`：

```javascript
#!/usr/bin/env node
/**
 * chart.js — Prometheus 监控图表 IPC 写入脚本
 *
 * 用法：
 *   node chart.js --metric cpu --instances "10.0.0.1,10.0.0.2" [--range 1h] [--datasource portal] --chat-jid "$CNP_BOT_CHAT_JID"
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

// ── メイン ────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const metric = args['metric'];
  const instancesRaw = args['instances'];
  const range = args['range'] || '1h';
  const chatJid = args['chat-jid'] || process.env.CNP_BOT_CHAT_JID;
  const forceDatasource = args['datasource'] || null;

  // Validate required args
  if (!metric) { console.error('Error: --metric is required'); process.exit(1); }
  if (!instancesRaw) { console.error('Error: --instances is required'); process.exit(1); }
  if (!chatJid) { console.error('Error: --chat-jid or $CNP_BOT_CHAT_JID is required'); process.exit(1); }

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

  const chartBlock = {
    type: 'prometheus_chart',
    title: metricDef.title,
    unit: metricDef.unit,
    timeRange: range,
    datasource: forceDatasource || detectDatasource(instances[0]),
    series: seriesResults,
  };

  const ipcMessagesDir = '/workspace/ipc/messages';
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
```

- [ ] **Step 2: 手动验证脚本语法正确（在主机上用 node --check）**

```bash
node --check /root/project/CNP_Bot/container/skills/prometheus/scripts/chart.js
```

预期：无输出（语法正常）。

- [ ] **Step 3: Commit**

```bash
cd /root/project/CNP_Bot
git add container/skills/prometheus/scripts/chart.js
git commit -m "feat(prometheus): add chart.js script for time-series chart IPC messages"
```

---

### Task 3: 更新 `container/skills/prometheus/SKILL.md`

**Files:**
- Modify: `container/skills/prometheus/SKILL.md`（末尾追加章节）

- [ ] **Step 1: 在 SKILL.md 末尾追加 chart.js 文档**

在 `## Notes` 章节之后，用以下内容追加到���件末尾（原样粘贴，注意内部代码块用 `~~~bash` 围栏）：

~~~markdown
## 监控图表（折线图卡片）

使用 `chart.js` 将 Prometheus 时序数据渲染为前端 Grafana 风格折线图卡片。

### 用法

~~~bash
cd ~/.openclaw/workspace/skills/prometheus
node scripts/chart.js \
  --metric cpu \
  --instances "10.246.10.85,10.246.10.86" \
  [--range 1h] \
  [--datasource portal] \
  --chat-jid "$CNP_BOT_CHAT_JID"
~~~

> `$CNP_BOT_CHAT_JID` 由运行时自动注入，可直接引用。

### 支持的 --metric 值

| 值 | 图表标题 | 单位 |
|----|----------|------|
| `cpu` | CPU 使用率 | % |
| `memory` | 内存使用率 | % |
| `disk` | 磁盘使用率 | % |
| `load` | 系统负载 (1m) | — |
| `network_rx` | 网络接收 | B/s |
| `network_tx` | 网络发送 | B/s |

### 参数

| 参数 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `--metric` | ✓ | — | 指标名称 |
| `--instances` | ✓ | — | 逗号分隔节点 IP，多节点显示多条折线 |
| `--range` | — | `1h` | 时间范围：`15m` / `1h` / `6h` / `24h` |
| `--datasource` | — | 自动检测 | 强制指定 `portal` 或 `paas` |
| `--chat-jid` | ✓ | `$CNP_BOT_CHAT_JID` | 目标会话 JID |
~~~

- [ ] **Step 2: Commit**

```bash
cd /root/project/CNP_Bot
git add container/skills/prometheus/SKILL.md
git commit -m "docs(prometheus): document chart.js grafana panel usage"
```

---

## Chunk 2: 前端 — 类型、组件、消息渲染

### Task 4: 安装 recharts + 更新 `frontend/src/lib/types.ts`

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/src/lib/types.ts`

- [ ] **Step 1: 安装 recharts**

```bash
cd /root/project/CNP_Bot/frontend
npm install recharts
```

预期：`package.json` 的 `dependencies` 中出现 `"recharts": "^2.x.x"`。

- [ ] **Step 2: 更新 `frontend/src/lib/types.ts`**

将现有 `ContentBlock` interface 替换为��别联合类型，并新增 `PrometheusChartBlock`：

```typescript
export interface Chat {
  jid: string;
  name: string;
  last_message_time: string;
  last_message: string;
  last_user_message: string;
  is_group: number;
}

export interface Message {
  id: string;
  chat_jid: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_from_me: boolean;
  is_bot_message: boolean;
}

export interface PrometheusChartBlock {
  type: 'prometheus_chart';
  title: string;
  unit: string;
  timeRange: string;
  datasource?: string;
  series: Array<{
    instance: string;
    data: Array<[number, number]>;
  }>;
}

export type ContentBlock =
  | { type: 'text'; text?: string; [key: string]: unknown }
  | {
      type: 'tool_use';
      id?: string;
      name?: string;
      input?: unknown;
      partial_json?: string;
      status?: 'calling' | 'executed' | 'error';
      result?: string | object;
      [key: string]: unknown;
    }
  | { type: 'thinking' | 'redacted_thinking'; text?: string; [key: string]: unknown }
  | PrometheusChartBlock;

export interface SlashCommand {
  command: string;
  description: string;
  allowedTools?: string[];
  source: 'sdk' | 'custom';
}
```

- [ ] **Step 3: 确认 TypeScript 编译无错误**

```bash
cd /root/project/CNP_Bot/frontend
npx tsc --noEmit
```

预期：无 TypeScript 错误（或仅有与本次改动无关的已有错误）。

- [ ] **Step 4: Commit**

```bash
cd /root/project/CNP_Bot
git add frontend/package.json frontend/package-lock.json frontend/src/lib/types.ts
git commit -m "feat(frontend): add recharts dependency and PrometheusChartBlock type"
```

---

### Task 5: 创建 `frontend/src/components/PrometheusChartCard.tsx`

**Files:**
- Create: `frontend/src/components/PrometheusChartCard.tsx`

- [ ] **Step 1: 创建组件**

```typescript
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { useTheme } from '@/contexts/ThemeContext';
import type { PrometheusChartBlock } from '@/lib/types';

// ── 配色 ──────────────────────────────────────────────────────────────────────

const DARK_COLORS = ['#f6c90e', '#73bf69', '#f44747', '#60a5fa', '#a78bfa'];
const LIGHT_COLORS = ['#d97706', '#16a34a', '#dc2626', '#2563eb', '#7c3aed'];

// ── 时间格式化 ─────────────────────────────────────────────────────────────────

function formatTime(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

function CustomTooltip({
  active,
  payload,
  label,
  unit,
  isDark,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: number;
  unit: string;
  isDark: boolean;
}) {
  if (!active || !payload?.length) return null;
  const bg = isDark ? '#1f2937' : '#ffffff';
  const border = isDark ? '#374151' : '#e5e7eb';
  const text = isDark ? '#e2e8f0' : '#111827';
  const sub = isDark ? '#9ca3af' : '#6b7280';

  return (
    <div
      style={{
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 6,
        padding: '8px 12px',
        fontSize: 11,
        color: text,
      }}
    >
      <div style={{ color: sub, marginBottom: 4 }}>{formatTime(label ?? 0)}</div>
      {payload.map((p) => (
        <div key={p.name} style={{ color: p.color }}>
          {p.name}: <strong>{p.value.toFixed(1)}{unit}</strong>
        </div>
      ))}
    </div>
  );
}

// ── 主组件 ────────────────────────────────────────────────────────────────────

interface PrometheusChartCardProps {
  block: PrometheusChartBlock;
}

export function PrometheusChartCard({ block }: PrometheusChartCardProps) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const colors = isDark ? DARK_COLORS : LIGHT_COLORS;
  const cardBg = isDark ? '#111827' : '#f9fafb';
  const headerBg = isDark ? '#1f2937' : '#f3f4f6';
  const border = isDark ? '#374151' : '#e5e7eb';
  const gridColor = isDark ? '#1f2937' : '#f3f4f6';
  const textColor = isDark ? '#e2e8f0' : '#111827';
  const subColor = isDark ? '#9ca3af' : '#6b7280';

  // 将 series 数据转换为 Recharts 要求的格式：[{ ts, "ip1": val, "ip2": val }, ...]
  const allTimestamps = [
    ...new Set(block.series.flatMap((s) => s.data.map(([ts]) => ts))),
  ].sort((a, b) => a - b);

  const chartData = allTimestamps.map((ts) => {
    const point: Record<string, number> = { ts };
    for (const series of block.series) {
      const entry = series.data.find(([t]) => t === ts);
      if (entry) point[series.instance] = parseFloat(entry[1].toFixed(2));
    }
    return point;
  });

  // 最新值（图例右侧显��）
  const latestValues: Record<string, number> = {};
  for (const series of block.series) {
    if (series.data.length > 0) {
      latestValues[series.instance] = parseFloat(
        series.data[series.data.length - 1][1].toFixed(1),
      );
    }
  }

  const hasData = chartData.length > 0;

  return (
    <div
      style={{
        background: cardBg,
        border: `1px solid ${border}`,
        borderRadius: 8,
        overflow: 'hidden',
        marginTop: 8,
        marginBottom: 4,
      }}
    >
      {/* 卡片头部 */}
      <div
        style={{
          background: headerBg,
          borderBottom: `1px solid ${border}`,
          padding: '8px 12px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12 }}>📊</span>
          <span style={{ color: textColor, fontSize: 12, fontWeight: 600 }}>
            {block.title}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              background: isDark ? '#374151' : '#e5e7eb',
              color: subColor,
              fontSize: 10,
              padding: '2px 6px',
              borderRadius: 3,
            }}
          >
            Last {block.timeRange}
          </span>
          {block.datasource && (
            <span style={{ color: subColor, fontSize: 10 }}>{block.datasource}</span>
          )}
        </div>
      </div>

      {/* 图例 */}
      {hasData && (
        <div
          style={{
            padding: '6px 12px',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '8px 16px',
            borderBottom: `1px solid ${isDark ? '#1f2937' : '#f3f4f6'}`,
          }}
        >
          {block.series.map((s, i) => (
            <span key={s.instance} style={{ color: colors[i % colors.length], fontSize: 11 }}>
              ● {s.instance}
              {latestValues[s.instance] !== undefined && (
                <strong>
                  {'  '}
                  {latestValues[s.instance]}
                  {block.unit}
                </strong>
              )}
            </span>
          ))}
        </div>
      )}

      {/* 图表区域 */}
      <div style={{ padding: '8px 4px 4px' }}>
        {!hasData ? (
          <div
            style={{
              textAlign: 'center',
              color: subColor,
              fontSize: 12,
              padding: '24px 0',
            }}
          >
            暂无数据
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
              <XAxis
                dataKey="ts"
                tickFormatter={formatTime}
                tick={{ fill: subColor, fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                minTickGap={40}
              />
              <YAxis
                tick={{ fill: subColor, fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                width={36}
                tickFormatter={(v) => `${v}${block.unit}`}
              />
              <Tooltip
                content={<CustomTooltip unit={block.unit} isDark={isDark} />}
                isAnimationActive={false}
              />
              {block.series.map((s, i) => (
                <Line
                  key={s.instance}
                  type="monotone"
                  dataKey={s.instance}
                  stroke={colors[i % colors.length]}
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 确认 TypeScript 编译无错误**

```bash
cd /root/project/CNP_Bot/frontend
npx tsc --noEmit
```

预期：无新增错误。

- [ ] **Step 3: Commit**

```bash
cd /root/project/CNP_Bot
git add frontend/src/components/PrometheusChartCard.tsx
git commit -m "feat(frontend): add PrometheusChartCard component with Recharts line chart"
```

---

### Task 6: 更新 `frontend/src/components/Chat/MessageList.tsx`

**Files:**
- Modify: `frontend/src/components/Chat/MessageList.tsx`

- [ ] **Step 1: 添加 import**

在 `MessageList.tsx` 顶部 import 区域，在 `ToolCallCard` import 之后添加：

```typescript
import { PrometheusChartCard } from '@/components/PrometheusChartCard';
import type { PrometheusChartBlock } from '@/lib/types';
```

- [ ] **Step 2: 更新 `hasVisibleContent` 检查**

在 `hasVisibleContent` 的 `some` 回调中，在 `if (block.type === 'tool_use') return true;` 之后新增一行：

```typescript
      if (block.type === 'prometheus_chart') return true;
```

完整上下文：

```typescript
    const hasVisibleContent = sortedBlocks.some((block) => {
      if (block.type === 'tool_use') return true;
      if (block.type === 'prometheus_chart') return true;   // ← 新增
      if (block.type === 'thinking' || block.type === 'redacted_thinking') return true;
      // ...现有代码不变
    });
```

- [ ] **Step 3: 新增 `prometheus_chart` 渲染分支**

在 `sortedBlocks.map` 渲染循环中，在 `if (block.type === 'tool_use')` 分支之后、`if (block.type === 'thinking' ...)` 分支之前新增：

```typescript
            if (block.type === 'prometheus_chart') {
              return (
                <PrometheusChartCard
                  key={`chart-${bIdx}`}
                  block={block as PrometheusChartBlock}
                />
              );
            }
```

- [ ] **Step 4: 确认 TypeScript 编译无错误**

```bash
cd /root/project/CNP_Bot/frontend
npx tsc --noEmit
```

预期：无新增错误。

- [ ] **Step 5: 构建前端确认无运行时错误**

```bash
cd /root/project/CNP_Bot/frontend
npm run build
```

预期：build 成功，无 error。

- [ ] **Step 6: 运行后端全量测试确认无回归**

```bash
cd /root/project/CNP_Bot
npm test
```

预期：所有测试 PASS。

- [ ] **Step 7: Commit**

```bash
cd /root/project/CNP_Bot
git add frontend/src/components/Chat/MessageList.tsx
git commit -m "feat(frontend): render prometheus_chart blocks as PrometheusChartCard in chat"
```

---

### Task 7: 端到端验证（手动）

- [ ] **Step 1: 启动服务**

```bash
cd /root/project/CNP_Bot
./start_with_ip.sh --docker
```

- [ ] **Step 2: 模拟 chart_message IPC 文件写入**

在主机上（非容器），先查询实际的 web chat JID，再写入测试文件：

```bash
cd /root/project/CNP_Bot

# 找到实际注册的 web 会话 JID（取第一个）
CHAT_JID=$(sqlite3 data/db.sqlite "SELECT jid FROM chats WHERE jid LIKE 'web:%' LIMIT 1;")
echo "Using chatJid: $CHAT_JID"

GROUP_FOLDER=$(ls data/ipc/ | head -1)
cat > data/ipc/${GROUP_FOLDER}/messages/chart-test.json << EOF
{
  "type": "chart_message",
  "chatJid": "$CHAT_JID",
  "chart": {
    "type": "prometheus_chart",
    "title": "CPU 使用率（测试）",
    "unit": "%",
    "timeRange": "1h",
    "datasource": "portal",
    "series": [
      {
        "instance": "10.246.10.85",
        "data": [[1710000000, 45.2],[1710000060, 52.1],[1710000120, 67.3],[1710000180, 61.0],[1710000240, 58.4]]
      },
      {
        "instance": "10.246.10.86",
        "data": [[1710000000, 32.1],[1710000060, 35.4],[1710000120, 38.2],[1710000180, 40.1],[1710000240, 37.8]]
      }
    ]
  }
}
EOF
```

- [ ] **Step 3: 打开前端，确认图表卡片出现**

访问 `http://localhost:3000`，在 "Web Chat" 会话中应能看到带折线图的 Grafana 风格监控卡片。

验证：
- [ ] 卡片显示标题 "CPU 使用率（测试）"
- [ ] 图表有两条折线，颜色不同
- [ ] 图例显示节点 IP 和最新值
- [ ] 鼠标悬停 tooltip 显示各节点值
- [ ] 深色/浅色主题切换后配色随之变化
