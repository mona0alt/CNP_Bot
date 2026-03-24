# JumpServer 长期诊断日志设计文档

**日期：** 2026-03-24  
**状态：** 待评审

---

## 概述

当前 JumpServer 远程执行链路出现长时延时，只能从零散日志中反推：

- 应用层知道 `tool_use` / `tool_result` 的起止时间
- Shell 脚本层知道连接、等待 prompt、重试等内部过程
- SQLite 只保存最终消息，不适合作为长期诊断明细存储

这导致“慢在连 JumpServer、切目标机、等 prompt、远端命令本身，还是应用层处理”难以快速回答。

本设计引入 **方案 B：Shell 脚本 + Node 应用双层诊断日志**：

- 在 `connect-and-enter-target.sh` 与 `run-remote-command.sh` 中输出结构化 debug 日志
- 在 Node 应用中补充 JumpServer 链路级 debug 汇总日志
- 默认关闭，仅在显式开启 debug 时输出
- 不新增 SQLite 写入，不重复落完整远端输出正文

目标是让一次慢请求在日志中直接拆解为多个可比较的耗时阶段，支持长期排查与时延分布分析。

---

## 目标

- 在不开启 debug 时，不改变现有运行行为与日志噪音水平
- 在开启 `JUMPSERVER_DEBUG=1` 时，完整记录 JumpServer 关键阶段耗时
- 让日志能直接回答以下问题：
  - 是否复用了当前目标机
  - 是否触发切换目标机
  - 连 JumpServer 花了多久
  - 等目标机 shell prompt 花了多久
  - 远端命令执行花了多久
  - 是否发生超时、失败、重试
  - Node 侧 tool 调用总耗时是多少
- 保持日志可 grep、可人工阅读、可用于后续日志平台聚合

---

## 不在范围内

- 不向 SQLite 写入任何新的诊断明细或统计摘要
- 不引入新的 trace 表、审计表、分布统计表
- 不新增前端展示诊断日志 UI
- 不解析并结构化存储完整远端输出正文
- 不为每条执行生成复杂的全链路 trace id 协议

---

## 方案选择

### 方案 A：仅 Shell 层打点

优点：

- 改动最小
- 可看到连接/等待/重试细节

缺点：

- 无法和应用层 `tool_use` / `tool_result` / stage 直接对齐
- 整体链路时延仍需人工拼接

### 方案 B（采用）：Shell + Node 双层打点

优点：

- 能观察完整链路：消息处理 → tool_use → Shell 阶段 → tool_result → 最终输出
- 适合长期诊断时延分布
- 在不开 debug 时无额外噪音

缺点：

- 需要统一两层日志字段与命名
- 改动范围大于单纯脚本埋点

### 方案 C：双层打点 + 显式 trace id 贯穿

优点：

- 关联性最强

缺点：

- 实现复杂度明显上升
- 当前诊断需求下收益不足

结论：采用 **方案 B**。

---

## 总体架构

```text
用户请求
  → Node 侧消息处理/工具调用
  → JumpServer Bash tool_use
  → Shell 脚本内部阶段日志（连接 / 切换 / 等待 / 重试）
  → Bash tool_result
  → JumpServer stage 更新与应用层汇总
  → 最终回复
```

日志分层：

1. **Shell 层**
   - 面向脚本内部阶段
   - 负责记录细粒度等待点与判定依据

2. **Node 层**
   - 面向一次 tool 调用与一次远端执行
   - 负责记录链路级汇总与 stage 变化

---

## 开关设计

统一使用环境变量：

```bash
JUMPSERVER_DEBUG=1
```

规则：

- 未设置或非 `1`：不输出新增 JumpServer 诊断 debug 日志
- 设置为 `1`：Shell 与 Node 两层都开启 JumpServer 诊断日志

设计约束：

- 只新增 debug 级别日志
- 平时不开 debug 时，系统行为和现有日志量保持不变

---

## 日志格式设计

### Shell 层日志格式

采用单行结构化文本，统一前缀：

```text
JUMP_DEBUG script=run-remote-command phase=wait_remote_prompt_start target=10.245.17.1 timeout_s=60 ts=...
```

设计原则：

- 单行输出，便于 grep
- 输出到 `stderr`
- 使用 `key=value` 风格，避免多行 JSON 噪音
- 字段尽量固定，便于后续日志平台抽取

### Shell 层核心字段

- `script`：`connect-and-enter-target` / `run-remote-command`
- `phase`：阶段名
- `target`
- `current_target`
- `command`
- `elapsed_ms`
- `timeout_s`
- `attempt`
- `retry`
- `result`
- `reason`
- `match_hint`
- `ts`

### 输出约束

- 允许记录远程命令内容
- 允许记录 prompt 判定依据、命中的模式名
- 不重复输出完整远端正文
- 如需引用最近几行终端内容，只能输出压缩后的短摘要或匹配依据名，不输出大段正文

---

## Shell 层阶段设计

### `connect-and-enter-target.sh`

建议记录以下阶段：

- `script_start`
- `ensure_tmux_session`
- `detect_current_pane_state`
- `exit_current_target_start`
- `exit_current_target_done`
- `connect_jumpserver_start`
- `connect_jumpserver_done`
- `send_target_start`
- `send_target_done`
- `wait_target_prompt_start`
- `wait_target_prompt_done`
- `target_connect_failed`
- `script_done`

关键要求：

- 任何 `wait_for_pattern` 或轮询等待都要成对输出 `start/done` 或 `start/timeout`
- 对 prompt 判定要记录 `match_hint`，例如：
  - `menu_prompt`
  - `shell_prompt`
  - `error_keyword`
  - `returned_to_menu`

### `run-remote-command.sh`

建议记录以下阶段：

- `script_start`
- `check_current_target`
- `ensure_target_connection_start`
- `ensure_target_connection_done`
- `remote_command_send`
- `wait_remote_prompt_start`
- `wait_remote_prompt_done`
- `remote_command_timeout`
- `retry_after_failure`
- `script_done`

关键要求：

- 记录是否命中当前目标复用
- 记录是否因失败触发重连
- 记录每次尝试的 `attempt`
- 若发生重试，重试日志要能和首次失败关联

---

## Node 层日志设计

Node 层继续复用现有 logger，只新增 JumpServer 诊断用 debug 日志。

### Node 层核心字段

- `group`
- `chatJid`
- `targetHost`
- `executionId`
- `command`
- `stage`
- `phase`
- `elapsedMs`
- `result`
- `retry`
- `reason`

### 关键日志点

#### 1. Tool 调用级日志

在 JumpServer Bash tool_use / tool_result 周围增加：

- `jumpserver_tool_start`
- `jumpserver_tool_done`
- `jumpserver_tool_error`

至少记录：

- 命令
- 目标 IP
- tool 总耗时
- 是否成功

#### 2. Stage 变化日志

在现有 `JumpServer stage updated` 基础上补强 debug 信息：

- 上一个 stage
- 新 stage
- 阶段变化时间
- 当前 execution 数

#### 3. 远端命令汇总日志

在单次远端命令完成时输出一条汇总日志：

- `executionId`
- `command`
- `targetHost`
- `status`
- `executionDurationMs`
- `toolElapsedMs`

---

## 脚本与应用的边界

### Shell 层负责

- 内部阶段耗时
- prompt / 菜单 / shell 判定依据
- 是否切换目标、是否重试
- 连接链路内部细节

### Node 层负责

- 一次 tool 调用从发起到返回的外层耗时
- JumpServer stage 更新
- 面向应用排查的汇总日志

### 明确不做

- Node 第一版不解析 `JUMP_DEBUG` 行并转成结构化对象
- Shell 第一版不感知应用层 executionId

这样可先用最小改动完成可观测性增强，后续若需要再升级关联能力。

---

## 测试设计

### Shell 层自动化测试

修改 `src/jumpserver-shell-scripts.test.ts`，覆盖：

1. **正常路径**
   - 当前目标一致，直接执行
   - 开启 `JUMPSERVER_DEBUG=1` 时，stderr 含关键阶段日志

2. **切换路径**
   - 需要调用 `connect-and-enter-target.sh`
   - 验证切换阶段日志完整

3. **失败重试路径**
   - 首次执行失败
   - 验证输出失败阶段与 `retry_after_failure`
   - 第二次执行成功

4. **debug 开关关闭**
   - 默认不输出 `JUMP_DEBUG`

采用 TDD：

- 先写 failing tests
- 确认因新日志缺失而失败
- 再补最小实现

### Node 层验证

第一版以手工验证为主：

- 开启 `JUMPSERVER_DEBUG=1`
- 打开应用 debug 级别
- 运行一次 JumpServer 命令
- 验证日志可拆分完整时延链路

若后续 logger 测试成本低，可再补自动化断言。

---

## 验收标准

开启 `JUMPSERVER_DEBUG=1` 且应用 logger 为 debug 时，单次 JumpServer 远端执行后，日志必须能清楚回答：

1. 是否复用了当前目标机
2. 是否切换目标机
3. 连 JumpServer 用时
4. 进入目标机 shell prompt 用时
5. 远端命令等待完成用时
6. 是否超时或重试
7. Node 侧 tool 总耗时

同时满足：

- 默认不开 debug 时无新增噪音
- 不新增 SQLite 写入
- 不重复记录整段远端输出正文
- 不改变原有成功/失败语义

---

## 风险与控制

### 风险 1：日志过多

控制：

- 严格受 `JUMPSERVER_DEBUG=1` 控制
- 默认关闭
- 使用单行结构化日志

### 风险 2：日志泄露过多终端内容

控制：

- 仅记录命令、阶段、判定依据、耗时
- 不重复记录完整远端正文

### 风险 3：脚本埋点影响原行为

控制：

- debug 函数只做只读日志输出
- 不改变原等待条件与流程分支
- 通过现有 shell 测试回归

---

## 实施建议

推荐顺序：

1. 先为 shell 脚本补 failing tests
2. 实现 `JUMPSERVER_DEBUG` 与 Shell 阶段日志
3. 跑 shell 测试
4. 再补 Node 层 debug 汇总日志
5. 手工复现一次 JumpServer 请求，确认日志可读性

该顺序优先保证最有价值、最容易失真的 Shell 内部阶段被稳定覆盖。
