---
name: prometheus
description: 查询 Prometheus 和 Thanos 监控数据，检查服务器、K8s Pod、Namespace 的指标是否正常。当用户提到：CPU/内存/磁盘/负载/网络是否正常、有没有异常、Pod 状态、某个 namespace 的资源用量、节点状态、监控指标、Grafana 图表、保定/大冶/荆门等区域的生产/测试/管理环境监控——都应使用此 skill。即使用户没有说"Prometheus"，只要涉及基础设施监控指标查询，就应该触发此 skill。
---

# Prometheus Skill

查询 Prometheus 监控数据，支持节点级别（node-exporter）和 Pod 级别（cAdvisor）指标，自动渲染折线图卡片。

## 核心规则

**查询 CPU、内存、磁盘、负载、网络等趋势指标时，必须用 `chart.js` 生成折线图卡片，不要只用文字回复数字。**
仅当用户查询状态类指标（如节点在线/离线）或明确只需要数字时，才用 `cli.js`。

```bash
cd ~/.claude/skills/prometheus
node scripts/chart.js --metric <指标> [参数...] --chat-jid "$NANOCLAW_CHAT_JID"
```

---

## 零、"是否正常"类查询的标准流程

当用户问"是否正常"、"有没有异常"、"帮我看看"时，执行以下步骤：

1. **生成图表**：调用 `chart.js` 发送折线图卡片（直观展示趋势）
2. **查当前值**：调用 `cli.js query` 获取最新瞬时值
3. **给出判断**：根据数值回答"正常/偏高/异常"，说明理由

**参考阈值**���一般性标准，具体场景可能不同）：
- CPU 使用率：`< 70%` 正常，`70–90%` 偏高，`> 90%` 异常
- 内存使用率：`< 80%` 正常，`80–90%` 偏高，`> 90%` 异常
- 磁盘使用率：`< 80%` 正常，`> 85%` 需关注，`> 90%` 危险
- Pod CPU（相对 limit）：`< 80%` 正常，`> 100%` 已触发限流（throttling）

**示例**（用户：检查保定生产环境 gwm-workbench-prod namespace 下 gwm-workbench-prod-gateway 相关 Pod 的 CPU 是否正常）：

```bash
cd ~/.claude/skills/prometheus

# 步骤 1：生成图表
node scripts/chart.js --metric pod_cpu \
  --region baoding --env "生产环境" \
  --namespace "gwm-workbench-prod" \
  --pods "gwm-workbench-prod-gateway.*" \
  --range 1h --chat-jid "$NANOCLAW_CHAT_JID"

# 步骤 2：查当前值（PromQL 直接查，用 portal 因为是保定生产环境）
node scripts/cli.js query \
  'sum(irate(container_cpu_usage_seconds_total{namespace="gwm-workbench-prod",pod=~"gwm-workbench-prod-gateway.*",image!=""}[5m])) by (pod) / sum(container_spec_cpu_quota{namespace="gwm-workbench-prod",pod=~"gwm-workbench-prod-gateway.*",image!=""}/100000) by (pod) * 100' \
  -i portal
```

步骤 3：根据返回值告诉用户是否正常，例如："当前 CPU 使用率约 35%，处于正常范围。"

---

## 一、节点级别指标（需要 --instances）

### 支持的指标

| --metric 值 | 图表标题 | 单位 | 说明 |
|-------------|----------|------|------|
| `cpu` | CPU 使用率 | % | node-exporter |
| `memory` | 内存使用率 | % | node-exporter |
| `disk` | 磁盘使用率 | % | 根分区 |
| `load` | 系统负载 (1m) | — | node-exporter |
| `network_rx` | 网络接收 | B/s | 排除 lo |
| `network_tx` | 网络发送 | B/s | 排除 lo |

### 用法示例

```bash
# 单节点内存
node scripts/chart.js --metric memory --instances "10.245.16.28" --range 1h --chat-jid "$NANOCLAW_CHAT_JID"

# 多节点 CPU（多条折线）
node scripts/chart.js --metric cpu --instances "10.245.16.28,10.245.16.29" --range 1h --chat-jid "$NANOCLAW_CHAT_JID"

# 磁盘使用率（paas 环境）
node scripts/chart.js --metric disk --instances "10.255.23.41" --range 1h --datasource paas --chat-jid "$NANOCLAW_CHAT_JID"
```

### 参数

| 参数 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `--metric` | ✓ | — | 指标名称 |
| `--instances` | ✓ | — | 逗号分隔的节点 IP（不带端口） |
| `--range` | — | `1h` | 时间范围：`15m` / `1h` / `6h` / `24h` |
| `--datasource` | — | 按 IP 自动检测 | 强制指定 `portal` 或 `paas` |
| `--chat-jid` | ✓ | `$NANOCLAW_CHAT_JID` | 目标会话 JID |

---

## 二、Pod 级别指标（需要 --region 和 --env）

### 支持的指标

| --metric 值 | 说明 |
|-------------|------|
| `pod_cpu` | Pod CPU 使用率（相对 limit，%） |
| `pod_memory` | Pod 内存使用率（相对 limit，%） |
| `pod_memory_limit` | Pod 内存限制（字节） |
| `pod_network_rx` | Pod 网络接收（B/s） |
| `pod_network_tx` | Pod 网络发送（B/s） |

### 参数映射：从用户描述提取参数

| 用户说的 | 对应参数 | 写法 |
|---------|---------|------|
| "保定生产环境" | `--region baoding --env "生产环境"` | — |
| "gwm-workbench-prod 这个 namespace" | `--namespace "gwm-workbench-prod"` | 完整 namespace 名 |
| "gateway 相关 pod" / "gateway 开头的 pod" | `--pods "gwm-workbench-prod-gateway.*"` | 前缀 + `.*` |
| "redis-0 这个 pod" | `--pods "redis-0"` | 精确名直接写 |
| 不限定 pod | 省略 `--pods` | 查该环境所有 pod |

> `--pods` 是正则表达式。用户说"xxx 相关 pod"或"xxx 开头"时，写成 `"xxx.*"`。

### 用法示例

```bash
# 指定 namespace + pod 前缀（最常见场景）
node scripts/chart.js --metric pod_cpu \
  --region baoding --env "生产环境" \
  --namespace "gwm-workbench-prod" \
  --pods "gwm-workbench-prod-gateway.*" \
  --range 1h --chat-jid "$NANOCLAW_CHAT_JID"

# 查某 namespace 下所有 pod 的内存
node scripts/chart.js --metric pod_memory \
  --region baoding --env "AI生产环境" \
  --namespace "ai-prod" \
  --range 1h --chat-jid "$NANOCLAW_CHAT_JID"

# 精确 pod 名
node scripts/chart.js --metric pod_memory \
  --region baoding --env "AI生产环境" \
  --pods "redis-0" \
  --range 1h --chat-jid "$NANOCLAW_CHAT_JID"

# 某环境所有 pod（不限定）
node scripts/chart.js --metric pod_memory_limit \
  --region baoding --env "生产环境" \
  --range 1h --chat-jid "$NANOCLAW_CHAT_JID"
```

### 参数

| 参数 | 必填 | 说明 |
|------|------|------|
| `--metric` | ✓ | 指标名称（pod_cpu, pod_memory 等） |
| `--region` | ✓ | 区域，见下方区域列表 |
| `--env` | ✓ | 环境，见下方环境列表 |
| `--namespace` | — | K8s Namespace 名称（不填查全部） |
| `--pods` | — | Pod 名称正则，前缀匹配用 `"prefix.*"`（不填查全部） |
| `--range` | — | 时间范围，默认 `1h` |
| `--datasource` | — | 强制指定 `portal` 或 `paas`（默认自动判断） |
| `--chat-jid` | ✓ | 目标会话 JID |

> Pod 指标**不需要** `--instances`，按 region + env 查询集群数据。

---

## 三、数据源选择规则

### 快速记忆

- **portal**（无需鉴权）：保定 管理环境 / 生产环境 / AI生产环境
- **paas**（admin/paas@123.com）：保定 测试环境 / 预发布环境 + 所有其他区域生产环境

### 节点 IP → 数据源对照

**portal 数据源** (http://10.255.20.242:8000)：
| 环境 | 典型网段 |
|------|---------|
| 保定 管理环境 | 10.245.16.1-3, 10.245.16.64, 10.246.7.83-84, 10.246.128.50-51, 10.255.20.107-109 |
| 保定 生产环境 | 10.245.16.4-25, 10.245.16.33-69, 10.246.10.85/87, 10.255.20.110-112 |
| 保定 AI生产环境 | 10.246.4.246, 10.255.66.x, 10.255.132.x |

**paas 数据源** (http://thanos.paas.gwm.cn，需鉴权)：
| 区域/环境 | 典型网段 |
|-----------|---------|
| 保定 测试环境 | 10.255.23.x, 10.255.30.x, 10.255.67.x, 10.255.128.x |
| 保定 预发布环境 | 10.255.131.x |
| 大冶 生产环境 | 10.70.118.41-85 |
| 荆门 生产环境 | 10.57.118.46-64 |
| 龙岩 生产环境 | 10.68.123.11-44 |
| 日照 生产环境 | 10.37.131.76-94 |
| 台州 生产环境 | 10.39.128.114-132 |
| 天津 生产环境 | 10.253.23.131-150 |
| 徐水 生产环境 | 10.4.122.x |

> `chart.js` 节点指标会根据 IP 自动检测数据源，无需手动指定。
> Pod 指标自动判断规则：测试环境 → paas；管理/生产/AI生产/预发布环境 → portal（如需覆盖用 `--datasource`）。

### 区域 (--region)
`baoding` / `daye` / `jingmen` / `longyan` / `rizhao` / `taizhou` / `tianjin` / `xushui`

### 环境 (--env)
`管理环境`（仅保定）/ `生产环境` / `生产环境02` / `AI生产环境` / `测试环境` / `预发布环境`

---

## 四、ad-hoc 查询（状态检查）

不需要图表时，用 `cli.js` 直接查询原始数据：

```bash
cd ~/.claude/skills/prometheus

# 查节点是否在线
node scripts/cli.js query 'up{instance="10.255.23.41:9100"}' -i paas

# 查保定管理环境所有节点状态
node scripts/cli.js query 'up{region="baoding",env_zh="管理环境"}' -i portal

# 查活跃告警
node scripts/cli.js alerts -i portal

# 查询所有数据源
node scripts/cli.js query 'up' --all
```

| 命令 | 说明 |
|------|------|
| `query '<promql>' [-i portal\|paas]` | 即时查询 |
| `alerts [-i portal\|paas]` | 活跃告警 |
| `targets [-i portal\|paas]` | Scrape 目标状态 |
| `series '{...}'` | 查找时间序列 |

---

## 五、多指标查询

如需在一条消息里展示多个指标，依次调用 `chart.js` 多次（每个指标一次）：

```bash
node scripts/chart.js --metric cpu --instances "10.245.16.28" --range 1h --chat-jid "$NANOCLAW_CHAT_JID"
node scripts/chart.js --metric memory --instances "10.245.16.28" --range 1h --chat-jid "$NANOCLAW_CHAT_JID"
```
