# JumpServer 远端高危命令确认设计文档

**日期：** 2026-03-21  
**状态：** 已批准

---

## 概述

当 agent 通过 JumpServer skill 的 `run-remote-command.sh` 在目标主机上执行 Bash 命令时，如果真实远端命令命中高危命令规则，系统应在前端继续复用现有 `confirm_bash` 交互卡片，先向用户确认，再决定是否继续执行。

本设计的目标是：**最大化复用当前本地高危 Bash 命令确认能力**，包括危险命令名单、IPC 请求格式、WebSocket 转发、前端确认卡片与响应链路；仅在必要位置补充 JumpServer 远端命令解析和“目标主机”上下文透传。

---

## 目标

- 对 `jumpserver/scripts/run-remote-command.sh` 发起的真实远端命令执行高危检测
- 复用现有 `dangerous-commands.ts` 规则，不维护第二份危险命令名单
- 复用现有 `confirm_bash` 交互链路，不新增新的确认事件类型
- 前端继续复用 `ConfirmBashCard`，只新增“目标主机”展示
- 用户拒绝时，仅拒绝本次远端命令；后续再次发起时仍可再次确认
- 在未显式传入目标 IP 时，尽量展示推断出的目标主机；无法推断时仍要求确认并展示“未知目标主机”

---

## 不在范围内

- 不改造 `connect.sh` 或 `connect-and-enter-target.sh` 的连接流程
- 不对 JumpServer 内部 `tmux send-keys` / `capture-pane` / 连接步骤单独弹确认
- 不新增 `confirm_remote_bash`、`remote_bash_confirm` 等新的 IPC / WebSocket 事件类型
- 不重写危险命令规则为 JumpServer 专用版本
- 不做基于远端 shell 实际输出的二次风险识别

---

## 方案选择

### 方案 A（采用）：在 agent-runner 中识别 `run-remote-command.sh` 并复用现有确认链路

在现有 `createDangerousCommandHook()` 中增加 JumpServer 远端命令分支：

1. 识别 Bash 命令是否在调用 `jumpserver/scripts/run-remote-command.sh`
2. 解析出真实远端命令与目标主机
3. 用 `dangerous-commands.ts` 对真实远端命令做危险检测
4. 命中后继续走现有 `cnp-confirm -> IPC -> WebSocket -> ConfirmBashCard` 链路

**优点：**
- 复用最多，改动最小
- 不新增前端卡片类型
- 危险命令名单保持单一来源
- 行为与本地高危 Bash 确认一致

**缺点：**
- 需要新增一层 `run-remote-command.sh` 参数解析逻辑
- 需要处理目标主机缺失或无法推断的兜底情况

### 方案 B（不采用）：在 `run-remote-command.sh` 脚本内部自己发确认请求

缺点是会复制危险命令规则与确认协议逻辑，测试和维护成本高，不符合“尽量复用”的目标。

### 方案 C（不采用）：新增远端高危命令专用确认类型

虽然语义更独立，但会复制现有 `confirm_bash` 的前后端链路，与本次需求方向相反。

---

## 架构与数据流

```text
Agent 调用 Bash
  → 命令为 run-remote-command.sh 时，agent-runner 解析真实远端命令和目标主机
  → dangerous-commands.ts 对真实远端命令做风险检测
  → 命中高危规则时调用 cnp-confirm
  → cnp-confirm 写入 confirm_bash 请求（附带 targetHost）
  → host IPC watcher 读取请求并广播 confirm_bash websocket 消息
  → 前端复用 ConfirmBashCard，额外展示“目标主机”
  → 用户确认/拒绝
  → host 回写 confirm_bash_response
  → agent-runner 继续执行或拒绝本次 Bash 调用
```

### 核心原则

- **仅检查真实远端命令**，不把 `run-remote-command.sh` 包装命令本身当作用户确认对象
- **仅对 `run-remote-command.sh` 生效**，连接/切换脚本不弹确认
- **沿用 `confirm_bash` 语义**：这是带目标主机上下文的危险命令确认，而不是一套新协议
- **保守展示目标主机**：能解析就展示真实 IP，不能解析则展示“未知目标主机”，仍然要求确认

---

## 模块改动

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `container/agent-runner/src/index.ts` | 修改 | 扩展危险命令 hook，使其支持 JumpServer 远端命令解析与确认文案 |
| `container/agent-runner/src/dangerous-commands.ts` | 复用 | 继续作为唯一危险命令规则来源 |
| `container/agent-runner/src/jumpserver-dangerous-command.ts` | 新增 | 识别 `run-remote-command.sh`、解析远端命令与目标主机 |
| `container/scripts/cnp-confirm` | 修改 | 允许确认请求携带可选 `targetHost` 字段 |
| `src/ipc.ts` | 修改 | `IpcConfirmRequest` 增加 `targetHost?: string`，透传与落审计 |
| `src/index.ts` | 修改 | pending confirm 与广播 payload 增加 `targetHost` |
| `src/server.ts` | 修改 | WebSocket 初始补发/实时转发 `confirm_bash` 时带上 `targetHost` |
| `frontend/src/lib/interactive-events.ts` | 修改 | `ConfirmBashRequest` 增加 `targetHost?: string` |
| `frontend/src/components/ConfirmBashCard.tsx` | 修改 | 继续复用卡片，新增“目标主机”显示 |
| `src/*.test.ts` / `frontend` 测试 | 修改/新增 | 覆盖解析、透传、展示与兼容性 |

---

## 后端设计

### 1. JumpServer 远端命令识别

新增轻量模块，例如 `jumpserver-dangerous-command.ts`，职责仅包括：

- `isJumpServerRunRemoteCommand(command: string): boolean`
- `parseJumpServerRunRemoteCommand(command: string): { remoteCommand?: string; targetHost?: string }`

该模块只负责识别 `run-remote-command.sh` 这一种入口，不尝试抽象 JumpServer 全量协议。

### 2. 危险命令判断

在 `createDangerousCommandHook()` 中采用如下顺序：

1. 取原始 Bash `command`
2. 判断是否为 `run-remote-command.sh`
3. 如果不是：沿用当前本地逻辑，直接检测整条命令
4. 如果是：
   - 解析出 `remoteCommand`
   - 若成功解析，调用 `findDangerousCommand(remoteCommand)`
   - 若未成功解析 `remoteCommand`，则按“无法识别远端命令，不拦截”处理，避免误伤正常 JumpServer 执行

### 3. 发送确认请求

命中高危规则后，调用 `cnp-confirm` 时传入：

- `command`: **真实远端命令**，供前端展示
- `reason`: 危险原因
- `targetHost`: 目标主机，可选

这样用户在前端确认的对象就是自己真正关心的远端命令，而不是包装脚本。

### 4. 拒绝与失败反馈

- 用户拒绝：deny 本次 Bash 调用，并返回给 agent 明确提示，强调这是**本次远端危险命令**被拒绝，后续仍可再次发起确认
- 确认流程失败：继续沿用当前失败即拒绝的保守策略
- 本地危险命令逻辑保持不变

建议文案中补充目标主机上下文，例如：

- 用户拒绝：`用户本次拒绝执行远端危险命令（目标主机：10.1.2.3，原因：递归强制删除文件）。这不是永久性限制；如果用户随后再次明确要求执行，可重新调用 Bash，并再次向用户确认。`
- 确认失败：`远端危险命令确认失败（目标主机：10.1.2.3，原因：递归强制删除文件），本次已拒绝执行。若用户仍要继续，请稍后重试；系统应再次发起确认。`

### 5. 目标主机解析规则

目标主机按以下优先级确定：

1. `run-remote-command.sh` 第 3 个参数（显式目标 IP）
2. 可从命令串稳定推断出的目标主机值
3. 否则标记为未知

当已成功提取 `remoteCommand` 但 `targetHost` 缺失时：

- 仍然拦截并要求确认
- 前端显示 `未知目标主机`

---

## IPC / WebSocket 设计

### `confirm_bash` 请求结构扩展

现有结构上增加可选字段：

```ts
interface IpcConfirmRequest {
  type: 'confirm_bash';
  requestId: string;
  command: string;
  reason?: string;
  targetHost?: string;
  chatJid?: string;
}
```

### 兼容性要求

- `targetHost` 为可选字段，老请求和老记录必须继续正常工作
- 没有 `targetHost` 时，前端继续按当前逻辑展示，不应报错
- pending confirm 恢复、断线重连补发、ack 回写逻辑都应保留兼容性

### 审计日志

当前 `command_audit_log` 已记录 `command` / `reason` / `approved`。v1 不强制扩展数据库结构记录 `targetHost`，以最小改动为先；若后续需要审计远端主机维度，可另开需求。

---

## 前端设计

### 交互类型复用

继续复用：

- `confirm_bash` WebSocket 事件
- `ConfirmBashRequest`
- `ConfirmBashCard`
- `confirm_bash_response`

不新增新的前端事件或卡片类型。

### 卡片展示

`ConfirmBashCard` 保持现有结构，新增一块信息展示：

- 标题：仍为“危险命令确认”
- 命令：显示真实远端命令
- 风险原因：显示规则命中原因
- **目标主机：** 显示解析出的 IP；为空时显示 `未知目标主机`

文案统一使用“**目标主机**”，不使用“远端主机”。

### 用户体验要求

- 用户看到的是“要在目标主机上执行的真实命令”，不是 JumpServer 包装命令
- 用户拒绝后，卡片状态与现有 `confirm_bash` 行为保持一致
- 若未来本地/远端确认同时存在，仍按 `requestId` 独立处理

---

## 边界与异常处理

1. **仅拦截 `run-remote-command.sh`**  
   不拦截 JumpServer 连接脚本与内部 tmux 控制命令。

2. **解析失败不误拦截**  
   如果识别出调用了 `run-remote-command.sh`，但无法可靠提取真实远端命令，则本次不触发危险确认，避免把包装脚本误判为用户真实意图。

3. **目标主机未知仍拦截**  
   只要真实远端命令已提取且命中高危规则，就必须确认；目标主机未知不构成放行条件。

4. **拒绝只影响一次**  
   不做命令级缓存批准或永久豁免。

5. **不破坏现有本地行为**  
   普通 Bash 高危命令确认能力必须保持现状。

---

## 测试策略

### 1. 解析单元测试

新增覆盖：

- 正常提取 `run-remote-command.sh "rm -rf /tmp/a" 60 10.1.2.3`
- 命令中包含空格、管道、`&&`、引号等复杂情况
- 未传第 3 个参数目标 IP
- 无法可靠提取远端命令时返回空结果

### 2. agent-runner 行为测试

覆盖：

- 普通本地危险命令仍触发确认
- JumpServer 远端危险命令触发确认
- JumpServer 非危险远端命令不触发确认
- 传入确认卡片的是“真实远端命令”而不是包装脚本
- `targetHost` 能正确透传；缺失时不崩溃

### 3. IPC / 服务端测试

覆盖：

- `confirm_bash` 请求可携带 `targetHost`
- pending confirm 恢复与 WebSocket 广播可透传 `targetHost`
- 老 payload 不带 `targetHost` 时仍兼容

### 4. 前端测试

覆盖：

- `extractConfirmBashRequest()` 正确解析 `targetHost`
- `ConfirmBashCard` 显示“目标主机”
- `targetHost` 缺失时显示 `未知目标主机`
- 不影响现有确认按钮行为和 ack 流程

---

## 里程碑建议

1. 新增 JumpServer 远端命令解析模块与单测
2. 在 agent-runner 危险命令 hook 中接入远端命令分支
3. 扩展 `confirm_bash` payload 支持 `targetHost`
4. 前端卡片展示“目标主机”
5. 运行回归测试，确认本地与 JumpServer 两条确认链路都正常

---

## 最终决策

采用“**在 agent-runner 中识别 `run-remote-command.sh`，复用现有 `confirm_bash` 链路**”的方案。

该方案满足：

- 最小改动
- 最大复用
- 保持现有交互一致性
- 明确向用户展示真实危险命令与目标主机
- 不引入新的确认协议和前端卡片类型
