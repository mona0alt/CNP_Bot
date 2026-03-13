# Prometheus 监控卡片设计文档

**日期：** 2026-03-13
**状态：** 已批准

---

## 概述

在前端聊天界面中，当后端 Agent 使用 prometheus skill 查询指标数据时，以 Grafana 风格的折线图面板内嵌展示在对话气泡中，替代原来的纯文本/JSON 输出。

---

## 需求

- Agent 通过 prometheus skill 查询 Prometheus 时序数据（`query_range`）
- 前端在聊天消息流中内嵌 Grafana 风格折线图卡片
- 每张卡片对应一个指标（CPU / 内存 / 磁盘等），支持多节点多条折线
- 默认时间范围：最近 1 小时
- 卡片主题随系统深色/浅色模式自动切换

---

## 架构

### 数据流

```
用户提问
  → Agent 调用 chart.js 脚本（Bash tool）
  → chart.js 调用 prometheus rangeQuery()
  → 格式化为 prometheus_chart content block
  → 写入 data/ipc/{group}/messages/chart-{ts}.json（type: chart_message）
  → IPC watcher 读取，存入 DB（消息内容块）
  → 前端 WebSocket 收到新消息
  → MessageList 渲染 PrometheusChartCard
```

### 改动模块

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `container/skills/prometheus/scripts/chart.js` | 新增 | Agent 调用入口脚本 |
| `container/skills/prometheus/SKILL.md` | 修改 | 补充 chart.js 用法 |
| `src/ipc.ts` | 修改 | 新增 `chart_message` 消息类型 |
| `frontend/src/lib/types.ts` | 修改 | ContentBlock 新增 `prometheus_chart` 类型 |
| `frontend/src/components/PrometheusChartCard.tsx` | 新增 | 图表卡片组件 |
| `frontend/src/components/Chat/MessageList.tsx` | 修改 | 渲染 `prometheus_chart` block |
| `frontend/package.json` | 修改 | 新增 `recharts` 依赖 |

---

## 数据结构

### `prometheus_chart` Content Block

```typescript
interface PrometheusChartBlock {
  type: "prometheus_chart";
  title: string;          // 显示标题，如 "CPU 使用率"
  unit: string;           // 单位，如 "%" | "GB" | "MB/s"
  timeRange: string;      // 时间范围标签，如 "1h"
  datasource?: string;    // 数据源名称，如 "portal" | "paas"
  series: Array<{
    instance: string;     // 节点标识，如 "10.246.10.85"
    data: Array<[number, number]>; // [unix_timestamp_seconds, value]
  }>;
}
```

### IPC 消息文件（`chart-{ts}.json`）

```json
{
  "type": "chart_message",
  "chatJid": "web:xxxx",
  "chart": {
    "type": "prometheus_chart",
    "title": "CPU 使用率",
    "unit": "%",
    "timeRange": "1h",
    "datasource": "portal",
    "series": [
      {
        "instance": "10.246.10.85",
        "data": [[1710000000, 67.3], [1710000060, 65.1]]
      }
    ]
  }
}
```

---

## chart.js 脚本

### 调用方式

```bash
node ~/.openclaw/workspace/skills/prometheus/scripts/chart.js \
  --metric cpu \
  --instances "10.246.10.85,10.246.10.86" \
  --range 1h \
  [--instance-name portal] \
  --chat-jid "$CHAT_JID"
```

### 支持的 `--metric` 快捷名

| 名称 | PromQL |
|------|--------|
| `cpu` | `100 - (avg by (instance) (irate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)` |
| `memory` | `(node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes) / node_memory_MemTotal_bytes * 100` |
| `disk` | `100 - (node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"} * 100)` |
| `load` | `node_load1` |
| `network_rx` | `rate(node_network_receive_bytes_total{device!="lo"}[5m])` |
| `network_tx` | `rate(node_network_transmit_bytes_total{device!="lo"}[5m])` |

### 参数说明

| 参数 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `--metric` | 是 | — | 指标名称（见上表） |
| `--instances` | 是 | — | 逗号分隔的节点 IP 列表 |
| `--range` | 否 | `1h` | 时间范围：`15m` / `1h` / `6h` / `24h` |
| `--instance-name` | 否 | 自动检测 | 强制指定 prometheus 数据源 |
| `--chat-jid` | 是 | — | 目标会话 JID |

### 内部流程

1. 根据 `--metric` 解析对应 PromQL 表达式
2. 自动检测每个 instance IP 对应的 prometheus 数据源（复用 SKILL.md 中的网段规则）
3. 调用 `rangeQuery(promql, now-range, now, { step: 60, instance: datasource })`
4. 将结果格式化为 `prometheus_chart` content block
5. 写入 `$DATA_DIR/ipc/{groupFolder}/messages/chart-{ts}.json`

---

## 前端组件：PrometheusChartCard

### 结构

```
PrometheusChartCard
├── 卡片头部（标题 + 时间范围标签 + 数据源）
├── 图例（每个 instance 一个彩色标签 + 当前/最新值）
├── Recharts LineChart
│   ├── CartesianGrid（网格线）
│   ├── XAxis（时间轴，格式 HH:mm）
│   ├── YAxis（数值轴，带单位）
│   ├── Tooltip（悬停显示各节点值）
│   └── Line × N（每个 instance 一条线，自动分配颜色）
└── 无数据占位（"暂无数据"）
```

### 主题配色

**深色模式（跟随 ThemeContext）：**
- 背景：`#111827` / `#1f2937`
- 折线颜色池：`#f6c90e`（黄）、`#73bf69`（绿）、`#f44747`（红）、`#60a5fa`（蓝）、`#a78bfa`（紫）
- 网格线：`#1f2937`
- 文字：`#e2e8f0` / `#9ca3af`

**浅色模式：**
- 背景：`#f9fafb` / `#f3f4f6`
- 折线颜色池：`#d97706`（橙）、`#16a34a`（绿）、`#dc2626`（红）、`#2563eb`（蓝）、`#7c3aed`（紫）
- 网格线：`#f3f4f6`
- 文字：`#111827` / `#6b7280`

### 图表库

**Recharts**（`recharts` npm 包），选型理由：
- React 原生，与现有 React 前端无缝集成
- `LineChart` + `ResponsiveContainer` 开箱即用
- 包体积适中，无额外 canvas/WebGL 依赖

---

## IPC 处理（src/ipc.ts）

在 `processIpcFiles` 中新增对 `chart_message` 类型的处理：

1. 读取 `chart` 字段，序列化为 JSON 存入消息 `content`（格式与其他 content block 一致：JSON array）
2. 调用 `sendMessage(chatJid, JSON.stringify([chartBlock]))`，WebChannel 将其存入 DB 并广播

---

## 错误处理

| 场景 | 处理 |
|------|------|
| Prometheus 查询失败 | `chart.js` 以非 0 退出，Agent 收到 stderr，改用文字答复用户 |
| 节点无数据（series 为空） | 前端渲染"暂无数据"占位文字 |
| `CHAT_JID` 未设置 | `chart.js` 打印错误并退出，不写 IPC 文件 |
| 数据点少于 2 个 | 正常渲染，Recharts 退化为散点显示 |
| 网段未知（无法自动判断数据源） | `chart.js` 打印警告，尝试 `--all` 查询两个数据源 |

---

## 不在范围内

- 图表交互（缩放、时间范围选择器）— 未来可加
- 历史记录中重新渲染图表的动画 — 静态渲染即可
- 自定义 PromQL（仅支持预设 `--metric` 快捷名）— 未来可扩展
- 独立监控页面 — 本期不做
