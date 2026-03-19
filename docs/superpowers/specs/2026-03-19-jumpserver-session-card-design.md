# JumpServer 专用会话卡片设计文档

**日期：** 2026-03-19  
**状态：** 已批准

---

## 概述

将现有 JumpServer 相关的 `Bash` / `tmux` 内部工具链，从“多张底层工具卡片”改为“单张聚合的 JumpServer 会话卡片”。

用户在聊天区中只看到一张 `jumpserver_session` 专用卡片；卡片内部展示：

- 当前 JumpServer 会话阶段
- JumpServer 地址与目标主机信息
- 每一次真正发送到远端主机的命令
- 每条远端命令对应的输出摘要
- 最近一次终端输出摘要

JumpServer 内部的 `connect.sh`、`tmux send-keys`、`tmux capture-pane` 等步骤不再直接暴露给前端。

---

## 目标

- 用一张 JumpServer 专用卡片完全替代内部 Bash/tmux 卡片
- 在流式阶段就展示聚合卡片，而不是等最终消息落库后再补
- 明确区分“输入目标主机”和“真正发送到远端主机的命令”
- 保留一次会话中的多次远端命令执行记录
- 保证刷新页面、切换会话后仍能从历史消息恢复完整卡片

---

## 不在范围内

- 抽象其他 tmux 型工具为通用专用卡片
- 改造 JumpServer skill 协议为结构化事件协议
- 做真正的终端协议解析器（v1 使用启发式识别）
- 展示完整原始终端输出（仍只展示脱敏后的摘要）

---

## 架构

### 数据流

```text
用户提问
  → Agent 调用 Bash / tmux
  → 后端 JumpServer 聚合器识别 connect.sh / send-keys / capture-pane
  → 后端生成 jumpserver_session block 的流式更新
  → WebSocket 只向前端广播 JumpServer 专用更新，不广播内部 tmux/Bash 卡片
  → 前端将更新合并到当前 streaming message
  → 最终消息落库时写入聚合后的 jumpserver_session block
  → 刷新 / 切换会话后从 DB 恢复同一张卡片
```

### 改动模块

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `src/index.ts` | 修改 | 在流式工具事件转发与最终消息持久化时接入 JumpServer 聚合 |
| `src/jumpserver-stream-aggregator.ts` | 新增 | 识别 JumpServer 内部 Bash/tmux 事件并维护单会话状态 |
| `src/jumpserver-stream-aggregator.test.ts` | 新增 | 聚合规则与状态流转测试 |
| `frontend/src/lib/types.ts` | 修改 | `ContentBlock` 新增 `jumpserver_session` 类型 |
| `frontend/src/lib/message-utils.ts` | 修改 | 支持 JumpServer 流式 block 更新/替换 |
| `frontend/src/hooks/useChatWebSocket.ts` | 修改 | 接收 JumpServer 专用流式事件并更新当前消息 |
| `frontend/src/components/JumpServerSessionCard.tsx` | 新增 | JumpServer 专用卡片组件 |
| `frontend/src/components/Chat/MessageItem.tsx` | 修改 | 渲染 `jumpserver_session` block |
| `frontend/src/pages/Chat.integration.test.tsx` | 修改 | 前端流式展示与最终消息合并回归 |

---

## 数据结构

### `jumpserver_session` Content Block

```ts
type JumpServerExecution = {
  id: string;
  command: string;
  status: 'running' | 'completed' | 'error' | 'cancelled';
  output?: string;
  started_at?: string;
  finished_at?: string;
  error_message?: string;
};

type JumpServerBlock = {
  type: 'jumpserver_session';
  id?: string;
  stage:
    | 'connecting_jumpserver'
    | 'jumpserver_ready'
    | 'sending_target'
    | 'target_connecting'
    | 'target_connected'
    | 'running_remote_command'
    | 'completed'
    | 'error'
    | 'cancelled';
  status?: 'calling' | 'executed' | 'error' | 'cancelled';
  jumpserver_host?: string;
  target_host?: string;
  target_hint?: string;
  latest_output?: string;
  executions?: JumpServerExecution[];
  error_message?: string;
};
```

### 设计说明

- `latest_output`：会话级最近输出摘要，用于卡片头部快速展示当前状态
- `executions[]`：保留每一次真正发往远端主机的命令和其输出摘要
- `remote_command` 单字段不再保留；其职责由 `executions[]` 替代
- v1 明确假设：**同一条 assistant 回复内最多只聚合一个 JumpServer 会话**

### `ContentBlock` 类型更新

```ts
export type ContentBlock =
  | { type: 'text'; text?: string; [key: string]: unknown }
  | {
      type: 'tool_use';
      id?: string;
      name?: string;
      input?: unknown;
      partial_json?: string;
      status?: 'calling' | 'executed' | 'error' | 'cancelled';
      result?: string | object;
      [key: string]: unknown;
    }
  | { type: 'thinking' | 'redacted_thinking'; text?: string; [key: string]: unknown }
  | JumpServerBlock
  | PrometheusChartBlock;
```

---

## 后端聚合设计

### 核心原则

- JumpServer 相关步骤由后端统一识别并归一化
- 前端不猜测 tmux 命令语义，只负责渲染
- 一旦进入 JumpServer 聚合模式，内部相关 `Bash` / `tmux` 卡片全部隐藏
- 最终落库内容必须包含 `jumpserver_session` block，而不是只依赖流式临时态

### 聚合器职责

`JumpServerStreamAggregator` 对每一条 assistant 流式回复维护一份单会话上下文：

- 是否已进入 JumpServer 模式
- 当前会话阶段
- JumpServer 地址、目标主机、目标提示摘要
- 当前活跃 execution
- 所有 execution 列表
- 最近一次 capture-pane 摘要
- 哪些原始工具事件应吞掉、不向前端透出

### 入口识别

当流式事件中的 `tool_use` 为 `Bash`，且命令命中以下模式时，创建聚合会话：

- `bash /home/node/.claude/skills/jumpserver/scripts/connect.sh`
- 或稳定命中 `jumpserver/scripts/connect.sh` 的等价路径

创建后立即生成 `jumpserver_session` block：

- `stage='connecting_jumpserver'`
- `status='calling'`

并且该条原始 `tool_use` 不再转发为普通工具卡片。

### 状态流转

```text
connecting_jumpserver
  → jumpserver_ready
  → sending_target
  → target_connecting
  → target_connected
  → running_remote_command
  → target_connected（单条命令完成后回到已连接状态）
  → completed（整轮结束）

任意阶段可转 error / cancelled
```

#### 具体规则

1. `connect.sh` 启动
   - 创建 `jumpserver_session`
   - `stage=connecting_jumpserver`

2. `connect.sh` 返回菜单/提示
   - `stage=jumpserver_ready`
   - 更新 `latest_output`
   - 如可提取 JumpServer 地址，则写入 `jumpserver_host`

3. `tmux send-keys ... "<ip/选择串>" Enter`
   - 仅当目标为 `jumpserver:0.0` 且当前阶段已在 JumpServer 模式时，识别为目标主机选择
   - 更新 `target_host`
   - `stage=sending_target`

4. 后续 `capture-pane`
   - 若输出像“正在连接目标机”则进入 `target_connecting`
   - 若出现目标主机提示符/登录痕迹，则进入 `target_connected`
   - 同步刷新 `latest_output`

5. `tmux send-keys ... "<cmd>" Enter`
   - 仅当当前阶段已是 `target_connected`
   - 且输入不是 IP/编号选择、不是空命令、不是 `C-c`/控制键
   - 识别为真正远端命令
   - `stage=running_remote_command`
   - 向 `executions[]` append 一条新记录，状态为 `running`

6. 远端执行期间的 `capture-pane`
   - 更新会话级 `latest_output`
   - 更新当前 execution 的 `output`

7. 检测到远端命令完成
   - 当前 execution → `completed`
   - `finished_at` 写入
   - block `stage` 回到 `target_connected`

8. 中断或失败
   - block → `cancelled` / `error`
   - 当前未完成 execution 同步转为 `cancelled` / `error`

### 识别启发式

v1 不做终端协议解析，而是用“**当前状态 + 命令形态 + pane 文本特征**”判断：

- `connect.sh`：入口脚本命中
- 目标主机选择：`send-keys` 字符串像 IP、编号、菜单选择串
- 远端命令：`send-keys` 字符串像 shell 命令，且阶段已到 `target_connected`
- 命令完成：`capture-pane` 中重新出现远端 prompt、菜单 prompt 或稳定结束标志

这套规则必须集中在后端，前端不参与语义识别。

---

## 流式协议设计

### 现状约束

当前前端 `applyEventToBlocks()` 主要处理：

- `content_block_start`
- `content_block_delta`
- `content_block_stop`
- `tool_result`

它适合文本块和普通 `tool_use`，不适合频繁替换整块结构化对象。

### v1 推荐方案

为 JumpServer 聚合增加一个专用流式事件：

```ts
{
  type: 'jumpserver_session',
  block: JumpServerBlock;
}
```

后端行为：

- 对 JumpServer 内部原始 `tool_use` / `tool_result` / capture 相关事件，不再原样转发
- 每次聚合状态变化后，转发一条 `jumpserver_session` 流式事件

前端行为：

- 收到该事件后，在当前 streaming message 中：
  - 若不存在 `jumpserver_session` block，则追加
  - 若已存在同 `id` 或同 `type` 的 block，则整块替换

这样可以避免把嵌套执行列表拆成若干 delta 再重组，逻辑更稳。

---

## 最终消息持久化

### 要求

最终写入 DB 的 `message.content` 必须包含聚合后的 `jumpserver_session` block。

### 合并规则

当 Agent 返回最终结果时：

1. 若最终结果已经是 `ContentBlock[]`
   - 将其中可见文本块与 JumpServer 聚合块合并
   - 不保留 JumpServer 内部原始 `tool_use`

2. 若最终结果是纯文本
   - 生成：

```json
[
  { "type": "jumpserver_session", "...": "..." },
  { "type": "text", "text": "最终回复文本" }
]
```

3. 若没有最终 assistant 文本，但已有 JumpServer 卡片
   - 仍应正常发送并落库该 block

### 会话切换与刷新恢复

- 前端刷新时，通过 `parseMessageContent()` 直接恢复 `jumpserver_session`
- 当前会话若存在未完成 stream message，仍复用现有 streaming 恢复逻辑
- 一旦 DB 中已有更新后的最终 bot 消息，旧的 stream 缓存应被丢弃

---

## 前端展示设计

### `JumpServerSessionCard`

卡片分为三层：

1. **会话头部**
   - 标题：`JumpServer 远程会话`
   - 状态文案：已连接堡垒机 / 正在选择目标主机 / 已连接目标主机 / 正在执行远端命令 / 已完成 / 已取消 / 执行失败
   - JumpServer 地址
   - 目标主机与目标提示

2. **会话摘要**
   - 展示 `latest_output`
   - 没有内容时不渲染空白区域
   - 继续复用现有脱敏逻辑

3. **执行记录列表**
   - 每条 execution 作为卡片内嵌子块
   - 展示命令、状态、输出摘要
   - 默认展开最后一条 execution；历史记录可默认折叠

### 聊天区显示策略

聊天区最终只保留：

- thinking
- `jumpserver_session`
- 普通文本回复
- 其他非 JumpServer 工具卡片

JumpServer 内部 `Bash` / `tmux` tool_use block 不应出现在聊天区。

### `MessageItem` 适配

- `hasVisibleContent` 需将 `jumpserver_session` 视为可见内容
- 渲染顺序建议与 `prometheus_chart` 同级，位于普通 `tool_use` 之后或并列均可
- 若消息中同时存在文本块与 JumpServer 块，应在同一气泡内同时展示

---

## 错误处理

| 场景 | 处理 |
|------|------|
| `connect.sh` 启动失败 | 创建 `jumpserver_session` 后转为 `error`，展示 `error_message` |
| 目标主机不可达/登录失败 | 卡片保持可见，阶段转 `error`，保留最近提示摘要 |
| 远端命令执行中被用户中断 | block 与当前 execution 转 `cancelled` |
| `capture-pane` 无法提取有效摘要 | 保留旧 `latest_output`，不清空 execution 输出 |
| 启发式误判输入类型 | 以后端状态机优先，宁可不记录 execution，也不要把 IP 误显示成命令 |
| 最终无 assistant 文本 | 仍发送并持久化 JumpServer 卡片 |

---

## 测试计划

### 后端聚合测试

1. `connect.sh` → 生成 `jumpserver_session` 卡片
2. `connect.sh` 输出菜单 → `stage=jumpserver_ready`
3. `send-keys` IP → 更新 `target_host`
4. 目标主机连接成功后的 `capture-pane` → `stage=target_connected`
5. `send-keys` 远端命令 → 新增 execution，命令内容正确
6. `capture-pane` → 更新 `latest_output` 与当前 execution.output
7. 命令完成 → execution=`completed`，block 回到 `target_connected`
8. 中断/失败 → block 与 execution 正确转 `cancelled/error`
9. JumpServer 内部步骤不会生成可见普通 `tool_use`

### 前端渲染测试

1. 只渲染一张 JumpServer 专用卡片，不渲染内部 tmux/Bash 卡片
2. 卡片正确展示阶段变化
3. execution 列表显示真实远端命令，如 `journalctl -n 50`
4. 输出为空时不展示空白区
5. 会话切换/刷新后能从历史消息恢复 JumpServer 卡片
6. 流式更新过程中始终复用同一条 streaming message，不拆成多张卡片

### 端到端回归

输入案例：

- 用户请求“检查 `10.246.104.234` 系统日志”

预期前端只看到：

- 一张 JumpServer 卡片
- 目标主机 `10.246.104.234`
- execution 中出现真实远端命令（如 `journalctl -n 50`）
- 抓取到的日志摘要

不再出现仅展示 `Opt>` 菜单的体验。

---

## 方案结论

v1 采用“**后端语义聚合 + 前端专用渲染**”方案：

- 只覆盖 JumpServer，不抽象其他 tmux 工具
- 内部 Bash/tmux 卡片完全由 JumpServer 专用卡片替代
- 使用 `jumpserver_session + executions[]` 表达多次远端命令历史
- 通过专用流式事件进行整块更新
- 最终消息持久化保存聚合后的 block，保证历史恢复一致

这是当前代码结构下风险最低、用户体验最稳定、且便于后续演进到结构化 skill 协议的方案。
