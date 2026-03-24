# JumpServer 长期诊断日志 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 JumpServer 远程执行链路增加默认关闭、按 `JUMPSERVER_DEBUG=1` 启用的长期诊断日志，覆盖 shell 脚本内部阶段与 Node 应用层工具汇总，不写入 SQLite。

**Architecture:** 保持现有 JumpServer 行为与消息协议不变，只在 shell 脚本与应用日志层补充 debug 埋点。shell 层负责连接、切换、等待 prompt、重试等细粒度阶段日志；Node 层通过一个新的轻量诊断模块统一控制 debug 开关与日志格式，在 `src/index.ts` 中记录 tool 调用起止、stage 变化和 execution 汇总。

**Tech Stack:** Bash、tmux、Node.js、Pino logger、Vitest、child_process `spawnSync`

---

## 文件结构

- 修改：`container/skills/jumpserver/scripts/connect-and-enter-target.sh`
  - 增加 `JUMPSERVER_DEBUG` 控制的单行结构化 debug 日志
  - 为连接 JumpServer、切换目标、等待目标 prompt 等关键阶段打点
- 修改：`container/skills/jumpserver/scripts/run-remote-command.sh`
  - 增加当前目标判断、远端命令等待、超时、重试等阶段 debug 日志
- 修改：`src/jumpserver-shell-scripts.test.ts`
  - 扩展黑盒测试，覆盖 debug 开关开启/关闭、阶段日志、重试日志
- 新增：`src/jumpserver-diagnostic-logging.ts`
  - 封装 Node 层 JumpServer debug 开关、字段拼装与 logger 调用
- 新增：`src/jumpserver-diagnostic-logging.test.ts`
  - 用 mock logger 验证开关逻辑、摘要字段与日志事件
- 修改：`src/index.ts`
  - 接入新的 Node 诊断模块，记录 tool start/done、stage delta、execution summary
- 修改：`.env.example`
  - 补充 `JUMPSERVER_DEBUG=0`
- 修改：`container/skills/jumpserver/README.md`
  - 记录诊断开关用途、输出边界与建议用法

---

### Task 1: 先把 shell 诊断日志需求写成失败测试

**Files:**
- Modify: `src/jumpserver-shell-scripts.test.ts`
- Test: `src/jumpserver-shell-scripts.test.ts`

- [ ] **Step 1: 写失败测试，验证默认不开 `JUMPSERVER_DEBUG` 时不输出 `JUMP_DEBUG`**

```ts
it('默认不开 debug 时 shell 脚本不输出 JUMP_DEBUG', () => {
  const result = spawnSync('bash', [scriptPath, 'uname -a', '1', '10.246.104.234'], {
    env: { ...env, MOCK_TMUX_HAS_SESSION: '1' },
    encoding: 'utf8',
  });

  expect(result.stderr).not.toContain('JUMP_DEBUG');
});
```

- [ ] **Step 2: 写失败测试，验证 `connect-and-enter-target.sh` 开启 debug 后输出关键阶段**

```ts
it('connect-and-enter-target.sh 开启 debug 后输出阶段日志', () => {
  const result = spawnSync('bash', [scriptPath, '10.246.104.234'], {
    env: { ...env, JUMPSERVER_DEBUG: '1', MOCK_TMUX_HAS_SESSION: '1', MOCK_TMUX_PANE_COMMAND: 'ssh', MOCK_CAPTURE_MODE: 'connect-flow', MOCK_TARGET_IP: '10.246.104.234' },
    encoding: 'utf8',
  });

  expect(result.stderr).toContain('JUMP_DEBUG script=connect-and-enter-target phase=script_start');
  expect(result.stderr).toContain('phase=wait_target_prompt_start');
  expect(result.stderr).toContain('phase=wait_target_prompt_done');
});
```

- [ ] **Step 3: 写失败测试，验证 `run-remote-command.sh` 开启 debug 后输出复用/等待/完成日志**

```ts
it('run-remote-command.sh 开启 debug 后输出远端执行阶段日志', () => {
  const result = spawnSync('bash', [scriptPath, 'uname -a', '1', '10.246.104.234'], {
    env: { ...env, JUMPSERVER_DEBUG: '1', MOCK_TMUX_HAS_SESSION: '1', MOCK_CAPTURE_MODE: 'same-target-prompt-without-ip' },
    encoding: 'utf8',
  });

  expect(result.stderr).toContain('phase=check_current_target');
  expect(result.stderr).toContain('phase=remote_command_send');
  expect(result.stderr).toContain('phase=wait_remote_prompt_done');
});
```

- [ ] **Step 4: 写失败测试，验证失败重试路径会记录 `retry_after_failure`**

```ts
it('直接执行失败并重试时输出 retry_after_failure', () => {
  const result = spawnSync('bash', [scriptPath, 'uname -a', '1', '10.246.104.234'], {
    env: { ...env, JUMPSERVER_DEBUG: '1', MOCK_TMUX_HAS_SESSION: '1', MOCK_CAPTURE_MODE: 'remote-fail-once', MOCK_REMOTE_CMD_MATCH: 'uname -a' },
    encoding: 'utf8',
  });

  expect(result.stderr).toContain('phase=retry_after_failure');
});
```

- [ ] **Step 5: 运行测试，确认新增 case 先失败**

Run: `npm test -- src/jumpserver-shell-scripts.test.ts`  
Expected: FAIL，提示缺少 `JUMP_DEBUG` 日志或阶段字段

- [ ] **Step 6: 提交失败测试**

```bash
git add src/jumpserver-shell-scripts.test.ts
git commit -m "test: cover jumpserver diagnostic shell logs"
```

---

### Task 2: 在 `connect-and-enter-target.sh` 中实现长期诊断日志

**Files:**
- Modify: `container/skills/jumpserver/scripts/connect-and-enter-target.sh`
- Test: `src/jumpserver-shell-scripts.test.ts`

- [ ] **Step 1: 增加最小 debug helper**

在脚本顶部加入：

```bash
jump_debug_enabled() {
  [[ "${JUMPSERVER_DEBUG:-0}" == "1" ]]
}

now_ms() {
  python3 - <<'PY'
import time
print(int(time.time() * 1000))
PY
}

jump_debug() {
  jump_debug_enabled || return 0
  printf 'JUMP_DEBUG script=connect-and-enter-target %s\n' "$*" >&2
}
```

- [ ] **Step 2: 为 script 生命周期加日志**

至少补这些日志点：

```bash
jump_debug "phase=script_start target=$TARGET_IP"
jump_debug "phase=detect_current_pane_state pane_command=$current_cmd"
jump_debug "phase=script_done result=success target=$TARGET_IP elapsed_ms=$total_ms"
```

- [ ] **Step 3: 为等待 JumpServer 菜单与等待目标 prompt 打点**

把等待逻辑拆成可计时片段：

```bash
wait_begin_ms="$(now_ms)"
jump_debug "phase=wait_target_prompt_start target=$TARGET_IP timeout_s=$CONNECT_TIMEOUT"
...
jump_debug "phase=wait_target_prompt_done target=$TARGET_IP elapsed_ms=$(( $(now_ms) - wait_begin_ms )) match_hint=shell_prompt"
```

失败分支输出：

```bash
jump_debug "phase=target_connect_failed target=$TARGET_IP reason=returned_to_menu elapsed_ms=$elapsed"
```

- [ ] **Step 4: 为切换旧目标与连接 JumpServer 补日志**

覆盖：
- `exit_current_target_start`
- `exit_current_target_done`
- `connect_jumpserver_start`
- `connect_jumpserver_done`
- `send_target_start`
- `send_target_done`

- [ ] **Step 5: 跑 shell 单测，确认 `connect-and-enter-target.sh` 相关日志测试通过**

Run: `npm test -- src/jumpserver-shell-scripts.test.ts -t "connect-and-enter-target.sh"`
Expected: PASS

- [ ] **Step 6: 提交脚本埋点**

```bash
git add container/skills/jumpserver/scripts/connect-and-enter-target.sh src/jumpserver-shell-scripts.test.ts
git commit -m "feat: add jumpserver connect diagnostic logs"
```

---

### Task 3: 在 `run-remote-command.sh` 中实现长期诊断日志

**Files:**
- Modify: `container/skills/jumpserver/scripts/run-remote-command.sh`
- Test: `src/jumpserver-shell-scripts.test.ts`

- [ ] **Step 1: 增加与执行脚本对应的 debug helper**

```bash
jump_debug() {
  [[ "${JUMPSERVER_DEBUG:-0}" == "1" ]] || return 0
  printf 'JUMP_DEBUG script=run-remote-command %s\n' "$*" >&2
}
```

- [ ] **Step 2: 为当前目标判断与连接保障加日志**

```bash
jump_debug "phase=script_start target=$TARGET_IP command=$REMOTE_CMD timeout_s=$TIMEOUT"
jump_debug "phase=check_current_target current_target=$current_target target=$TARGET_IP"
jump_debug "phase=ensure_target_connection_start current_target=$current_target target=$TARGET_IP"
jump_debug "phase=ensure_target_connection_done target=$TARGET_IP result=reused"
```

要求：
- 命中复用时 `result=reused`
- 触发连接时 `result=reconnected`

- [ ] **Step 3: 为远端命令发送、等待、超时打日志**

```bash
jump_debug "phase=remote_command_send attempt=$attempt target=$TARGET_IP command=$REMOTE_CMD"
jump_debug "phase=wait_remote_prompt_start attempt=$attempt timeout_s=$TIMEOUT"
...
jump_debug "phase=wait_remote_prompt_done attempt=$attempt elapsed_ms=$elapsed match_hint=shell_prompt"
```

超时分支：

```bash
jump_debug "phase=remote_command_timeout attempt=$attempt elapsed_ms=$elapsed reason=prompt_not_seen"
```

- [ ] **Step 4: 为失败重试路径加日志**

在清理 `current_target` 和重连前记录：

```bash
jump_debug "phase=retry_after_failure attempt=1 retry=1 target=$TARGET_IP reason=run_once_failed"
```

第二次成功或失败都要在 `script_done` 中反映：

```bash
jump_debug "phase=script_done result=success attempt=2 elapsed_ms=$total_ms"
```

- [ ] **Step 5: 跑完整 shell 单测，确认所有日志与旧行为同时成立**

Run: `npm test -- src/jumpserver-shell-scripts.test.ts`
Expected: PASS

- [ ] **Step 6: 提交远端执行埋点**

```bash
git add container/skills/jumpserver/scripts/run-remote-command.sh src/jumpserver-shell-scripts.test.ts
git commit -m "feat: add jumpserver remote execution diagnostic logs"
```

---

### Task 4: 为 Node 层诊断日志抽出独立模块并先写失败测试

**Files:**
- Create: `src/jumpserver-diagnostic-logging.ts`
- Create: `src/jumpserver-diagnostic-logging.test.ts`
- Test: `src/jumpserver-diagnostic-logging.test.ts`

- [ ] **Step 1: 写失败测试，验证不开开关时不调用 logger.debug**

```ts
it('JUMPSERVER_DEBUG 未开启时不输出 node 诊断日志', () => {
  const logger = { debug: vi.fn() } as any;

  logJumpServerToolStart(logger, { command: 'uname -a' }, { JUMPSERVER_DEBUG: '0' });

  expect(logger.debug).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: 写失败测试，验证开关开启时输出工具开始/完成日志**

```ts
it('JUMPSERVER_DEBUG=1 时输出 tool start 和 done', () => {
  const logger = { debug: vi.fn() } as any;

  logJumpServerToolStart(logger, { command: 'uname -a', targetHost: '10.245.17.1' }, { JUMPSERVER_DEBUG: '1' });
  logJumpServerToolDone(logger, { command: 'uname -a', elapsedMs: 1234, result: 'success' }, { JUMPSERVER_DEBUG: '1' });

  expect(logger.debug).toHaveBeenCalledWith(
    expect.objectContaining({ phase: 'jumpserver_tool_start', command: 'uname -a' }),
    'JumpServer diagnostic',
  );
});
```

- [ ] **Step 3: 写失败测试，验证 execution summary 字段完整**

```ts
it('完成 execution 时输出汇总耗时', () => {
  const logger = { debug: vi.fn() } as any;

  logJumpServerExecutionSummary(logger, {
    executionId: 'jumpserver-exec-1',
    command: 'journalctl --no-pager -n 100',
    targetHost: '10.245.17.1',
    executionDurationMs: 189641,
    toolElapsedMs: 190200,
    status: 'completed',
  }, { JUMPSERVER_DEBUG: '1' });

  expect(logger.debug).toHaveBeenCalledWith(
    expect.objectContaining({ executionDurationMs: 189641, toolElapsedMs: 190200 }),
    'JumpServer diagnostic',
  );
});
```

- [ ] **Step 4: 运行测试，确认先失败**

Run: `npm test -- src/jumpserver-diagnostic-logging.test.ts`
Expected: FAIL，因为模块尚不存在

- [ ] **Step 5: 实现最小模块 API**

建议导出：

```ts
export function isJumpServerDebugEnabled(env = process.env): boolean;
export function logJumpServerToolStart(logger: Pick<typeof baseLogger, 'debug'>, payload: Record<string, unknown>, env?: NodeJS.ProcessEnv): void;
export function logJumpServerToolDone(...): void;
export function logJumpServerStageDebug(...): void;
export function logJumpServerExecutionSummary(...): void;
```

内部统一：

```ts
logger.debug({ ...payload }, 'JumpServer diagnostic');
```

- [ ] **Step 6: 跑测试，确认模块通过**

Run: `npm test -- src/jumpserver-diagnostic-logging.test.ts`
Expected: PASS

- [ ] **Step 7: 提交 Node 诊断模块**

```bash
git add src/jumpserver-diagnostic-logging.ts src/jumpserver-diagnostic-logging.test.ts
git commit -m "feat: add jumpserver diagnostic logging helpers"
```

---

### Task 5: 在 `src/index.ts` 中接入 Node 诊断日志

**Files:**
- Modify: `src/index.ts`
- Modify: `src/jumpserver-diagnostic-logging.test.ts`（如需补 helper case）
- Test: `src/jumpserver-diagnostic-logging.test.ts`

- [ ] **Step 1: 导入 Node 诊断模块**

```ts
import {
  logJumpServerExecutionSummary,
  logJumpServerStageDebug,
  logJumpServerToolDone,
  logJumpServerToolStart,
} from './jumpserver-diagnostic-logging.js';
```

- [ ] **Step 2: 在 JumpServer stage 变化处补 debug 摘要**

在现有 `logJumpServerDelta` 中，保留现有 `logger.info`，额外调用：

```ts
logJumpServerStageDebug(logger, {
  group: group.name,
  chatJid,
  previousStage: previous?.stage,
  stage: next.stage,
  targetHost: next.target_host,
  executionCount: next.executions?.length ?? 0,
});
```

- [ ] **Step 3: 为 tool 调用增加 start/done 计时**

在处理 JumpServer `Bash` tool_use / tool_result 的位置维护一个 `Map<string, number>`：

```ts
const jumpServerToolStarts = new Map<string, number>();
```

tool_use 时：

```ts
jumpServerToolStarts.set(toolUseId, Date.now());
logJumpServerToolStart(logger, { group: group.name, chatJid, toolUseId, command, targetHost });
```

tool_result 时：

```ts
const started = jumpServerToolStarts.get(toolUseId);
logJumpServerToolDone(logger, {
  group: group.name,
  chatJid,
  toolUseId,
  command,
  targetHost,
  elapsedMs: started ? Date.now() - started : undefined,
  result: isError ? 'error' : 'success',
});
```

- [ ] **Step 4: 在 execution 完成时补汇总日志**

在 `prevExecution.status !== execution.status` 且 execution 已完成时调用：

```ts
logJumpServerExecutionSummary(logger, {
  group: group.name,
  chatJid,
  executionId: execution.id,
  command: execution.command,
  targetHost: next.target_host,
  status: execution.status,
  executionDurationMs: durationMs(...),
  toolElapsedMs: started ? Date.now() - started : undefined,
});
```

要求：
- 只在 `completed` / `error` / `cancelled` 输出
- 不重复打整段 `output`

- [ ] **Step 5: 跑 Node 诊断模块测试和 shell 测试**

Run: `npm test -- src/jumpserver-diagnostic-logging.test.ts src/jumpserver-shell-scripts.test.ts`
Expected: PASS

- [ ] **Step 6: 提交应用层接入**

```bash
git add src/index.ts src/jumpserver-diagnostic-logging.ts src/jumpserver-diagnostic-logging.test.ts
git commit -m "feat: wire jumpserver diagnostics into app logs"
```

---

### Task 6: 记录开关文档并补充运维说明

**Files:**
- Modify: `.env.example`
- Modify: `container/skills/jumpserver/README.md`

- [ ] **Step 1: 在 `.env.example` 中加入默认关闭的开关**

```env
JUMPSERVER_DEBUG=0
```

- [ ] **Step 2: 在 `container/skills/jumpserver/README.md` 中补充诊断说明**

至少写明：
- `JUMPSERVER_DEBUG=1` 用途
- 只输出 debug 日志，不写 SQLite
- 记录命令、阶段、耗时、判定依据
- 不重复输出整段远端正文

- [ ] **Step 3: 检查文档是否与 spec 一致**

Run: `rg -n "JUMPSERVER_DEBUG|SQLite|debug" .env.example container/skills/jumpserver/README.md docs/superpowers/specs/2026-03-24-jumpserver-diagnostic-logging-design.md`
Expected: 能看到开关说明与“不写 SQLite”的一致描述

- [ ] **Step 4: 提交文档**

```bash
git add .env.example container/skills/jumpserver/README.md
git commit -m "docs: document jumpserver diagnostic logging"
```

---

### Task 7: 做最终验证并留存一次手工诊断样例

**Files:**
- Modify: 无
- Test: `src/jumpserver-shell-scripts.test.ts`, `src/jumpserver-diagnostic-logging.test.ts`

- [ ] **Step 1: 运行目标测试集**

Run: `npm test -- src/jumpserver-shell-scripts.test.ts src/jumpserver-diagnostic-logging.test.ts`
Expected: PASS

- [ ] **Step 2: 重新构建项目**

Run: `npm run build`
Expected: build 成功，无 TypeScript 错误

- [ ] **Step 3: 启动或复用容器，在 debug 模式下手工验证一次**

示例：

```bash
docker exec cnp-bot sh -lc 'JUMPSERVER_DEBUG=1 bash /app/container/skills/jumpserver/scripts/run-remote-command.sh "hostname" 60 10.245.17.1'
```

以及查看主日志：

```bash
docker logs --tail 200 cnp-bot 2>&1 | grep -E 'JUMP_DEBUG|JumpServer diagnostic'
```

Expected:
- shell 输出包含 `JUMP_DEBUG`
- 应用日志包含 `JumpServer diagnostic`
- 能从日志中看出复用/连接/等待/完成的耗时链路

- [ ] **Step 4: 汇总验证结论并提交**

```bash
git add -A
git commit -m "test: verify jumpserver diagnostic logging end to end"
```

