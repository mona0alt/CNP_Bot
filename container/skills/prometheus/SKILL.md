---
name: prometheus
description: Query Prometheus monitoring data to check server metrics, resource usage, and system health. Use when the user asks about server status, disk space, CPU/memory usage, network stats, or any metrics collected by Prometheus. Supports multiple Prometheus instances with aggregated queries, config file or environment variables, and HTTP Basic Auth.
---

# Prometheus Skill

Query Prometheus monitoring data from one or multiple instances. Supports federation across multiple Prometheus servers with a single command.

## ⚠️ 核心规则：必须使用 chart.js 生成图表卡片

**当用户查询 CPU、内存、磁盘、负载、网络等监控指标时，你必须使用 `chart.js` 生成折线图卡片。**

```bash
cd ~/.claude/skills/prometheus
node scripts/chart.js --metric <cpu|memory|disk|load|network_rx|network_tx> \
  --instances "<IP>" \
  --range 1h \
  --chat-jid "$NANOCLAW_CHAT_JID"
```

### 正确用法示例

```bash
# 查询单节点内存（保定管理环境 → portal）
node scripts/chart.js --metric memory --instances "10.245.16.28" --range 1h --datasource portal --chat-jid "$NANOCLAW_CHAT_JID"

# 查询多节点 CPU（多条折线）
node scripts/chart.js --metric cpu --instances "10.245.16.28,10.245.16.29" --range 1h --datasource portal --chat-jid "$NANOCLAW_CHAT_JID"

# 查询磁盘使用率
node scripts/chart.js --metric disk --instances "10.255.23.41" --range 1h --datasource paas --chat-jid "$NANOCLAW_CHAT_JID"

# ── Pod 级别指标查询 ─────────────────────────────────────────────────────
# 查询指定 Pod 的 CPU 使用率
node scripts/chart.js --metric pod_cpu --region baoding --env "管理环境" --pods "nginx-.*" --range 1h --chat-jid "$NANOCLAW_CHAT_JID"

# 查询指定 Pod 的内存使用量
node scripts/chart.js --metric pod_memory --region baoding --env "AI生产环境" --pods "redis-0" --range 1h --chat-jid "$NANOCLAW_CHAT_JID"

# 查询某区域某环境所有 Pod 的内存限制
node scripts/chart.js --metric pod_memory_limit --region baoding --env "生产环境" --range 1h --chat-jid "$NANOCLAW_CHAT_JID"
```

### 支持的指标类型

| 指标类型 | --metric 值 | 说明 |
|----------|-------------|------|
| 节点指标 | `cpu`, `memory`, `disk`, `load`, `network_rx`, `network_tx` | 基于 node-exporter，需要 `--instances` |
| Pod 指标 | `pod_cpu`, `pod_memory`, `pod_memory_limit`, `pod_network_rx`, `pod_network_tx` | 基于 cAdvisor，需要 `--region`、`--env`，可选 `--namespace`、`--pods` |

### Pod 指标参数

| 参数 | 必填 | 说明 |
|------|------|------|
| `--metric` | ✓ | 指标名称（pod_cpu, pod_memory 等） |
| `--region` | ✓ | 区域：baoding, daye, jingmen, longyan, rizhao, taizhou, tianjin, xushui |
| `--env` | ✓ | 环境：AI生产环境, 测试环境, 生产环境, 管理环境, 预发布环境 |
| `--namespace` | — | K8s Namespace 名称（可选，不填则查询所有 Namespace） |
| `--pods` | — | Pod 名称正则（可选，不填则查询所有 Pod） |
| `--range` | — | 时间范围，默认 1h |
| `--datasource` | — | 强制指定 portal 或 paas（默认根据 env 自动判断） |
| `--chat-jid` | ✓ | 目标会话 JID |

- 调用 `chart.js` 后，前端会自动渲染出 Grafana 风格的折线图卡片。
- 如需查询多个指标，依次调用多次 `chart.js`（每个指标单独一次）。
- 如用户只是查询状态（如 `up`）或非图表指标，可以只用文字回复，无需生成图表。

## 数据源快速判断

### 查询前必读

| 数据源 | 地址 | 鉴权方式 | 适用场景 |
|--------|------|----------|----------|
| **portal** | http://10.255.20.242:8000 | 无需鉴权 | 保定管理环境、生产环境、AI生产环境 |
| **paas** | http://thanos.paas.gwm.cn | HTTP Basic Auth: admin/paas@123.com | 保定测试/预发布环境、其他区域生产环境 |

### 网段 → 数据源 快速对照表

**使用 portal (无需鉴权)**:
- 10.245.16.x (保定管理环境)
- 10.246.7.x (保定管理环境)
- 10.246.10.x (保定生产环境)
- 10.246.128.x (保定管理环境)
- 10.255.20.x (107-109 保定管理环境)
- 10.255.20.x (110-112 保定生产环境)
- 10.255.66.x (保定AI生产环境)
- 10.255.132.x (保定AI生产环境)
- 10.246.4.x (保定AI生产环境)

**使用 paas (需要鉴权)**:
- 10.255.23.x (保定测试/预发布/生产环境)
- 10.255.30.x (保定测试环境)
- 10.255.67.x (保定测试环境)
- 10.255.128.x (保定测试环境)
- 10.255.131.x (保定预发布环境)
- 10.70.118.x (大冶生产环境)
- 10.57.118.x (荆门生产环境)
- 10.68.123.x (龙岩生产环境)
- 10.37.131.x (日照生产环境)
- 10.39.128.x (台州生产环境)
- 10.253.23.x (天津生产环境)
- 10.4.122.x (徐水生产环境)

### 快速记忆

> **portal**: 保定"管理"+"生产"+"AI生产" (即非测试环境)
> **paas**: 保定"测试"+"预发布" + 所有"其他区域"(大冶/荆门/龙岩/日照/台州/天津/徐水)

### 查询示例

```bash
# 保定测试环境 (10.255.23.x) - 使用 paas，需要鉴权
node scripts/cli.js query 'up{instance="10.255.23.41:9100"}' -i paas

# 保定管理环境 (10.245.16.x) - 使用 portal，无需鉴权
node scripts/cli.js query 'up{instance="10.245.16.64:9100"}' -i portal

# 查询所有数据源 (自动尝试)
node scripts/cli.js query 'up{instance="10.255.23.41:9100"}' --all
```

### 区域 (region)
- baoding (保定) - 管理中心
- daye (大冶)
- jingmen (荆门)
- longyan (龙岩)
- rizhao (日照)
- taizhou (台州)
- tianjin (天津)
- xushui (徐水)

### 环境 (env_zh)
- AI生产环境
- 测试环境
- 生产环境
- 生产环境02
- 管理环境 (仅保定)
- 预发布环境

### 集群分布
| 区域 | 环境 | 集群 |
|------|------|------|
| 保定 | 管理环境、生产环境、AI生产环境 | portal-cluster |
| 其他区域 | 生产环境 | es |

### 网段分布 (10.x.x.x 集群节点)

**portal 数据源** (无需鉴权) - 管理环境、生产环境、AI生产环境：
| 区域 | 环境 | 网段 |
|------|------|------|
| 保定 | 管理环境 | 10.245.16.1-3, 10.245.16.64, 10.246.7.83-84, 10.246.128.50-51, 10.255.20.107-109 |
| 保定 | 生产环境 | 10.245.16.4-25, 10.245.16.33-69, 10.245.16.98-100, 10.246.10.85,10.246.10.87, 10.255.20.110-112 |
| 保定 | AI生产环境 | 10.246.4.246, 10.255.66.15,10.255.66.19,10.255.66.119, 10.255.132.5-6,10.255.132.10,10.255.132.12,10.255.132.26,10.255.132.39,10.255.132.47,10.255.132.55-56,10.255.132.65,10.255.132.69,10.255.132.85,10.255.132.90,10.255.132.92,10.255.132.94-95 |

**paas 数据源** (需要鉴权 admin/paas@123.com) - 测试/预发布环境、其他区域生产环境：
| 区域 | 环境 | 网段 |
|------|------|------|
| 保定 | 测试环境 | 10.255.23.x, 10.255.30.x, 10.255.67.x, 10.255.128.x |
| 保定 | 预发布环境 | 10.255.131.x |
| 保定 | 生产环境 | 10.255.23.x (部分) |
| 大冶 | 生产环境 | 10.70.118.41,46,71-85 |
| 荆门 | 生产环境 | 10.57.118.46-64 |
| 龙岩 | 生产环境 | 10.68.123.11-14,32-44 |
| 日照 | 生产环境 | 10.37.131.76-94 |
| 台州 | 生产环境 | 10.39.128.114-132 |
| 天津 | 生产环境 | 10.253.23.131-150 |
| 徐水 | 生产环境 | 10.4.122.1-51 (不连续) |

> 注：40.x.x.x 为 Pod IP，无需关注

#### 按区域查询示例

```bash
# 查询保定测试环境节点 (使用 paas)
node scripts/cli.js query 'up{region="baoding",env_zh="测试环境"}' -i paas

# 查询保定生产环境节点 (使用 portal)
node scripts/cli.js query 'up{region="baoding",env_zh="生产环境"}' -i portal

# 查询大冶生产环境节点 (使用 paas)
node scripts/cli.js query 'up{region="daye",env_zh="生产环境"}' -i paas
```

## Quick Start

### 1. Initial Setup

Run the interactive configuration wizard:

```bash
cd ~/.claude/skills/prometheus
node scripts/cli.js init
```

This will create a `prometheus.json` config file in your skill workspace (`~/.claude/skills/prometheus/prometheus.json`).

### 2. Start Querying

```bash
# Query default instance
node scripts/cli.js query 'up'

# Query all instances at once
node scripts/cli.js query 'up' --all

# List configured instances
node scripts/cli.js instances
```

## Configuration

### Config File Location

By default, the skill looks for config in your OpenClaw workspace:

```
~/.claude/skills/prometheus/prometheus.json
```

**Priority order:**
1. Path from `PROMETHEUS_CONFIG` environment variable
2. `~/.claude/skills/prometheus/prometheus.json` (当前 skill 目录)
3. `./prometheus.json` (current directory)
5. `~/.config/prometheus/config.json`

### Config Format

Create `prometheus.json` in your workspace (or use `node cli.js init`):

```json
{
  "instances": [
    {
      "name": "production",
      "url": "https://prometheus.example.com",
      "user": "admin",
      "password": "secret"
    },
    {
      "name": "staging",
      "url": "http://prometheus-staging:9090"
    }
  ],
  "default": "production"
}
```

**Fields:**
- `name` — unique identifier for the instance
- `url` — Prometheus server URL
- `user` / `password` — optional HTTP Basic Auth credentials
- `default` — which instance to use when none specified

### Environment Variables (Legacy)

For single-instance setups, you can use environment variables:

```bash
export PROMETHEUS_URL=https://prometheus.example.com
export PROMETHEUS_USER=admin        # optional
export PROMETHEUS_PASSWORD=secret   # optional
```

## Usage

### Global Flags

| Flag | Description |
|------|-------------|
| `-c, --config <path>` | Path to config file |
| `-i, --instance <name>` | Target specific instance |
| `-a, --all` | Query all configured instances |

### Commands

#### Setup

```bash
# Interactive configuration wizard
node scripts/cli.js init
```

#### Query Metrics

```bash
cd ~/.claude/skills/prometheus

# Query default instance
node scripts/cli.js query 'up'

# Query specific instance
node scripts/cli.js query 'up' -i staging

# Query ALL instances at once
node scripts/cli.js query 'up' --all

# Custom config file
node scripts/cli.js query 'up' -c /path/to/config.json
```

#### 按区域环境查询

```bash
# 查询保定管理环境所有节点状态
node scripts/cli.js query 'up{region="baoding",env_zh="管理环境"}'

# 查询保定管理环境 CPU 使用率
node scripts/cli.js query '100 - (avg by (instance) (irate(node_cpu_seconds_total{region="baoding",env_zh="管理环境",mode="idle"}[5m])) * 100)'

# 查询保定管理环境节点负载
node scripts/cli.js query 'node_load1{region="baoding",env_zh="管理环境"}'

# 查询指定节点 CPU/负载/内存
node scripts/cli.js query '100 - (avg by (instance) (irate(node_cpu_seconds_total{instance="10.245.16.64:9100",mode="idle"}[5m])) * 100)'
node scripts/cli.js query 'node_load1{instance="10.245.16.64:9100"}'
node scripts/cli.js query '(node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes) / node_memory_MemTotal_bytes * 100{instance="10.245.16.64:9100"}'
```

#### Common Queries

**Disk space usage:**
```bash
node scripts/cli.js query '100 - (node_filesystem_avail_bytes / node_filesystem_size_bytes * 100)' --all
```

**CPU usage:**
```bash
node scripts/cli.js query '100 - (avg by (instance) (irate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)' --all
```

**Memory usage:**
```bash
node scripts/cli.js query '(node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes) / node_memory_MemTotal_bytes * 100' --all
```

**Load average:**
```bash
node scripts/cli.js query 'node_load1' --all
```

### List Configured Instances

```bash
node scripts/cli.js instances
```

Output:
```json
{
  "default": "production",
  "instances": [
    { "name": "production", "url": "https://prometheus.example.com", "hasAuth": true },
    { "name": "staging", "url": "http://prometheus-staging:9090", "hasAuth": false }
  ]
}
```

### Other Commands

```bash
# List all metrics matching pattern
node scripts/cli.js metrics 'node_memory_*'

# Get label names
node scripts/cli.js labels --all

# Get values for a label
node scripts/cli.js label-values instance --all

# Find time series
node scripts/cli.js series '{__name__=~"node_cpu_.*", instance=~".*:9100"}' --all

# Get active alerts
node scripts/cli.js alerts --all

# Get scrape targets
node scripts/cli.js targets --all
```

## Multi-Instance Output Format

When using `--all`, results include data from all instances:

```json
{
  "resultType": "vector",
  "results": [
    {
      "instance": "production",
      "status": "success",
      "resultType": "vector",
      "result": [...]
    },
    {
      "instance": "staging",
      "status": "success",
      "resultType": "vector",
      "result": [...]
    }
  ]
}
```

Errors on individual instances don't fail the entire query — they appear with `"status": "error"` in the results array.

## Common Queries Reference

| Metric | PromQL Query |
|--------|--------------|
| Disk free % | `node_filesystem_avail_bytes / node_filesystem_size_bytes * 100` |
| Disk used % | `100 - (node_filesystem_avail_bytes / node_filesystem_size_bytes * 100)` |
| CPU idle % | `avg by (instance) (irate(node_cpu_seconds_total{mode="idle"}[5m])) * 100` |
| Memory used % | `(node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes) / node_memory_MemTotal_bytes * 100` |
| Network RX | `rate(node_network_receive_bytes_total[5m])` |
| Network TX | `rate(node_network_transmit_bytes_total[5m])` |
| Uptime | `node_time_seconds - node_boot_time_seconds` |
| Service up | `up` |

## Notes

- Time range defaults to last 1 hour for instant queries
- Use range queries `[5m]` for rate calculations
- All queries return JSON with `data.result` containing the results
- Instance labels typically show `host:port` format
- When using `--all`, queries run in parallel for faster results
- Config is stored outside the skill directory so it persists across skill updates

## 监控图表（折线图卡片）

使用 `chart.js` 将 Prometheus 时序数据渲染为前端 Grafana 风格折线图卡片。

### 用法

```bash
cd ~/.claude/skills/prometheus
node scripts/chart.js \
  --metric cpu \
  --instances "10.246.10.85,10.246.10.86" \
  [--range 1h] \
  [--datasource portal] \
  --chat-jid "$NANOCLAW_CHAT_JID"
```

> `$NANOCLAW_CHAT_JID` 由运行时自动注入，可直接引用。

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
| `--chat-jid` | ✓ | `$NANOCLAW_CHAT_JID` | 目标会话 JID |