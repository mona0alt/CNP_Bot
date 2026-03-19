# JumpServer 专用会话卡片 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 JumpServer 相关的底层 Bash/tmux 工具步骤聚合为单张可持久化的 `jumpserver_session` 卡片，并在卡片内展示每次远端命令及其输出摘要。

**Architecture:** 新增一个后端 `JumpServerStreamAggregator` 纯逻辑模块，负责识别 `connect.sh`、`tmux send-keys`、`tmux capture-pane` 并输出聚合后的 `jumpserver_session` block；`src/index.ts` 在流式广播和最终消息持久化时接入该聚合器。前端扩展 `ContentBlock` 与 WebSocket 事件处理，新增 `JumpServerSessionCard` 专用组件，只渲染聚合块、不渲染 JumpServer 内部 tmux/Bash 卡片。

**Tech Stack:** TypeScript, Node.js ESM, Vitest, React 19, Tailwind, existing WebSocket streaming message model

**Spec:** `docs/superpowers/specs/2026-03-19-jumpserver-session-card-design.md`

---

## File Map

| 文件 | 动作 | 说明 |
|------|------|------|
| `src/jumpserver-stream-aggregator.ts` | 新增 | 纯函数/轻状态对象：识别 JumpServer 工具事件并生成聚合状态 |
| `src/jumpserver-stream-aggregator.test.ts` | 新增 | 识别规则、状态流转、隐藏内部工具事件测试 |
| `src/index.ts` | 修改 | 接入聚合器，过滤 JumpServer 内部流式事件，广播 `jumpserver_session` 专用事件，最终持久化合并 block |
| `src/server-chat.test.ts` | 修改 | WebSocket 广播层回归：JumpServer 专用事件可透传，普通会话不受影响 |
| `frontend/src/lib/types.ts` | 修改 | 新增 `JumpServerBlock` / `JumpServerExecution` / `ContentBlock` 联合类型 |
| `frontend/src/lib/message-utils.ts` | 修改 | 新增/扩展对 `jumpserver_session` 流式整块替换逻辑 |
| `frontend/src/hooks/useChatWebSocket.ts` | 修改 | 处理 `jumpserver_session` 专用流式事件并合并到当前 streaming message |
| `frontend/src/components/JumpServerSessionCard.tsx` | 新增 | JumpServer 专用卡片组件 |
| `frontend/src/components/Chat/MessageItem.tsx` | 修改 | 识别并渲染 `jumpserver_session` block |
| `frontend/src/pages/Chat.integration.test.tsx` | 修改 | 流式展示、最终消息合并、历史恢复回归测试 |

---

## Chunk 1: 后端聚合核心

### Task 1: 先写 `JumpServerStreamAggregator` 的失败测试

**Files:**
- Create: `src/jumpserver-stream-aggregator.test.ts`
- Create: `src/jumpserver-stream-aggregator.ts`

- [ ] **Step 1: 写 `connect.sh` 入口识别的失败测试**

在 `src/jumpserver-stream-aggregator.test.ts` 添加：

```ts
import { describe, expect, it } from 'vitest';
import {
  createJumpServerStreamAggregator,
  type StreamToolEvent,
} from './jumpserver-stream-aggregator.js';

describe('JumpServerStreamAggregator', () => {
  it('creates a jumpserver_session block when connect.sh starts', () => {
    const aggregator = createJumpServerStreamAggregator();
    const event: StreamToolEvent = {
      type: 'tool_use',
      name: 'Bash',
      toolUseId: 'tool-connect-1',
      input: {
        command: 'bash /home/node/.claude/skills/jumpserver/scripts/connect.sh',
      },
    };

    const result = aggregator.consume(event);

    expect(result.hiddenOriginalEvent).toBe(true);
    expect(result.block?.type).toBe('jumpserver_session');
    expect(result.block?.stage).toBe('connecting_jumpserver');
    expect(result.block?.status).toBe('calling');
  });
});
```

- [ ] **Step 2: 写目标主机与远端命令识别的失败测试**

继续添加：

```ts
it('records target_host when send-keys sends an IP to jumpserver pane', () => {
  const aggregator = createJumpServerStreamAggregator();
  aggregator.consume({
    type: 'tool_use',
    name: 'Bash',
    toolUseId: 'tool-connect-1',
    input: { command: 'bash /home/node/.claude/skills/jumpserver/scripts/connect.sh' },
  });
  aggregator.consume({
    type: 'tool_result',
    toolUseId: 'tool-connect-1',
    content: 'Opt> 输入目标主机',
    isError: false,
  });

  const result = aggregator.consume({
    type: 'tool_use',
    name: 'Bash',
    toolUseId: 'tool-send-ip',
    input: {
      command: 'tmux -S /tmp/socket send-keys -t jumpserver:0.0 -- "10.246.104.234" Enter',
    },
  });

  expect(result.hiddenOriginalEvent).toBe(true);
  expect(result.block?.target_host).toBe('10.246.104.234');
  expect(result.block?.stage).toBe('sending_target');
});

it('appends a running execution when a real remote command is sent', () => {
  const aggregator = createJumpServerStreamAggregator();
  aggregator.seed({
    type: 'jumpserver_session',
    id: 'jump-1',
    stage: 'target_connected',
    status: 'calling',
    target_host: '10.246.104.234',
    executions: [],
  });

  const result = aggregator.consume({
    type: 'tool_use',
    name: 'Bash',
    toolUseId: 'tool-journalctl',
    input: {
      command: 'tmux -S /tmp/socket send-keys -t jumpserver:0.0 -- "journalctl -n 50" Enter',
    },
  });

  expect(result.hiddenOriginalEvent).toBe(true);
  expect(result.block?.stage).toBe('running_remote_command');
  expect(result.block?.executions).toHaveLength(1);
  expect(result.block?.executions?.[0]).toMatchObject({
    command: 'journalctl -n 50',
    status: 'running',
  });
});
```

- [ ] **Step 3: 写 `capture-pane` 输出刷新与完成判定的失败测试**

继续添加：

```ts
it('updates latest_output and current execution output from capture-pane', () => {
  const aggregator = createJumpServerStreamAggregator();
  aggregator.seed({
    type: 'jumpserver_session',
    id: 'jump-1',
    stage: 'running_remote_command',
    status: 'calling',
    target_host: '10.246.104.234',
    executions: [{ id: 'exec-1', command: 'journalctl -n 50', status: 'running' }],
  });

  const result = aggregator.consume({
    type: 'tool_use',
    name: 'Bash',
    toolUseId: 'tool-capture-1',
    input: {
      command: 'tmux -S /tmp/socket capture-pane -p -J -t jumpserver:0.0 -S -200',
    },
  });

  const afterResult = aggregator.consume({
    type: 'tool_result',
    toolUseId: 'tool-capture-1',
    content: 'Mar 19 kernel: test\\n[user@host ~]$',
    isError: false,
  });

  expect(result.hiddenOriginalEvent).toBe(true);
  expect(afterResult.block?.latest_output).toContain('kernel: test');
  expect(afterResult.block?.executions?.[0]?.output).toContain('kernel: test');
  expect(afterResult.block?.executions?.[0]?.status).toBe('completed');
  expect(afterResult.block?.stage).toBe('target_connected');
});
```

- [ ] **Step 4: 写取消/失败的失败测试**

继续添加：

```ts
it('marks the session and current execution as cancelled', () => {
  const aggregator = createJumpServerStreamAggregator();
  aggregator.seed({
    type: 'jumpserver_session',
    id: 'jump-1',
    stage: 'running_remote_command',
    status: 'calling',
    executions: [{ id: 'exec-1', command: 'journalctl -n 50', status: 'running' }],
  });

  const result = aggregator.cancel();

  expect(result?.stage).toBe('cancelled');
  expect(result?.status).toBe('cancelled');
  expect(result?.executions?.[0]?.status).toBe('cancelled');
});
```

- [ ] **Step 5: 运行测试确认失败**

Run:

```bash
npm test -- src/jumpserver-stream-aggregator.test.ts
```

Expected: FAIL，提示 `createJumpServerStreamAggregator` 或 `consume` / `seed` / `cancel` 未实现。

- [ ] **Step 6: 最小实现聚合器**

在 `src/jumpserver-stream-aggregator.ts` 实现：

```ts
export interface JumpServerExecution {
  id: string;
  command: string;
  status: 'running' | 'completed' | 'error' | 'cancelled';
  output?: string;
  started_at?: string;
  finished_at?: string;
  error_message?: string;
}

export interface JumpServerBlock {
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
}

export interface StreamToolEvent {
  type: 'tool_use' | 'tool_result';
  name?: string;
  toolUseId?: string;
  input?: { command?: string };
  content?: unknown;
  isError?: boolean;
}

export interface ConsumeResult {
  hiddenOriginalEvent: boolean;
  block?: JumpServerBlock;
}

export function createJumpServerStreamAggregator() {
  let block: JumpServerBlock | null = null;
  const pendingToolCommands = new Map<string, string>();

  function seed(next: JumpServerBlock) {
    block = structuredClone(next);
  }

  function consume(event: StreamToolEvent): ConsumeResult {
    // 1. 识别 connect.sh
    // 2. 记录 pending tmux command
    // 3. tool_result 时根据 pending command 更新 block
    // 4. 命中 JumpServer 内部步骤时 hiddenOriginalEvent=true
    return { hiddenOriginalEvent: false, block: block ?? undefined };
  }

  function cancel() {
    // 将 block 和 running execution 转 cancelled
    return block ?? undefined;
  }

  function getBlock() {
    return block ?? undefined;
  }

  return { consume, seed, cancel, getBlock };
}
```

实现要求：

- 只处理单会话
- 用启发式函数拆分：
  - `isJumpServerConnectCommand()`
  - `isTmuxSendKeysCommand()`
  - `isTmuxCapturePaneCommand()`
  - `extractSendKeysPayload()`
  - `looksLikeTargetSelection()`
  - `looksLikeRemoteCommand()`
  - `summarizeTerminalOutput()`
  - `looksLikeRemotePromptRecovered()`
- `tool_result` 与前一个被记录的 `toolUseId` 对应
- `capture-pane` 的 `tool_use` 和 `tool_result` 都应 `hiddenOriginalEvent=true`

- [ ] **Step 7: 运行测试确认通过**

Run:

```bash
npm test -- src/jumpserver-stream-aggregator.test.ts
```

Expected: PASS。

- [ ] **Step 8: Commit**

```bash
git add src/jumpserver-stream-aggregator.ts src/jumpserver-stream-aggregator.test.ts
git commit -m "feat(stream): add jumpserver session aggregator"
```

---

### Task 2: 在 `src/index.ts` 集成聚合器与最终持久化

**Files:**
- Modify: `src/index.ts`
- Modify: `src/server-chat.test.ts`
- Test: `src/jumpserver-stream-aggregator.test.ts`

- [ ] **Step 1: 写 `src/index.ts` 集成的失败测试**

在 `src/server-chat.test.ts` 新增一组最小回归：

```ts
it('broadcasts jumpserver_session events without leaking internal tool_use cards', async () => {
  const promise = collectMessages(wsA, 2);

  broadcastToJid(JID_A, {
    type: 'stream_event',
    event: {
      type: 'jumpserver_session',
      block: {
        type: 'jumpserver_session',
        id: 'jump-1',
        stage: 'running_remote_command',
        target_host: '10.246.104.234',
        executions: [{ id: 'exec-1', command: 'journalctl -n 50', status: 'running' }],
      },
    },
  });
  broadcastToJid(JID_A, {
    type: 'message',
    data: {
      id: randomUUID(),
      chat_jid: JID_A,
      content: JSON.stringify([
        {
          type: 'jumpserver_session',
          id: 'jump-1',
          stage: 'completed',
          target_host: '10.246.104.234',
          executions: [{ id: 'exec-1', command: 'journalctl -n 50', status: 'completed' }],
        },
      ]),
      timestamp: new Date().toISOString(),
    },
  });

  const received = await promise;
  const sessionEvent = received.find(
    (msg: any) => msg.type === 'stream_event' && msg.event?.type === 'jumpserver_session',
  );
  expect(sessionEvent).toBeDefined();
});
```

- [ ] **Step 2: 运行测试确认现状不支持**

Run:

```bash
npm test -- src/server-chat.test.ts
```

Expected: 如果类型/逻辑未接通，相关断言或编译失败。

- [ ] **Step 3: 在 `src/index.ts` 接入聚合器**

在当前 `pendingStreamTools` / `completedStreamTools` 旁新增 JumpServer 聚合状态：

```ts
const jumpServerAggregator = createJumpServerStreamAggregator();
let latestJumpServerBlock: JumpServerBlock | null = null;
```

在流式事件处理中按顺序改造：

1. 先把 SDK 流式事件转成聚合器需要的最小事件结构
2. 调用 `jumpServerAggregator.consume(...)`
3. 若 `consumeResult.block` 存在：
   - 保存到 `latestJumpServerBlock`
   - `channel.streamEvent(chatJid, { type: 'jumpserver_session', block: consumeResult.block })`
4. 若 `consumeResult.hiddenOriginalEvent === true`
   - 不再继续走普通 `tool_use` / `tool_result` 转发与 `pendingStreamTools` 跟踪
5. 非 JumpServer 事件继续走原逻辑

最终结果持久化时改为：

```ts
if (latestJumpServerBlock) {
  const blocks: unknown[] = [latestJumpServerBlock];
  if (cleanText) blocks.push({ type: 'text', text: cleanText });
  finalContent = JSON.stringify(blocks);
}
```

还要处理：

- `result.status === 'error'` 时，若聚合器已有 block，则把 block 转 `error`
- 生成结束或中断时，若 block 仍为 `running_remote_command`，根据中断原因转 `cancelled` 或 `completed`

- [ ] **Step 4: 跑集成测试**

Run:

```bash
npm test -- src/server-chat.test.ts
```

Expected: PASS，且普通 tool 卡回归不坏。

- [ ] **Step 5: 跑后端相关测试**

Run:

```bash
npm test -- src/jumpserver-stream-aggregator.test.ts src/server-chat.test.ts
```

Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add src/index.ts src/server-chat.test.ts
git commit -m "feat(stream): emit jumpserver session events and persist aggregated blocks"
```

---

## Chunk 2: 前端类型与流式合并

### Task 3: 扩展前端类型与消息更新工具

**Files:**
- Modify: `frontend/src/lib/types.ts`
- Modify: `frontend/src/lib/message-utils.ts`

- [ ] **Step 1: 先写 `jumpserver_session` block 的失败测试**

在 `frontend/src/pages/Chat.integration.test.tsx` 现有用例附近新增最小断言：

```ts
await act(async () => {
  socketA1.emitMessage({
    type: 'stream_event',
    chat_jid: 'web:a',
    event: {
      type: 'jumpserver_session',
      block: {
        type: 'jumpserver_session',
        id: 'jump-1',
        stage: 'jumpserver_ready',
        status: 'calling',
        latest_output: 'Opt> 输入目标主机',
        executions: [],
      },
    },
  });
});
await flush();

expect(container.textContent).toContain('JumpServer');
expect(container.textContent).toContain('Opt> 输入目标主机');
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npm test -- frontend/src/pages/Chat.integration.test.tsx
```

Expected: FAIL，`jumpserver_session` 未被识别或未渲染。

- [ ] **Step 3: 更新 `frontend/src/lib/types.ts`**

添加：

```ts
export interface JumpServerExecution {
  id: string;
  command: string;
  status: 'running' | 'completed' | 'error' | 'cancelled';
  output?: string;
  started_at?: string;
  finished_at?: string;
  error_message?: string;
}

export interface JumpServerBlock {
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
}
```

并把它加入 `ContentBlock` 联合。

- [ ] **Step 4: 扩展 `frontend/src/lib/message-utils.ts`**

为 `StreamEvent` 增加：

```ts
block?: ContentBlock;
```

在 `applyEventToBlocks()` 顶部新增：

```ts
if (event.type === 'jumpserver_session' && event.block?.type === 'jumpserver_session') {
  const existingIndex = newBlocks.findIndex(
    (block) => block.type === 'jumpserver_session' && block.id === event.block?.id,
  );
  if (existingIndex !== -1) {
    newBlocks[existingIndex] = event.block;
  } else {
    newBlocks.push(event.block);
  }
  return newBlocks;
}
```

注意补一个兜底：若 `id` 缺失，则按 `block.type === 'jumpserver_session'` 查最后一个同类型块替换。

- [ ] **Step 5: 运行前端集成测试**

Run:

```bash
npm test -- frontend/src/pages/Chat.integration.test.tsx
```

Expected: 至少新断言通过。

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/types.ts frontend/src/lib/message-utils.ts frontend/src/pages/Chat.integration.test.tsx
git commit -m "feat(frontend): add jumpserver session block types and streaming merge"
```

---

### Task 4: 在 WebSocket hook 中接入 JumpServer 专用事件

**Files:**
- Modify: `frontend/src/hooks/useChatWebSocket.ts`
- Modify: `frontend/src/pages/Chat.integration.test.tsx`

- [ ] **Step 1: 写“整轮流式更新只保留一张 JumpServer 卡片”的失败测试**

在 `frontend/src/pages/Chat.integration.test.tsx` 增加：

```ts
await act(async () => {
  socketA1.emitMessage({
    type: 'stream_event',
    chat_jid: 'web:a',
    event: {
      type: 'jumpserver_session',
      block: {
        type: 'jumpserver_session',
        id: 'jump-1',
        stage: 'target_connected',
        target_host: '10.246.104.234',
        executions: [],
      },
    },
  });
  socketA1.emitMessage({
    type: 'stream_event',
    chat_jid: 'web:a',
    event: {
      type: 'jumpserver_session',
      block: {
        type: 'jumpserver_session',
        id: 'jump-1',
        stage: 'running_remote_command',
        target_host: '10.246.104.234',
        executions: [{ id: 'exec-1', command: 'journalctl -n 50', status: 'running' }],
      },
    },
  });
});
await flush();

const messageItems = container.querySelectorAll('[data-testid="message-item"]');
expect(messageItems).toHaveLength(1);
expect(messageItems[0]?.textContent).toContain('10.246.104.234');
expect(messageItems[0]?.textContent).toContain('journalctl -n 50');
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npm test -- frontend/src/pages/Chat.integration.test.tsx
```

Expected: FAIL。

- [ ] **Step 3: 修改 `frontend/src/hooks/useChatWebSocket.ts`**

在 `payload.type === "stream_event"` 分支内：

```ts
if (event.type === 'jumpserver_session') {
  const activeStreamIndex = findActiveStreamIndex(prev);
  if (activeStreamIndex === -1) {
    const newId = 'stream-' + Date.now();
    activeStreamIdRef.current = newId;
    const newMsg: Message = {
      id: newId,
      chat_jid: payload.chat_jid!,
      sender_name: 'CNP-Bot',
      content: JSON.stringify([]),
      timestamp: new Date().toISOString(),
      is_from_me: false,
      is_bot_message: true,
    };
    const updatedBlocks = applyEventToBlocks([], event);
    newMsg.content = JSON.stringify(updatedBlocks);
    return [...prev, newMsg];
  }

  const streamMessage = prev[activeStreamIndex];
  const blocks = parseMessageContent(streamMessage.content);
  const updatedBlocks = applyEventToBlocks(blocks, event);
  const nextMessages = [...prev];
  nextMessages[activeStreamIndex] = {
    ...streamMessage,
    content: JSON.stringify(updatedBlocks),
  };
  return nextMessages;
}
```

同时保持现有 `tool_result`、普通 `stream_event`、最终 `message` 合并逻辑不变。

- [ ] **Step 4: 补“最终 message 替换 stream 时保留 JumpServer block”的断言**

在同测试文件添加：

```ts
expect(mergedText).toContain('journalctl -n 50');
expect(mergedText).toContain('最终文本回复');
```

最终消息 `content` 使用：

```ts
content: JSON.stringify([
  {
    type: 'jumpserver_session',
    id: 'jump-1',
    stage: 'completed',
    target_host: '10.246.104.234',
    executions: [{ id: 'exec-1', command: 'journalctl -n 50', status: 'completed' }],
  },
  { type: 'text', text: '最终文本回复' },
])
```

- [ ] **Step 5: 运行测试确认通过**

Run:

```bash
npm test -- frontend/src/pages/Chat.integration.test.tsx
```

Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add frontend/src/hooks/useChatWebSocket.ts frontend/src/pages/Chat.integration.test.tsx
git commit -m "feat(frontend): handle jumpserver session stream events"
```

---

## Chunk 3: 前端卡片渲染

### Task 5: 新增 `JumpServerSessionCard` 并接入 `MessageItem`

**Files:**
- Create: `frontend/src/components/JumpServerSessionCard.tsx`
- Modify: `frontend/src/components/Chat/MessageItem.tsx`
- Modify: `frontend/src/pages/Chat.integration.test.tsx`

- [ ] **Step 1: 写渲染失败测试**

在 `frontend/src/pages/Chat.integration.test.tsx` 增加最终展示断言：

```ts
expect(container.textContent).toContain('JumpServer 远程会话');
expect(container.textContent).toContain('已连接目标主机');
expect(container.textContent).toContain('10.246.104.234');
expect(container.textContent).toContain('journalctl -n 50');
expect(container.textContent).toContain('最近输出');
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npm test -- frontend/src/pages/Chat.integration.test.tsx
```

Expected: FAIL，组件尚未渲染。

- [ ] **Step 3: 创建 `frontend/src/components/JumpServerSessionCard.tsx`**

最小组件骨架：

```tsx
import type { JumpServerBlock } from '@/lib/types';

function stageLabel(stage: JumpServerBlock['stage'], targetHost?: string) {
  switch (stage) {
    case 'connecting_jumpserver':
      return '正在连接堡垒机';
    case 'jumpserver_ready':
      return '已连接堡垒机';
    case 'sending_target':
      return targetHost ? `正在选择目标主机 ${targetHost}` : '正在选择目标主机';
    case 'target_connecting':
      return targetHost ? `正在连接目标主机 ${targetHost}` : '正在连接目标主机';
    case 'target_connected':
      return targetHost ? `已连接目标主机 ${targetHost}` : '已连接目标主机';
    case 'running_remote_command':
      return '正在执行远端命令';
    case 'completed':
      return '已完成';
    case 'cancelled':
      return '已取消';
    case 'error':
      return '执行失败';
  }
}

export function JumpServerSessionCard({ block }: { block: JumpServerBlock }) {
  const executions = block.executions ?? [];
  return (
    <div className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-4 space-y-3">
      <div>
        <div className="text-sm font-semibold">JumpServer 远程会话</div>
        <div className="text-xs opacity-70">{stageLabel(block.stage, block.target_host)}</div>
      </div>
      {block.jumpserver_host ? <div className="text-xs">堡垒机：{block.jumpserver_host}</div> : null}
      {block.target_host ? <div className="text-xs">目标主机：{block.target_host}</div> : null}
      {block.latest_output ? (
        <div>
          <div className="text-xs font-medium opacity-70">最近输出</div>
          <pre className="mt-1 whitespace-pre-wrap text-xs">{block.latest_output}</pre>
        </div>
      ) : null}
      {executions.length > 0 ? (
        <div className="space-y-2">
          {executions.map((execution) => (
            <div key={execution.id} className="rounded-lg border border-border/60 p-3">
              <div className="text-xs font-medium">{execution.command}</div>
              <div className="text-[11px] opacity-70">{execution.status}</div>
              {execution.output ? <pre className="mt-2 whitespace-pre-wrap text-xs">{execution.output}</pre> : null}
            </div>
          ))}
        </div>
      ) : null}
      {block.error_message ? <div className="text-xs text-red-500">{block.error_message}</div> : null}
    </div>
  );
}
```

- [ ] **Step 4: 修改 `frontend/src/components/Chat/MessageItem.tsx`**

1. 新增导入：

```tsx
import { JumpServerSessionCard } from '@/components/JumpServerSessionCard';
import type { JumpServerBlock } from '@/lib/types';
```

2. `hasVisibleContent` 增加：

```ts
if (block.type === 'jumpserver_session') return true;
```

3. 在渲染分支里加入：

```tsx
if (block.type === 'jumpserver_session') {
  return (
    <JumpServerSessionCard
      key={`jumpserver-${block.id || bIdx}`}
      block={block as JumpServerBlock}
    />
  );
}
```

- [ ] **Step 5: 运行测试确认通过**

Run:

```bash
npm test -- frontend/src/pages/Chat.integration.test.tsx
```

Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/JumpServerSessionCard.tsx frontend/src/components/Chat/MessageItem.tsx frontend/src/pages/Chat.integration.test.tsx
git commit -m "feat(frontend): render jumpserver session card"
```

---

## Chunk 4: 回归与收尾

### Task 6: 做完整回归验证并清理计划外问题

**Files:**
- Modify: `src/jumpserver-stream-aggregator.ts`（如测试暴露小问题）
- Modify: `src/index.ts`（如最终持久化边界需修正）
- Modify: `frontend/src/hooks/useChatWebSocket.ts`（如历史恢复边界需修正）
- Modify: `frontend/src/components/JumpServerSessionCard.tsx`（如空白区域/样式需修正）

- [ ] **Step 1: 跑后端聚合相关测试**

Run:

```bash
npm test -- src/jumpserver-stream-aggregator.test.ts src/server-chat.test.ts
```

Expected: PASS。

- [ ] **Step 2: 跑前端流式/渲染回归**

Run:

```bash
npm test -- frontend/src/pages/Chat.integration.test.tsx frontend/src/hooks/streaming-session-recovery.test.ts
```

Expected: PASS。

- [ ] **Step 3: 跑全量测试**

Run:

```bash
npm test
```

Expected: 全部 PASS。

- [ ] **Step 4: 跑类型检查**

Run:

```bash
npm run typecheck
```

Expected: PASS。

- [ ] **Step 5: 如有需要，修最小回归问题并重跑受影响测试**

修复原则：

- 不扩大范围
- 不重构无关 tmux/tool_use 逻辑
- 只修 JumpServer 聚合相关边界

- [ ] **Step 6: 最终 Commit**

```bash
git add src/index.ts src/jumpserver-stream-aggregator.ts src/jumpserver-stream-aggregator.test.ts src/server-chat.test.ts frontend/src/lib/types.ts frontend/src/lib/message-utils.ts frontend/src/hooks/useChatWebSocket.ts frontend/src/components/JumpServerSessionCard.tsx frontend/src/components/Chat/MessageItem.tsx frontend/src/pages/Chat.integration.test.tsx
git commit -m "feat: add aggregated jumpserver session card"
```

---

## Notes for the Implementer

- `jumpserver_session` 是 v1 的专用事件与专用 block，不要尝试抽象成通用 tmux session 框架
- 不要在前端猜测 `tmux send-keys` 的语义；语义识别全部留在后端
- 保持普通 Bash / 普通 tmux 的现有工具卡片逻辑不变
- `latest_output` 与每条 execution 的 `output` 必须继续走脱敏摘要，而不是原始全量终端输出
- 最终无 assistant 文本时，仍然要持久化 JumpServer 卡片

---

## Plan Review

本会话受限于当前协作约束，未自动派发 plan-review 子代理；执行前应至少再做一次人工核对，重点检查：

- `src/index.ts` 是否已有更适合接入聚合器的 helper 可复用
- `tool_result` 与 `capture-pane` 的映射是否能稳定拿到原始命令
- 前端最终消息替换 streaming message 时是否会错误丢失 `jumpserver_session`
- 测试命令是否与当前仓库的 Vitest 配置兼容

