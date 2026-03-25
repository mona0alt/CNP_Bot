# Deepagent JumpServer 卡片修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 deepagent 与 claude 一样生成并展示 JumpServer 会话卡片，同时保留前端对内部 jumpserver/tmux Bash 卡片的隐藏策略。

**Architecture:** 在后端统一 deepagent 与 claude 的 JumpServer 事件聚合路径：deepagent 的 `content_block_start` / `tool_result` 流事件也交给 `jumpServerAggregator` 处理，并在识别到 JumpServer/tmux 相关 Bash 时发出 `jumpserver_session`。前端仅补充 deepagent `text_delta.text` 字段兼容，不改变现有卡片渲染和隐藏策略。

**Tech Stack:** Node.js, TypeScript, Vitest, React

---

### Task 1: 后端 deepagent JumpServer 聚合回归测试

**Files:**
- Modify: `src/index.ts`
- Test: `src/index.test.ts` 或新增 `src/deepagent-jumpserver-stream.test.ts`

- [ ] **Step 1: 写失败测试**
  - 构造 deepagent 流事件：`content_block_start(Bash + jumpserver command)` + `tool_result`
  - 断言会触发 `jumpserver_session` 事件，而不是仅透传原始 tool 事件

- [ ] **Step 2: 运行测试确认失败**
  - Run: `npm test -- src/index.test.ts`

- [ ] **Step 3: 最小实现**
  - 抽出/复用 JumpServer 事件处理逻辑，让 deepagent 分支也走聚合器

- [ ] **Step 4: 运行测试确认通过**
  - Run: `npm test -- src/index.test.ts`

### Task 2: 前端 deepagent text_delta 兼容测试

**Files:**
- Modify: `frontend/src/lib/message-utils.ts`
- Test: 新增 `frontend/src/lib/message-utils.test.ts`

- [ ] **Step 1: 写失败测试**
  - deepagent `text_delta` 事件使用顶层 `text`
  - 断言能生成文本 block

- [ ] **Step 2: 运行测试确认失败**
  - Run: `npm test -- frontend/src/lib/message-utils.test.ts`

- [ ] **Step 3: 最小实现**
  - 兼容读取 `event.text` 与旧的 `event.delta.text`

- [ ] **Step 4: 运行测试确认通过**
  - Run: `npm test -- frontend/src/lib/message-utils.test.ts`

### Task 3: 集成回归验证

**Files:**
- Modify: `src/index.ts`
- Modify: `frontend/src/lib/message-utils.ts`
- Test: `src/jumpserver-stream-aggregator.test.ts`, `frontend/src/pages/Chat.integration.test.tsx`（如需）

- [ ] **Step 1: 运行聚合相关测试**
  - Run: `npm test -- src/jumpserver-stream-aggregator.test.ts`

- [ ] **Step 2: 运行本次新增/修改测试集合**
  - Run: `npm test -- src/index.test.ts frontend/src/lib/message-utils.test.ts`

- [ ] **Step 3: 如有必要补一条前端集成测试**
  - 验证 deepagent jumpserver_session 到消息块的转换

- [ ] **Step 4: 最终验证**
  - Run: `npm test -- src/index.test.ts src/jumpserver-stream-aggregator.test.ts frontend/src/lib/message-utils.test.ts`
