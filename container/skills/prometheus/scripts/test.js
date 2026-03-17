#!/usr/bin/env node
/**
 * Prometheus Skill 测试脚本
 *
 * 用法（在容器内运行）：
 *   cd ~/.claude/skills/prometheus
 *   node scripts/test.js              # 运行所有测试
 *   node scripts/test.js --suite unit # 只跑单元测试（无网络）
 *   node scripts/test.js --suite api  # 只跑 API 测试（需要网络）
 *   node scripts/test.js --suite chart --chat-jid "xxx@g.us"  # 图表生成测试（需要 IPC）
 */

import { spawnSync } from 'child_process';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = join(__dirname, '..');

// ── CLI 参数 ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const suiteFlag = args.indexOf('--suite');
const targetSuite = suiteFlag !== -1 ? args[suiteFlag + 1] : 'all';
const chatJidFlag = args.indexOf('--chat-jid');
const chatJid = chatJidFlag !== -1 ? args[chatJidFlag + 1] : (process.env.NANOCLAW_CHAT_JID || '');

// ── 测试框架 ──────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
let skipped = 0;
const results = [];

function test(name, fn, suite = 'unit') {
  if (targetSuite !== 'all' && targetSuite !== suite) {
    skipped++;
    return;
  }
  try {
    const result = fn();
    if (result instanceof Promise) {
      // async tests handled in runAsync
      results.push({ name, fn: result, suite });
    } else {
      passed++;
      console.log(`  ✓ ${name}`);
    }
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
  }
}

async function testAsync(name, fn, suite = 'unit') {
  if (targetSuite !== 'all' && targetSuite !== suite) {
    skipped++;
    return;
  }
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function runCLI(args, cwd = SKILL_DIR) {
  const result = spawnSync('node', ['scripts/cli.js', ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 15000,
  });
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    code: result.status,
  };
}

function runChart(args, cwd = SKILL_DIR) {
  const result = spawnSync('node', ['scripts/chart.js', ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 30000,
    env: { ...process.env, NANOCLAW_CHAT_JID: chatJid },
  });
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    code: result.status,
  };
}

// ── Suite 1: 单元测试（无网络，无 IPC） ──────────────────────────────────────

console.log('\n[Suite: unit] 单元测试\n');

test('prometheus.json 配置文件存在', () => {
  const configPath = join(SKILL_DIR, 'prometheus.json');
  assert(existsSync(configPath), `配置文件不存在: ${configPath}`);
});

test('prometheus.json 包含 portal 和 paas 实例', () => {
  const config = JSON.parse(readFileSync(join(SKILL_DIR, 'prometheus.json'), 'utf8'));
  assert(Array.isArray(config.instances), 'instances 不是数组');
  const names = config.instances.map(i => i.name);
  assert(names.includes('portal'), 'portal 实例缺失');
  assert(names.includes('paas'), 'paas 实例缺失');
});

test('prometheus.json paas 实例包含鉴权信息', () => {
  const config = JSON.parse(readFileSync(join(SKILL_DIR, 'prometheus.json'), 'utf8'));
  const paas = config.instances.find(i => i.name === 'paas');
  assert(paas, 'paas 实例不存在');
  assert(paas.user && paas.password, 'paas 实例缺少 user/password');
});

test('chart.js 缺少 --metric 时报错退出', () => {
  const r = runChart(['--chat-jid', 'test@g.us']);
  assert(r.code !== 0, '应该以非零状态退出');
  assert(r.stderr.includes('--metric'), `stderr 应包含 "--metric"，实际: ${r.stderr}`);
});

test('chart.js 未知 --metric 时报错退出', () => {
  const r = runChart(['--metric', 'nonexistent', '--instances', '10.0.0.1', '--chat-jid', 'test@g.us']);
  assert(r.code !== 0, '应该以非零状态退出');
  assert(r.stderr.includes('Unknown metric'), `stderr 应包含 "Unknown metric"，实际: ${r.stderr}`);
});

test('chart.js 节点指标缺少 --instances 时报错', () => {
  const r = runChart(['--metric', 'cpu', '--chat-jid', 'test@g.us']);
  assert(r.code !== 0, '应该以非零状态退出');
  assert(r.stderr.includes('--instances'), `stderr 应包含 "--instances"，实际: ${r.stderr}`);
});

test('chart.js Pod 指标缺少 --region/--env 时报错', () => {
  const r = runChart(['--metric', 'pod_cpu', '--chat-jid', 'test@g.us']);
  assert(r.code !== 0, '应该以非零状态退出');
  assert(
    r.stderr.includes('--region') || r.stderr.includes('--env'),
    `stderr 应包含 "--region" 或 "--env"，实际: ${r.stderr}`
  );
});

test('cli.js instances 能列出配置的实例', () => {
  const r = runCLI(['instances']);
  assertEqual(r.code, 0, `cli.js instances 应成功退出，stderr: ${r.stderr}`);
  const data = JSON.parse(r.stdout);
  assert(Array.isArray(data.instances), 'instances 应为数组');
  const names = data.instances.map(i => i.name);
  assert(names.includes('portal'), 'portal 实例缺失');
  assert(names.includes('paas'), 'paas 实例缺失');
});

// ── Suite 2: API 连通性测试（需要网络） ───────────────────────────────────────

console.log('\n[Suite: api] API 连通性测试\n');

await testAsync('portal 数据源连通 - 查询 up 指标', async () => {
  const r = runCLI(['query', 'up', '-i', 'portal']);
  assert(r.code === 0, `cli.js 查询失败 (code=${r.code}): ${r.stderr}`);
  const data = JSON.parse(r.stdout);
  assert(data.resultType === 'vector', `resultType 应为 vector，实际: ${data.resultType}`);
  assert(Array.isArray(data.result), 'result 应为数组');
  assert(data.result.length > 0, 'portal 应返回至少一个 up 指标');
}, 'api');

await testAsync('paas 数据源连通 - 查询 up 指标', async () => {
  const r = runCLI(['query', 'up', '-i', 'paas']);
  assert(r.code === 0, `cli.js 查询失败 (code=${r.code}): ${r.stderr}`);
  const data = JSON.parse(r.stdout);
  assert(data.resultType === 'vector', `resultType 应为 vector，实际: ${data.resultType}`);
  assert(Array.isArray(data.result), 'result 应为数组');
  assert(data.result.length > 0, 'paas 应返回至少一个 up 指标');
}, 'api');

await testAsync('portal - 查询保定管理环境节点状态', async () => {
  const r = runCLI(['query', 'up{region="baoding",env_zh="管理环境"}', '-i', 'portal']);
  assert(r.code === 0, `查询失败: ${r.stderr}`);
  const data = JSON.parse(r.stdout);
  assert(data.result.length > 0, '保定管理环境应有在线节点');
}, 'api');

await testAsync('portal - 查询活跃告警', async () => {
  const r = runCLI(['alerts', '-i', 'portal']);
  assert(r.code === 0, `查询失败: ${r.stderr}`);
  // 告警可以为空，只验证接口正常
  const data = JSON.parse(r.stdout);
  assert(data !== null, '告警查询应返回数据');
}, 'api');

// ── Suite 3: 图表生成测试（需要 IPC 目录 + chat-jid） ─────────────────────────

console.log('\n[Suite: chart] 图表生成测试\n');

await testAsync('chart.js - 节点 CPU 图表（portal，保定管理环境节点）', async () => {
  if (!chatJid) throw new Error('需要 --chat-jid 参数或 $NANOCLAW_CHAT_JID 环境变量');
  const ipcDir = process.env.IPC_DIR || '/workspace/ipc';
  const messagesDir = join(ipcDir, 'messages');

  const before = existsSync(messagesDir)
    ? new Set(readdirSync(messagesDir))
    : new Set();

  const r = runChart([
    '--metric', 'cpu',
    '--instances', '10.245.16.64',  // 保定管理环境已知节点
    '--range', '15m',
    '--datasource', 'portal',
    '--chat-jid', chatJid,
  ]);

  if (r.stdout.includes('skipped: no node metric data found')) {
    // 节点可能离线，但脚本本身工作正常
    console.log('    (节点无数据，跳过 IPC 文件检查)');
    return;
  }

  assert(r.code === 0, `chart.js 失败 (code=${r.code}): ${r.stderr}`);
  assert(r.stdout.includes('chart card sent'), `stdout 应包含 "chart card sent"，实际: ${r.stdout}`);

  // 验证 IPC 文件被写入
  if (existsSync(messagesDir)) {
    const after = new Set(readdirSync(messagesDir));
    const newFiles = [...after].filter(f => !before.has(f) && f.startsWith('chart-'));
    assert(newFiles.length > 0, 'IPC messages 目录应有新的 chart-*.json 文件');

    // 验证文件格式
    const payload = JSON.parse(readFileSync(join(messagesDir, newFiles[0]), 'utf8'));
    assert(payload.type === 'chart_message', `type 应为 chart_message，实际: ${payload.type}`);
    assert(payload.chatJid === chatJid, 'chatJid 不匹配');
    assert(payload.chart.type === 'prometheus_chart', 'chart.type 错误');
    assert(payload.chart.series.length > 0, 'series 不应为空');
  }
}, 'chart');

await testAsync('chart.js - 节点内存图表（paas，保定测试环境节点）', async () => {
  if (!chatJid) throw new Error('需要 --chat-jid 参数或 $NANOCLAW_CHAT_JID 环境变量');

  const r = runChart([
    '--metric', 'memory',
    '--instances', '10.255.23.41',  // 保定测试环境节点
    '--range', '15m',
    '--chat-jid', chatJid,
  ]);

  if (r.stdout.includes('skipped: no node metric data found')) {
    console.log('    (节点无数据，跳过)');
    return;
  }

  assert(r.code === 0, `chart.js 失败: ${r.stderr}`);
  assert(r.stdout.includes('chart card sent'), `应输出 "chart card sent"，实际: ${r.stdout}`);
}, 'chart');

await testAsync('chart.js - Pod CPU 图表（保定管理环境）', async () => {
  if (!chatJid) throw new Error('需要 --chat-jid 参数或 $NANOCLAW_CHAT_JID 环境变量');

  const r = runChart([
    '--metric', 'pod_cpu',
    '--region', 'baoding',
    '--env', '管理环境',
    '--range', '15m',
    '--chat-jid', chatJid,
  ]);

  if (r.stdout.includes('skipped: no pod metric data found')) {
    console.log('    (Pod 无数据，跳过)');
    return;
  }

  assert(r.code === 0, `chart.js 失败: ${r.stderr}`);
  assert(r.stdout.includes('chart card sent'), `应输出 "chart card sent"，实际: ${r.stdout}`);
}, 'chart');

await testAsync('chart.js - Pod 内存图表（保定 AI生产环境，指定 Pod）', async () => {
  if (!chatJid) throw new Error('需要 --chat-jid 参数或 $NANOCLAW_CHAT_JID 环境变量');

  const r = runChart([
    '--metric', 'pod_memory',
    '--region', 'baoding',
    '--env', 'AI生产环境',
    '--range', '15m',
    '--chat-jid', chatJid,
  ]);

  if (r.stdout.includes('skipped: no pod metric data found')) {
    console.log('    (Pod 无数据，跳过)');
    return;
  }

  assert(r.code === 0, `chart.js 失败: ${r.stderr}`);
  assert(r.stdout.includes('chart card sent'), `应输出 "chart card sent"，实际: ${r.stdout}`);
}, 'chart');

// ── 汇总 ──────────────────────────────────────────────────────────────────────

console.log('\n─────────────────────────────────');
console.log(`结果：${passed} 通过 / ${failed} 失败 / ${skipped} 跳过`);
if (failed > 0) {
  console.log('测试未全部通过。');
  process.exit(1);
} else {
  console.log('所有测试通过。');
}
