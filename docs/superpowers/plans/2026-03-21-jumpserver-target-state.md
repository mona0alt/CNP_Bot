# JumpServer 目标机状态判定重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 JumpServer 远程命令执行仅通过“显式传入的目标 IP + `current_target` 本地状态文件”判断是否需要切换目标机，并在直接执行失败后自动重建连接并重试一次。

**Architecture:** 保持 JumpServer 交互仍由现有 shell 脚本负责，但把“是否在目标机上”的判断从 prompt / pane 文本识别改为参数驱动状态机。`run-remote-command.sh` 负责比较 `target_ip` 与 `current_target`、决定是否调用 `connect-and-enter-target.sh`、以及在执行失败后触发一次清理状态 + 重建连接 + 重试；`connect-and-enter-target.sh` 仅负责连接/切换并在成功后写入 `current_target`。

**Tech Stack:** Bash、tmux、Vitest、Node.js child_process、临时目录与 PATH stub 测试技术

---

## 文件结构

- 修改：`container/skills/jumpserver/scripts/run-remote-command.sh`
  - 去掉“从 `current_target` 自动补目标 IP”和基于 pane 文本的目标识别
  - 强制要求第 3 个参数 `target_ip`
  - 新增“直接执行失败后，清理状态 + 重建连接 + 重试一次”的流程
- 修改：`container/skills/jumpserver/scripts/connect-and-enter-target.sh`
  - 删除“是否已在目标机上”的复杂 prompt 判定分支
  - 保留连接 JumpServer、进入目标机、写入 `current_target` 的职责
- 修改：`container/skills/jumpserver/SKILL.md`
  - 明确所有 `run-remote-command.sh` 示例都必须带 `<目标IP>`
  - 删除“未传 target_ip 时从 `current_target` 自动读取”的暗示
- 新增：`src/jumpserver-shell-scripts.test.ts`
  - 用 Vitest + `spawn`/`spawnSync` 为 shell 脚本做黑盒测试
  - 通过临时目录、伪造 `tmux` 可执行文件、伪造 `connect-and-enter-target.sh` 行为验证状态机

---

### Task 1: 给 JumpServer shell 脚本补上状态机回归测试

**Files:**
- Create: `src/jumpserver-shell-scripts.test.ts`
- Test: `src/jumpserver-shell-scripts.test.ts`

- [ ] **Step 1: 写第一个失败测试，覆盖“未传 target_ip 必须报错”**

```ts
it('run-remote-command.sh 未传 target_ip 时直接失败', () => {
  const result = spawnSync('bash', [scriptPath, 'uname -a', '60'], {
    env: testEnv,
    encoding: 'utf8',
  });

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('target_ip');
});
```

- [ ] **Step 2: 运行单测，确认失败**

Run: `npm test -- src/jumpserver-shell-scripts.test.ts`
Expected: FAIL，因为测试文件尚不存在

- [ ] **Step 3: 建测试骨架和临时环境 helper**

```ts
function makeTmpHarness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jumpserver-script-'));
  const binDir = path.join(root, 'bin');
  const socketDir = path.join(root, 'sockets');
  fs.mkdirSync(binDir, { recursive: true });
  fs.mkdirSync(socketDir, { recursive: true });
  return { root, binDir, socketDir };
}
```

补上：
- 临时目录清理
- `PATH` 前置伪造 `tmux`
- 统一 `TMPDIR`
- `JUMPSERVER_*` 测试环境变量

- [ ] **Step 4: 增加完整失败测试集（先都写成失败）**

至少覆盖这些 case：

```ts
it('current_target 缺失时先调用 connect-and-enter-target.sh 再执行');
it('current_target 相等时直接执行且不切换');
it('current_target 不一致时先切换');
it('直接执行失败后会清空 current_target、重连并重试一次');
it('重试仍失败时返回错误');
```

测试策略：
- 用伪造 `tmux` 记录 `send-keys`/`capture-pane` 调用
- 用临时覆盖的 `connect-and-enter-target.sh` 在被调用时写 marker 文件，模拟“已连接成功并写入 current_target”
- 用环境变量或 marker 文件驱动伪 `tmux` 第一次执行失败、第二次成功

- [ ] **Step 5: 运行测试，确认这些新 case 全部失败**

Run: `npm test -- src/jumpserver-shell-scripts.test.ts`
Expected: FAIL，提示缺失目标 IP 校验、仍然读取 pane 内容、没有失败后重试逻辑

- [ ] **Step 6: 提交测试骨架**

```bash
git add src/jumpserver-shell-scripts.test.ts
git commit -m "test: cover jumpserver target state scripts"
```

---

### Task 2: 重构 `run-remote-command.sh` 为参数驱动状态机

**Files:**
- Modify: `container/skills/jumpserver/scripts/run-remote-command.sh`
- Test: `src/jumpserver-shell-scripts.test.ts`

- [ ] **Step 1: 写最小实现让“缺失 target_ip 报错”测试通过**

把参数定义改成强制第 3 个参数存在：

```bash
REMOTE_CMD="${1:?Usage: run-remote-command.sh \"<command>\" [timeout_seconds] <target_ip>}"
TIMEOUT="${2:-60}"
TARGET_IP="${3:?Usage: run-remote-command.sh \"<command>\" [timeout_seconds] <target_ip>}"
```

并删除：

```bash
if [[ -z "$TARGET_IP" ]] && [[ -f "${SOCKET_DIR}/current_target" ]]; then
  TARGET_IP="$(cat "${SOCKET_DIR}/current_target" 2>/dev/null || true)"
fi
```

- [ ] **Step 2: 跑单测，确认“缺失 target_ip 报错”通过，其余仍失败**

Run: `npm test -- src/jumpserver-shell-scripts.test.ts -t "未传 target_ip"`
Expected: PASS

- [ ] **Step 3: 删除 pane 文本识别逻辑，改为只比较 `current_target`**

删除：

```bash
capture_tail() { ... }
is_connected_to_target() { ... }
```

新增：

```bash
CURRENT_TARGET=""
if [[ -f "${SOCKET_DIR}/current_target" ]]; then
  CURRENT_TARGET="$(cat "${SOCKET_DIR}/current_target" 2>/dev/null || true)"
fi

if [[ "$CURRENT_TARGET" != "$TARGET_IP" ]]; then
  bash "${SCRIPT_DIR}/connect-and-enter-target.sh" "$TARGET_IP"
fi
```

- [ ] **Step 4: 提取“发送命令并等待结果”的函数，给重试留入口**

建议拆成：

```bash
run_once() {
  tmux -S "$SOCKET" send-keys -t "$PANE" -- "$REMOTE_CMD" Enter
  # 原有等待 prompt 返回逻辑保留
  tmux -S "$SOCKET" capture-pane -p -J -t "$PANE" -S -200 | redact_sensitive_output
}
```

要求：
- `run_once` 失败时返回非 0
- stdout/stderr 保留给上层决定

- [ ] **Step 5: 实现“失败后清理状态 + 重建连接 + 重试一次”**

按这个结构实现：

```bash
if output="$(run_once)"; then
  printf '%s\n' "$output"
  exit 0
fi

rm -f "${SOCKET_DIR}/current_target"
bash "${SCRIPT_DIR}/connect-and-enter-target.sh" "$TARGET_IP"
run_once
```

注意：
- 只重试一次
- 第二次失败直接退出
- 不要吞掉第一次失败的上下文；必要时把 stderr 透传出来

- [ ] **Step 6: 跑完整测试，确认 Task 1 的脚本状态机测试全部通过**

Run: `npm test -- src/jumpserver-shell-scripts.test.ts`
Expected: PASS

- [ ] **Step 7: 提交脚本状态机重构**

```bash
git add container/skills/jumpserver/scripts/run-remote-command.sh src/jumpserver-shell-scripts.test.ts
git commit -m "fix: drive jumpserver target state by current_target"
```

---

### Task 3: 简化 `connect-and-enter-target.sh` 的职责

**Files:**
- Modify: `container/skills/jumpserver/scripts/connect-and-enter-target.sh`
- Test: `src/jumpserver-shell-scripts.test.ts`

- [ ] **Step 1: 写失败测试，确认切换逻辑不再依赖 prompt 识别“已在同一目标机”**

在黑盒测试里增加一个 case：

```ts
it('connect-and-enter-target.sh 仅负责连接并写入 current_target，不再基于 prompt 判断已在目标机');
```

断言重点：
- 脚本最终写入 `current_target`
- 不再因为伪造 pane 内容命中旧 hostname 规则而提前 `exit 0`

- [ ] **Step 2: 运行针对性测试，确认失败**

Run: `npm test -- src/jumpserver-shell-scripts.test.ts -t "connect-and-enter-target.sh"`
Expected: FAIL，旧逻辑仍会读 pane 内容并走“复用当前连接”分支

- [ ] **Step 3: 删除/收敛旧的“当前已连接目标机”判定逻辑**

删除或收敛这些函数/分支：

```bash
is_remote_prompt() { ... }
is_connected_to_target() { ... }
if is_pane_in_ssh "$current_cmd"; then
  if is_at_menu; then
  elif is_remote_prompt; then
    if is_connected_to_target "$TARGET_IP"; then
```

保留逻辑目标：
- 如果需要切换旧目标，统一走“退回 JumpServer 菜单 -> 输入新 IP”
- 不再尝试通过 prompt 判断“当前已经是同一台目标机”

- [ ] **Step 4: 保留最小必要的连接流程**

确保脚本只做：
1. 确保 tmux session 存在
2. 如不在 JumpServer ssh 会话则连 JumpServer
3. 必要时退回 `[Host]` 菜单
4. 输入 `TARGET_IP`
5. 等待远程 shell prompt
6. 成功后写入 `current_target`

- [ ] **Step 5: 跑相关测试，确认 `connect-and-enter-target.sh` 新职责成立**

Run: `npm test -- src/jumpserver-shell-scripts.test.ts -t "connect-and-enter-target.sh"`
Expected: PASS

- [ ] **Step 6: 提交连接脚本职责收敛**

```bash
git add container/skills/jumpserver/scripts/connect-and-enter-target.sh src/jumpserver-shell-scripts.test.ts
git commit -m "refactor: simplify jumpserver target connect script"
```

---

### Task 4: 更新 Skill 文档并做最终验证

**Files:**
- Modify: `container/skills/jumpserver/SKILL.md`
- Test: `src/jumpserver-shell-scripts.test.ts`

- [ ] **Step 1: 写文档回归测试或最小断言**

在测试文件中增加一个简单文档约束测试：

```ts
it('JumpServer skill 文档要求 run-remote-command.sh 始终带目标 IP', () => {
  const doc = fs.readFileSync(path.resolve('container/skills/jumpserver/SKILL.md'), 'utf8');
  expect(doc).toContain('第 3 个参数必须始终传入目标 IP');
});
```

如果文档中仍存在“省略目标 IP 继续执行”的描述，也在此加 `not.toContain(...)` 断言。

- [ ] **Step 2: 更新 `SKILL.md` 文案与示例**

确保以下示例都显式带 `<目标IP>`：

```bash
bash /home/node/.claude/skills/jumpserver/scripts/run-remote-command.sh "tail -100 /var/log/messages" 60 <目标IP>
```

修正文案：
- 同一台机器上连续执行命令，也必须重复传入目标 IP
- 脚本使用 `current_target` 仅做切换判断，不做隐式补参

- [ ] **Step 3: 跑新增文档约束测试**

Run: `npm test -- src/jumpserver-shell-scripts.test.ts -t "skill 文档"`
Expected: PASS

- [ ] **Step 4: 跑完整相关测试集**

Run: `npm test -- src/jumpserver-shell-scripts.test.ts src/jumpserver-dangerous-command.test.ts src/jumpserver-stream-aggregator.test.ts`
Expected: PASS

- [ ] **Step 5: 跑类型检查与最终验证**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 6: 提交最终文档与验证结果**

```bash
git add container/skills/jumpserver/SKILL.md src/jumpserver-shell-scripts.test.ts
git commit -m "docs: require explicit target ip for jumpserver commands"
```

---

## 备注

- 这个方案故意不做执行前探活；如果 `current_target` 与真实连接状态不一致，允许第一次执行失败，然后走重建+单次重试
- 实现时不要重新引入 prompt / hostname / 资产名匹配，否则会偏离 spec
- 如果在测试中发现“首次失败后自动重试”对非幂等命令风险过高，应只记录为后续增强点，不要在本需求里扩 scope

