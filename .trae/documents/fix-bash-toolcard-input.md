# 修复 Bash ToolCard Input 为空的问题

## 问题分析

经过深入代码分析，发现问题出在**后端** `src/index.ts`，而不是前端。

### 问题根源

Claude Agent SDK 在调用工具时采用流式传输：
1. 发送 `content_block_start` 事件，tool_use 的 input **可能为空** `{}`
2. 发送多个 `content_block_delta` 事件，delta 类型为 `input_json_delta`，包含实际的 JSON 数据

**后端代码只处理了 `content_block_start`，没有处理 `content_block_delta` 事件！**

查看 `/root/project/CNP_BOT/CNP_Bot/src/index.ts` 第 262-282 行：
```typescript
if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
  pendingToolBlocks.push({
    type: 'tool_use',
    id: event.content_block.id,
    name: event.content_block.name,
    input: event.content_block.input,  // 这里是空的！
    status: 'calling'
  });
} else if (event.type === 'tool_result') {
  // ...处理 tool_result
}
```

由于没有处理 `content_block_delta`，tool_use 的 input 始终是空的 `{}`。

### 前端问题（次要）

即使后端修复，前端 `MessageList.tsx` 第 76-83 行也需要处理空对象的情况：
```typescript
let inputObj = block.input || {};
if (!block.input && block.partial_json) {  // {} 是 truthy，不会进入这个分支
  // ...
}
```

## 修复方案

### 1. 修复后端 `/root/project/CNP_BOT/CNP_Bot/src/index.ts`

在处理 `content_block_start` 后，添加对 `content_block_delta` 事件的处理，特别是 `input_json_delta` 类型的 delta，累积 partial_json 数据。

### 2. 修复前端 `/root/project/CNP_BOT/CNP_Bot/frontend/src/components/Chat/MessageList.tsx`

将条件从 `!block.input` 改为检测空对象 `Object.keys(block.input).length === 0`，以便在 input 为空对象时也能从 partial_json 解析。

## 实现步骤

1. **修改后端** `/root/project/CNP_BOT/CNP_Bot/src/index.ts`
   - 在 `content_block_start` 处理后添加 `content_block_delta` 的处理逻辑
   - 累积 `input_json_delta` 类型的 partial_json 数据
   - 当收到 `content_block_stop` 事件时，解析 partial_json 并更新 pendingToolBlocks

2. **修改前端** `/root/project/CNP_BOT/CNP_Bot/frontend/src/components/Chat/MessageList.tsx`
   - 修改条件判断，处理空对象 `{}` 的情况
