# 统一消息结构模型方案：后端单一真相源 + 实时流式 Patch

## 摘要

目标是把“实时流式展示”和“最终历史落库”统一为同一套消息结构，彻底消除前端临时拼装与数据库最终内容不一致导致的闪变、重复气泡、卡片状态错乱问题。

本方案采用：

- 后端统一生成消息块结构，作为唯一真相源
- 前端只消费后端推送的消息快照/增量 patch
- 消息按 `message_id` 生命周期演进，不再使用 `stream-*` 临时消息与最终消息双轨并存
- `thinking` 允许落库，但默认折叠
- 保证前端继续保有流式输出效果与工具卡片实时状态变化

## 统一消息模型

### 1. 核心消息结构

新增统一消息对象 `UnifiedMessage`，前后端、WebSocket、数据库、前端状态全部使用同一结构：

```ts
type UnifiedMessage = {
  id: string;                 // 稳定 message_id，全生命周期不变
  chat_jid: string;
  sender_name: string;
  role: 'user' | 'assistant' | 'system';
  created_at: string;
  updated_at: string;
  state: 'streaming' | 'completed' | 'error' | 'cancelled';
  blocks: MessageBlock[];
  version: number;            // 单调递增，用于幂等更新和乱序保护
  is_bot_message: boolean;
  is_from_me: boolean;
};
```

### 2. Block 结构

统一定义 `MessageBlock`：

```ts
type MessageBlock =
  | {
      id: string;
      type: 'text';
      text: string;
      state?: 'streaming' | 'completed';
    }
  | {
      id: string;
      type: 'thinking';
      text: string;
      state?: 'streaming' | 'completed';
      collapsed_by_default: true;
    }
  | {
      id: string;
      type: 'tool_call';
      tool_name: string;
      input: unknown;
      output?: unknown;
      state: 'queued' | 'calling' | 'executed' | 'error' | 'cancelled';
      started_at?: string;
      finished_at?: string;
    }
  | {
      id: string;
      type: 'prometheus_chart';
      title: string;
      unit: string;
      timeRange: string;
      datasource?: string;
      series: Array<{ instance: string; data: Array<[number, number]> }>;
    };
```

### 3. 关键约束

- 一个 assistant 回复 = 一条 message
- 工具调用、thinking、文本，都只是这条 message 的 block
- 不能再出现“前端流式临时消息”和“后端最终正式消息”是两份不同对象
- `message.id` 从首次开始流式时就生成，后续一直复用
- `version` 每次 patch +1，前端只接受更高版本

## 接口与数据流改造

### 1. WebSocket 事件改为“消息 patch 协议”

废弃当前分裂的：

- `stream`
- `stream_event`
- 最终 `message` 覆盖式替换

统一为以下事件：

#### `message_start`

创建一条新消息：

```ts
{
  type: 'message_start',
  message: UnifiedMessage
}
```

#### `message_patch`

对现有消息做增量更新：

```ts
{
  type: 'message_patch',
  message_id: string,
  chat_jid: string,
  version: number,
  ops: MessagePatchOp[]
}
```

Patch 操作固定化，避免前端自己猜：

```ts
type MessagePatchOp =
  | { op: 'append_block'; block: MessageBlock }
  | { op: 'replace_block'; block_id: string; block: MessageBlock }
  | { op: 'append_text'; block_id: string; text: string }
  | { op: 'set_block_state'; block_id: string; state: string }
  | { op: 'set_message_state'; state: UnifiedMessage['state'] }
  | { op: 'set_tool_output'; block_id: string; output: unknown; state: string };
```

#### `message_commit`

表示该消息已完成并已持久化：

```ts
{
  type: 'message_commit',
  message: UnifiedMessage
}
```

前端收到后只做“同 id 同 version 覆盖”，不新建第二条气泡。

### 2. REST 拉取历史消息

`/api/groups/:jid/messages` 返回 `UnifiedMessage[]`，不再返回 `content: string` 字段。

历史与实时完全同构：

- 前端首次加载拿到的是完整 `blocks`
- WebSocket 后续只是在这些消息上继续 patch

### 3. 数据库存储

现有 `messages` 表保留主键与索引设计，但调整内容承载方式。

#### 建议最小改造

在 `messages` 表新增字段：

- `blocks_json TEXT NOT NULL`
- `state TEXT NOT NULL DEFAULT 'completed'`
- `version INTEGER NOT NULL DEFAULT 1`
- `role TEXT NOT NULL DEFAULT 'assistant'`
- `created_at TEXT`
- `updated_at TEXT`

`content` 字段保留一个“摘要/兼容文本”：

- 用于旧逻辑、搜索、列表预览
- 不再作为渲染真相源

#### 摘要生成规则

- 取 blocks 中最后一个 text block 的可见文本
- 如果无 text，则用工具调用摘要或空串
- chat list 只读这个摘要，不解析 blocks

## 后端实现方案

### 1. 聚合器职责前移到后端

新增一个“消息聚合器”层，负责把 SDK 原始流事件转换为统一 block patch：

- `content_block_start` -> `append_block`
- `thinking_delta` -> `append_text` 到 thinking block
- `text_delta` -> `append_text` 到 text block
- `tool_use` -> 生成 `tool_call` block
- `tool_result` -> 更新 `tool_call.output/state`
- 最终 result -> 补齐 text block 与 `message.state=completed`

前端不再需要 `applyEventToBlocks` 这种 SDK 事件解释器。

### 2. 持久化策略

- `message_start` 时，在内存注册一条 streaming message
- 每个 patch 更新内存态
- 在以下时机写库：
  - assistant 一轮结束时写一次完整 `blocks_json`
  - 用户点击终止时写成 `state='cancelled'`
  - 异常时写成 `state='error'`
- 若担心进程中断丢失流式态，可追加可选 checkpoint：
  - 每 N 秒或重要 patch（tool_result）做一次 UPSERT

### 3. 状态同步

按钮、卡片状态统一来自 `UnifiedMessage.state` 和 block state：

- session 是否生成中：看该 jid 最近一条 assistant message 是否 `state='streaming'`
- 工具卡片不再靠额外“typing”猜测结束
- `typing` 可保留，但只作为输入框 UX 辅助，不作为主真相源

## 前端实现方案

### 1. 本地状态结构

前端消息 store 改为：

```ts
Map<chat_jid, Map<message_id, UnifiedMessage>>
```

渲染时按 `created_at` 排序输出。

### 2. WebSocket 行为

- `message_start`：若 `message_id` 不存在则插入
- `message_patch`：按 `version` 应用 patch
- `message_commit`：按 id 覆盖并标记 completed
- 若收到旧 `version`，直接丢弃

### 3. UI 展示规则

- 一个 assistant 回复只渲染一个气泡
- 气泡内部按 block 顺序展示：
  - thinking（默认折叠）
  - tool_call 卡片
  - text
  - chart
- streaming 态：
  - text block 实时追加字符
  - tool_call 状态实时从 `queued -> calling -> executed/error/cancelled`
- completed/cancelled/error 后，按钮状态立即同步恢复

### 4. 兼容迁移

前端先做一层兼容解析：

- 若接口返回旧 `content: string`
  - 走旧 parser
- 若返回新 `blocks_json/blocks`
  - 走新统一渲染
- WebSocket 新旧协议可并行一小段时间，但最终以前端只吃新协议为目标

## 测试方案

### 1. 后端

- 流式 text 追加后，最终落库的 `blocks_json` 与实时最后状态一致
- tool_call 从 start/delta/result 到 completed，全链路 `version` 单调递增
- 用户 stop 时：
  - `message.state = cancelled`
  - 所有 `calling` tool_call -> `cancelled`
- error 时：
  - `message.state = error`
  - 已开始未完成的 `tool_call` -> `error`

### 2. 前端

- 同一条 assistant 回复在 streaming 与 commit 后仍只渲染一个气泡
- session 切换前后不会出现：
  - 双消息
  - 卡片闪变
  - 状态回退
- thinking 默认折叠，展开后内容与落库一致
- 乱序 patch / 重复 patch / 旧 version patch 被正确忽略

### 3. 集成场景

- “你是谁”纯文本回复
- 多工具调用 + 最终文本
- 工具执行中切换 session 再切回
- 工具执行中点击终止
- 页面刷新后恢复历史消息
- WebSocket 重连后续传 patch 与历史消息无重复

## 假设与默认决策

- 默认采用后端统一生成消息结构，前端不再解释 SDK 原始事件
- `thinking` 允许落库，但默认折叠
- 历史列表预览继续用摘要文本，不解析完整 blocks
- 兼容迁移采用“新旧协议并存、前端优先支持新协议”的渐进方案
- 不单独拆新表，优先在现有 `messages` 表上扩字段，降低迁移成本
