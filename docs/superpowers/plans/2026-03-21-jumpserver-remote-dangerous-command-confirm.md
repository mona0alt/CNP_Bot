# JumpServer 远端高危命令确认 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 agent 通过 JumpServer `run-remote-command.sh` 执行高危远端命令前，复用现有 `confirm_bash` 链路向前端发起确认，并在卡片中展示“目标主机”。

**Architecture:** 在 `container/agent-runner` 新增一个专门解析 JumpServer 远端命令的轻量模块，只负责识别 `run-remote-command.sh`、提取真实远端命令与目标主机。危险命令 Hook 继续复用 `dangerous-commands.ts` 和 `cnp-confirm`，仅把确认对象从“包装脚本命令”替换为“真实远端命令”，并在 host / websocket / frontend 透传一个可选的 `targetHost` 字段。

**Tech Stack:** TypeScript、Node.js、Vitest、React、WebSocket、Bash helper (`cnp-confirm`)

---

## File Structure

| 文件 | 作用 |
|------|------|
| `container/agent-runner/src/jumpserver-dangerous-command.ts` | 新增：识别 `run-remote-command.sh`，提取 `remoteCommand` / `targetHost` |
| `src/jumpserver-dangerous-command.test.ts` | 新增：覆盖参数解析与边界情况 |
| `container/agent-runner/src/index.ts` | 修改：在危险命令 Hook 中接入 JumpServer 远端命令分支 |
| `src/dangerous-commands.test.ts` | 修改：补充“真实远端命令复用原危险规则”的回归测试（如需要） |
| `container/scripts/cnp-confirm` | 修改：支持可选第 3 个参数 `targetHost` 并写入 JSON |
| `src/confirm-bash.test.ts` | 修改：验证 helper 会写出 `targetHost`，且兼容旧调用方式 |
| `src/ipc.ts` | 修改：`IpcConfirmRequest` 新增 `targetHost?: string`，watcher / loader 继续透传 |
| `src/ipc-confirm-bash.test.ts` | 修改：验证 `confirm_requests` 读取到 `targetHost` |
| `src/index.ts` | 修改：pending confirm、实时广播、重连恢复都透传 `targetHost` |
| `src/server.ts` | 修改：WebSocket ready 补发 `confirm_bash` 时透传 `targetHost` |
| `src/server-confirm-bash.test.ts` | 修改：验证 WebSocket 侧兼容/透传 |
| `frontend/src/lib/interactive-events.ts` | 修改：`ConfirmBashRequest` 新增 `targetHost?: string` |
| `frontend/src/components/ConfirmBashCard.tsx` | 修改：复用卡片，新增“目标主机”展示 |
| `src/frontend-confirm-event.test.ts` | 修改：验证 `targetHost` 解析和缺省展示逻辑 |
| `frontend/src/pages/Chat.integration.test.tsx` 或 `frontend/src/components/ConfirmBashCard.test.tsx` | 修改/新增：验证卡片渲染“目标主机” |

---

### Task 1: 新增 JumpServer 远端命令解析模块

**Files:**
- Create: `container/agent-runner/src/jumpserver-dangerous-command.ts`
- Create: `src/jumpserver-dangerous-command.test.ts`

- [ ] **Step 1: 先写解析失败测试与正常测试**

```ts
import { describe, expect, it } from 'vitest';

import {
  isJumpServerRunRemoteCommand,
  parseJumpServerRunRemoteCommand,
} from '../container/agent-runner/src/jumpserver-dangerous-command.js';

describe('jumpserver dangerous command parsing', () => {
  it('识别 run-remote-command.sh 并提取真实远端命令和目标主机', () => {
    expect(
      parseJumpServerRunRemoteCommand(
        'bash /home/node/.claude/skills/jumpserver/scripts/run-remote-command.sh "rm -rf /tmp/a" 60 10.1.2.3',
      ),
    ).toEqual({
      remoteCommand: 'rm -rf /tmp/a',
      targetHost: '10.1.2.3',
    });
  });

  it('未传目标主机时只返回真实远端命令', () => {
    expect(
      parseJumpServerRunRemoteCommand(
        'bash /home/node/.claude/skills/jumpserver/scripts/run-remote-command.sh "git reset --hard HEAD~1" 60',
      ),
    ).toEqual({
      remoteCommand: 'git reset --hard HEAD~1',
      targetHost: undefined,
    });
  });

  it('非 run-remote-command.sh 调用不应识别', () => {
    expect(isJumpServerRunRemoteCommand('bash /tmp/other.sh')).toBe(false);
    expect(parseJumpServerRunRemoteCommand('bash /tmp/other.sh')).toEqual({});
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/jumpserver-dangerous-command.test.ts`
Expected: FAIL，提示模块不存在或导出缺失。

- [ ] **Step 3: 写最小实现**

```ts
function extractFirstShellWord(input: string): string | undefined {
  const text = input.trimStart();
  if (!text) return undefined;
  if (text[0] === '"' || text[0] === "'") {
    const quote = text[0];
    let value = '';
    for (let i = 1; i < text.length; i += 1) {
      const ch = text[i];
      if (ch === '\\' && i + 1 < text.length) {
        value += text[i + 1];
        i += 1;
        continue;
      }
      if (ch === quote) return value;
      value += ch;
    }
    return undefined;
  }
  return text.split(/\s+/)[0] || undefined;
}

export function isJumpServerRunRemoteCommand(command: string): boolean {
  return /(?:^|\s)(?:bash\s+)?[^\s]*jumpserver\/scripts\/run-remote-command\.sh(?:\s|$)/.test(command);
}

export function parseJumpServerRunRemoteCommand(command: string): {
  remoteCommand?: string;
  targetHost?: string;
} {
  if (!isJumpServerRunRemoteCommand(command)) return {};
  const tail = command.replace(/^.*?run-remote-command\.sh(?:\s|$)/, '');
  const remoteCommand = extractFirstShellWord(tail);
  if (!remoteCommand) return {};
  const rest = tail.trimStart().slice(tail.trimStart().startsWith('"') || tail.trimStart().startsWith("'") ? remoteCommand.length + 2 : remoteCommand.length).trimStart();
  const tokens = rest.split(/\s+/).filter(Boolean);
  const targetHost = tokens.length >= 2 ? tokens[1] : undefined;
  return { remoteCommand, targetHost };
}
```

实现时允许把“取首个 shell 参数”的逻辑写成更稳妥的小函数；不要在这里引入危险命令判断。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- src/jumpserver-dangerous-command.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交解析模块**

```bash
git add container/agent-runner/src/jumpserver-dangerous-command.ts src/jumpserver-dangerous-command.test.ts
git commit -m "feat(agent-runner): parse jumpserver remote commands"
```

---

### Task 2: 在危险命令 Hook 中接入 JumpServer 远端命令确认

**Files:**
- Modify: `container/agent-runner/src/index.ts`
- Modify: `src/dangerous-commands.test.ts`
- Modify: `src/jumpserver-dangerous-command.test.ts`

- [ ] **Step 1: 先补充 Hook 侧行为测试设计点**

在现有测试文件中增加至少这些断言：

```ts
expect(findDangerousCommandReason('rm -rf /tmp/test')).toContain('删除');
expect(findDangerousCommandReason('git reset --hard HEAD~1')).toContain('Git 历史');
```

并在 `src/jumpserver-dangerous-command.test.ts` 增加：

```ts
it('提取到的远端命令可直接复用危险命令规则', () => {
  const parsed = parseJumpServerRunRemoteCommand(
    'bash /home/node/.claude/skills/jumpserver/scripts/run-remote-command.sh "rm -rf /tmp/a" 60 10.1.2.3',
  );

  expect(parsed.remoteCommand).toBe('rm -rf /tmp/a');
  expect(findDangerousCommandReason(parsed.remoteCommand!)).toBeTruthy();
});
```

- [ ] **Step 2: 运行测试确认当前能力不足**

Run: `npm test -- src/dangerous-commands.test.ts src/jumpserver-dangerous-command.test.ts`
Expected: FAIL 或至少缺少新断言覆盖。

- [ ] **Step 3: 修改 `createDangerousCommandHook()` 的最小实现**

在 `container/agent-runner/src/index.ts` 中把现有：

```ts
const reason = findDangerousCommandReason(command);
if (!reason) return {};
```

改成类似：

```ts
import {
  isJumpServerRunRemoteCommand,
  parseJumpServerRunRemoteCommand,
} from './jumpserver-dangerous-command.js';

const parsedRemote = isJumpServerRunRemoteCommand(command)
  ? parseJumpServerRunRemoteCommand(command)
  : null;

const confirmCommand = parsedRemote?.remoteCommand ?? command;
const targetHost = parsedRemote?.targetHost;
const reason = findDangerousCommandReason(confirmCommand);
if (!reason) return {};
```

并把拒绝/失败提示文案改成区分本地与远端：

```ts
const targetHostLabel = targetHost ?? '未知目标主机';
const scopeLabel = parsedRemote?.remoteCommand
  ? `远端危险命令（目标主机：${targetHostLabel}）`
  : '危险命令';
```

要求：
- 只有成功解析出 `remoteCommand` 时，才把它视为远端确认对象
- 若命中 `run-remote-command.sh` 但解析失败，应直接 `return {}`，不要退回检查包装脚本，避免与 spec 偏离
- 非 `run-remote-command.sh` 场景才继续按原始 `command` 判断
- 传给 `cnp-confirm` 的 `command` 必须是 `confirmCommand`

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- src/dangerous-commands.test.ts src/jumpserver-dangerous-command.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交 Hook 集成**

```bash
git add container/agent-runner/src/index.ts src/dangerous-commands.test.ts src/jumpserver-dangerous-command.test.ts
git commit -m "feat(agent-runner): confirm dangerous jumpserver commands"
```

---

### Task 3: 扩展 confirm helper 与 host IPC，透传 `targetHost`

**Files:**
- Modify: `container/scripts/cnp-confirm`
- Modify: `src/confirm-bash.test.ts`
- Modify: `src/ipc.ts`
- Modify: `src/ipc-confirm-bash.test.ts`
- Modify: `src/index.ts`
- Modify: `src/server.ts`
- Modify: `src/server-confirm-bash.test.ts`（先取消 `describe.skip`，或改成非跳过的 focused suite）

- [ ] **Step 1: 先写 helper / IPC / server 的失败测试**

在 `src/confirm-bash.test.ts` 增加：

```ts
const child = spawn(
  'bash',
  [script, 'rm -rf /tmp/cnp-danger-test', '递归强制删除文件', '10.1.2.3'],
  { env: { ...process.env, IPC_DIR: ipcDir, CNP_BOT_CHAT_JID: 'web:test-confirm' } },
);

expect(request).toMatchObject({
  type: 'confirm_bash',
  command: 'rm -rf /tmp/cnp-danger-test',
  reason: '递归强制删除文件',
  targetHost: '10.1.2.3',
});
```

在 `src/ipc-confirm-bash.test.ts` 增加：

```ts
expect(req.targetHost).toBe('10.1.2.3');
```

在 `src/server-confirm-bash.test.ts` 中先移除 `describe.skip`，再增加 websocket payload 断言：

```ts
expect(parsedMessage).toMatchObject({
  type: 'confirm_bash',
  chat_jid: 'web:interactive-session',
  command: 'rm -rf /tmp/cnp-danger-test',
  targetHost: '10.1.2.3',
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/confirm-bash.test.ts src/ipc-confirm-bash.test.ts src/server-confirm-bash.test.ts`
Expected: FAIL，提示 `targetHost` 未写入或未透传。

- [ ] **Step 3: 写最小实现**

`container/scripts/cnp-confirm` 改为支持可选第三个参数：

```bash
TARGET_HOST="${3:-}"
TARGET_HOST_ESC="$(escape_json "$TARGET_HOST")"

if [[ -n "$TARGET_HOST" ]]; then
  printf '{"type":"confirm_bash","requestId":"%s","chatJid":"%s","command":"%s","reason":"%s","targetHost":"%s"}' \
    "$REQUEST_ID" "$JID_ESC" "$CMD_ESC" "$REASON_ESC" "$TARGET_HOST_ESC" > "$REQUEST_TMP_FILE"
else
  printf '{"type":"confirm_bash","requestId":"%s","chatJid":"%s","command":"%s","reason":"%s"}' \
    "$REQUEST_ID" "$JID_ESC" "$CMD_ESC" "$REASON_ESC" > "$REQUEST_TMP_FILE"
fi
```

`src/ipc.ts`：

```ts
export interface IpcConfirmRequest {
  type: 'confirm_bash';
  requestId: string;
  command: string;
  reason?: string;
  targetHost?: string;
  chatJid?: string;
}
```

`src/index.ts` / `src/server.ts` 的广播都补上：

```ts
targetHost: req.targetHost,
```

要求：
- `targetHost` 必须是可选字段
- 不改 ack 协议
- 不改 `writeConfirmResponse()` 的响应文件格式

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- src/confirm-bash.test.ts src/ipc-confirm-bash.test.ts src/server-confirm-bash.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交 helper / host 透传**

```bash
git add container/scripts/cnp-confirm src/confirm-bash.test.ts src/ipc.ts src/ipc-confirm-bash.test.ts src/index.ts src/server.ts src/server-confirm-bash.test.ts
git commit -m "feat(confirm): carry target host for jumpserver commands"
```

---

### Task 4: 前端复用确认卡片并显示“目标主机”

**Files:**
- Modify: `frontend/src/lib/interactive-events.ts`
- Modify: `frontend/src/components/ConfirmBashCard.tsx`
- Modify: `src/frontend-confirm-event.test.ts`
- Modify or Create: `frontend/src/components/ConfirmBashCard.test.tsx`

- [ ] **Step 1: 先写前端解析与渲染失败测试**

在 `src/frontend-confirm-event.test.ts` 增加：

```ts
expect(
  extractConfirmBashRequest(
    {
      type: 'confirm_bash',
      chat_jid: 'web:test',
      requestId: 'req-remote-1',
      command: 'rm -rf /tmp/cnp-danger-test',
      reason: '递归强制删除文件',
      targetHost: '10.1.2.3',
    },
    'web:test',
  ),
).toEqual({
  requestId: 'req-remote-1',
  command: 'rm -rf /tmp/cnp-danger-test',
  reason: '递归强制删除文件',
  targetHost: '10.1.2.3',
});
```

如新增组件测试，请沿用现有 `react-dom/client` + jsdom 模式，断言：

```tsx
// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';

const container = document.createElement('div');
document.body.appendChild(container);
const root = createRoot(container);

await act(async () => {
  root.render(
    <ConfirmBashCard
      request={{
        requestId: 'req-1',
        command: 'rm -rf /tmp/cnp-danger-test',
        reason: '递归强制删除文件',
        targetHost: '10.1.2.3',
      }}
      onRespond={() => {}}
    />,
  );
});

expect(container.textContent).toContain('目标主机');
expect(container.textContent).toContain('10.1.2.3');
```

再补一个缺省场景：

```tsx
expect(container.textContent).toContain('未知目标主机');
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/frontend-confirm-event.test.ts frontend/src/components/ConfirmBashCard.test.tsx`
Expected: FAIL，提示 `targetHost` 未解析或未渲染。

- [ ] **Step 3: 写最小实现**

`frontend/src/lib/interactive-events.ts`：

```ts
export interface ConfirmBashRequest {
  requestId: string;
  command: string;
  reason: string;
  targetHost?: string;
  responded?: boolean;
  approved?: boolean;
  submitting?: boolean;
}

interface ConfirmBashPayload {
  type?: string;
  chat_jid?: string;
  requestId?: string;
  command?: string;
  reason?: string;
  targetHost?: string;
}
```

解析时补上：

```ts
targetHost: payload.targetHost,
```

`frontend/src/components/ConfirmBashCard.tsx` 在“风险原因”块后新增：

```tsx
<div className="rounded-xl bg-muted/40 px-3 py-2">
  <p className="text-xs font-medium text-muted-foreground">目标主机</p>
  <p className="mt-1 text-sm text-foreground/90">
    {request.targetHost || '未知目标主机'}
  </p>
</div>
```

要求：
- 文案必须统一为“目标主机”
- 不新建新的事件类型或卡片类型
- 不改变按钮和 ack 逻辑

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- src/frontend-confirm-event.test.ts frontend/src/components/ConfirmBashCard.test.tsx`
Expected: PASS。

- [ ] **Step 5: 提交前端展示**

```bash
git add frontend/src/lib/interactive-events.ts frontend/src/components/ConfirmBashCard.tsx src/frontend-confirm-event.test.ts frontend/src/components/ConfirmBashCard.test.tsx
git commit -m "feat(frontend): show target host in confirm bash card"
```

---

### Task 5: 端到端回归与收尾

**Files:**
- Modify: `container/agent-runner/src/index.ts`（如回归暴露文案或参数拼接问题）
- Modify: `src/index.ts` / `src/server.ts` / `frontend/src/lib/interactive-events.ts`（仅在必要时）

- [ ] **Step 1: 运行核心回归测试**

Run:

```bash
npm test -- src/jumpserver-dangerous-command.test.ts src/dangerous-commands.test.ts src/confirm-bash.test.ts src/ipc-confirm-bash.test.ts src/frontend-confirm-event.test.ts src/server-confirm-bash.test.ts frontend/src/components/ConfirmBashCard.test.tsx
```

Expected: 全部 PASS。

- [ ] **Step 2: 运行类型检查**

Run: `npm run typecheck`
Expected: PASS，无 TypeScript 错误。

- [ ] **Step 3: 如有必要做一次全量测试**

Run: `npm test`
Expected: PASS；若存在历史跳过用例，确认本次未引入新失败。

- [ ] **Step 4: 检查最终 diff，确认没有偏离设计**

Run:

```bash
git diff --stat
git diff -- container/agent-runner/src/index.ts container/scripts/cnp-confirm src/ipc.ts src/index.ts src/server.ts frontend/src/lib/interactive-events.ts frontend/src/components/ConfirmBashCard.tsx
```

Expected: 只包含 spec 中定义的解析、透传、展示改动；没有新协议、没有重复危险命令名单。

- [ ] **Step 5: 提交最终整合**

```bash
git add container/agent-runner/src/index.ts container/scripts/cnp-confirm src/ipc.ts src/index.ts src/server.ts frontend/src/lib/interactive-events.ts frontend/src/components/ConfirmBashCard.tsx src/jumpserver-dangerous-command.test.ts src/dangerous-commands.test.ts src/confirm-bash.test.ts src/ipc-confirm-bash.test.ts src/frontend-confirm-event.test.ts src/server-confirm-bash.test.ts frontend/src/components/ConfirmBashCard.test.tsx
git commit -m "feat: confirm dangerous jumpserver remote commands"
```

---

## Implementation Notes

- 远端高危命令确认的判断对象必须是 `run-remote-command.sh` 里的**真实远端命令**，不能把包装脚本整条展示给用户。
- `targetHost` 是增强字段，不允许破坏现有本地 `confirm_bash` 流程。
- 若未显式传目标 IP，允许 `targetHost` 缺省；前端统一展示 `未知目标主机`。
- 不要复制 `DANGEROUS_PATTERNS` 到任何新文件。
- 如果在实现中发现 `container/agent-runner/src/index.ts` 继续膨胀，可只提取“远端命令识别”和“确认上下文拼装”两个小函数，不要做无关重构。
