# JumpServer 目标机状态判定重构设计文档

**日期：** 2026-03-21  
**状态：** 待评审

---

## 概述

当前 JumpServer 远程执行链路在判断“当前 tmux 会话是否已经位于目标机器”时，依赖终端屏幕内容、prompt 和主机名文本做启发式匹配。该方案会因为主机名格式、资产名缩写、prompt 样式差异而误判，进而触发不必要的 `exit -> 返回 [Host] 菜单 -> 重新连接目标机`，表现为“连续执行命令时频繁断开重连”。

本设计将状态判定彻底改为**参数驱动**：

- 模型每次调用 `run-remote-command.sh` 时都必须显式传入目标 IP
- 脚本不再读取终端屏幕内容判断当前机器
- 脚本不再尝试从 prompt、hostname、资产名推断目标
- 仅使用“本次调用的目标 IP”与本地状态文件 `current_target` 做对比，决定是否切换
- 若判断为同一台机器，则直接执行；若执行失败，再执行一次重建连接并重试

该设计的核心目标是：**用简单、确定、可预测的状态机，替代脆弱的文本推断逻辑。**

---

## 目标

- 消除连续执行命令时因 prompt 识别误判导致的假性断连/重连
- 将“是否需要切换目标机”的判断收敛为单一规则：`target_ip` 与 `current_target` 是否一致
- 要求所有远端命令调用都显式携带目标 IP，杜绝隐式沿用上次目标
- 当连接状态实际失效但 `current_target` 仍一致时，采用“先执行，失败后自动重建并重试一次”的恢复策略
- 保持 JumpServer skill 对模型的使用方式简单且强约束，减少自由发挥空间

---

## 不在范围内

- 不维护 IP / 主机名 / 资产名的别名映射表
- 不从 tmux pane 内容、prompt、hostname、登录欢迎语中推断当前机器
- 不做执行前探活、屏幕探测、轻量 `echo` 预检查
- 不支持 `run-remote-command.sh` 在缺失目标 IP 参数时自动猜目标机
- 不做多次自动重试；重建后仅重试一次

---

## 方案选择

### 方案 A（采用）：参数驱动 + `current_target` 唯一判断源 + 失败后重建

执行规则：

1. 每次 `run-remote-command.sh` 调用必须带第 3 个参数 `target_ip`
2. 读取本地 `current_target`
3. 若 `current_target == target_ip`，直接执行远端命令
4. 若 `current_target != target_ip` 或不存在，则先调用 `connect-and-enter-target.sh <target_ip>` 切换，再执行命令
5. 若直接执行失败，则认为连接状态可能失效：
   - 清理本地状态
   - 重建目标连接
   - 自动重试一次同一命令
6. 若重试仍失败，则返回错误，不继续尝试

**优点：**

- 判定逻辑简单、稳定、确定
- 不依赖终端文本格式
- 与当前用户诉求完全一致
- 便于测试，状态机清晰

**缺点：**

- `current_target` 可能与真实会话状态短暂不一致
- 第一次执行会把“连接已失效”的问题暴露在命令执行阶段，而不是执行前

该缺点已被接受，因为恢复策略明确为“失败后重建并重试一次”。

---

## 核心状态模型

### `current_target` 的职责

`current_target` 只表示：

> 本地系统当前认为 `jumpserver` tmux 会话正在对应的目标 IP

它不是：

- 屏幕解析结果
- 终端 prompt 推断结果
- 资产名映射结果
- 真实连接状态的绝对真相

它只是 JumpServer 远程会话的**本地状态缓存**。

### 状态判定规则

唯一判定规则：

```text
target_ip == current_target  => 视为同一目标机，直接执行
target_ip != current_target  => 视为需要切换，先切换再执行
```

不再附加任何 prompt / hostname / pane 内容校验。

---

## 脚本职责设计

### `connect-and-enter-target.sh`

职责收敛为：

- 确保 tmux session 存在
- 如有旧会话，负责执行切换动作
- 连接 / 进入指定目标 IP
- 成功后写入 `current_target`

该脚本可以继续通过 tmux + JumpServer 交互完成连接过程，但**不再承担“判断当前是不是目标机”的复杂逻辑**；是否需要进入它，由上层通过 `current_target` 决定。

### `run-remote-command.sh`

职责调整为：

1. 校验调用参数，强制要求存在 `target_ip`
2. 读取 `current_target`
3. 与本次 `target_ip` 比较，决定是否调用 `connect-and-enter-target.sh`
4. 在目标机上发送远端命令
5. 若执行失败：
   - 删除 / 清空 `current_target`
   - 重新连接到 `target_ip`
   - 再执行一次同一命令
6. 若重试失败，返回错误

`run-remote-command.sh` 不再从 `current_target` 读取默认目标作为隐式参数来源；`current_target` 仅用于比较，而不是补参。

---

## 数据与文件约束

### 状态文件

保留现有文件：

- `${TMPDIR:-/tmp}/cnpbot-tmux-sockets/current_target`

文件内容约束：

- 仅保存一个目标 IP
- 不保存主机名、资产名、时间戳、别名
- 写入采用覆盖方式

### 写入时机

仅在以下时机写入：

- `connect-and-enter-target.sh` 成功进入目标机后

### 清理时机

在以下情况清理：

- `run-remote-command.sh` 发现直接执行失败并准备重建连接前
- 连接脚本明确失败并确认当前状态不可再信任时

---

## 模型 / Skill 约束

### JumpServer skill 规则更新

文档与系统提示中应明确：

- 所有 `run-remote-command.sh` 调用必须始终传入目标 IP
- 不允许省略第 3 个参数
- 不再强调“脚本可自动读取上次目标并继续执行”

推荐用法统一为：

```bash
bash /home/node/.claude/skills/jumpserver/scripts/connect-and-enter-target.sh <目标IP>
bash /home/node/.claude/skills/jumpserver/scripts/run-remote-command.sh "<命令>" 60 <目标IP>
```

并明确说明：

- 同一目标机上的连续命令，也必须重复传入目标 IP

---

## 失败恢复策略

### 直接执行失败

当 `current_target == target_ip` 且脚本选择直接执行时，若远端命令执行失败，按如下策略处理：

1. 将本次失败视为“当前会话可能失效”
2. 删除 `current_target`
3. 调用 `connect-and-enter-target.sh <target_ip>` 重建连接
4. 重试一次原命令

### 重试边界

- 最多自动重试一次
- 若第二次仍失败，直接返回错误
- 不做无限循环，不做指数退避

### 风险控制

这种策略意味着：

- 非幂等命令可能存在“第一次已生效但返回异常，第二次再次执行”的风险

因此本设计默认假设当前 JumpServer skill 的主要使用场景为：

- 查看日志
- 采集状态
- 执行常见运维命令

对于危险命令，继续依赖现有高危命令确认链路；本设计不额外改变确认机制。

---

## 测试设计

### Shell 脚本层

需要覆盖以下核心场景：

1. `current_target` 缺失时，先连接再执行
2. `current_target` 与 `target_ip` 一致时，直接执行，不调用切换脚本
3. `current_target` 与 `target_ip` 不一致时，调用切换脚本
4. 直接执行失败时，清理 `current_target`、重建连接并重试一次
5. 重试仍失败时，返回失败
6. 缺失第 3 个参数 `target_ip` 时，脚本直接报错

### TypeScript / 文档层

需要覆盖：

1. JumpServer skill 文档示例全部显式带目标 IP
2. 不再保留“从 `current_target` 自动读取目标 IP 继续执行”的说明

---

## 模块改动

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `container/skills/jumpserver/scripts/run-remote-command.sh` | 修改 | 去掉基于 pane 文本的目标机识别；强制 `target_ip` 参数；增加失败后重建并重试一次 |
| `container/skills/jumpserver/scripts/connect-and-enter-target.sh` | 修改 | 删除 / 收敛基于 prompt 的“是否已经在目标机”判定逻辑，简化为连接/切换执行器 |
| `container/skills/jumpserver/SKILL.md` | 修改 | 明确所有远端命令都必须传目标 IP，移除隐式目标说明 |
| `src/jumpserver-stream-aggregator.test.ts` 或相关测试 | 视情况修改 | 如有依赖旧说明或旧状态流的测试，更新文案期望 |
| JumpServer 脚本测试文件（如需新增） | 新增 | 覆盖 `current_target` 比较与失败重试逻辑 |

---

## 兼容性与迁移

### 向后兼容

该变更对“省略 `target_ip` 参数”的旧调用方式**不再兼容**，应明确失败并提示正确用法。

### 迁移策略

1. 先更新 JumpServer skill 文档和示例
2. 再修改脚本逻辑强制校验 `target_ip`
3. 补充测试，确保模型按新契约工作

---

## 成功标准

满足以下条件即视为完成：

- 连续对同一 IP 执行多条命令时，不再因 prompt 识别误判触发切换
- 切换到新 IP 时，能够基于 `current_target` 明确执行切换
- 已失效连接在首次执行失败后可以自动重建并重试一次
- JumpServer skill 所有示例与实际调用都显式传入目标 IP

