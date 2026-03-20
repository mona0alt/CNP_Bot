---
name: jumpserver
description: 通过 JumpServer 堡垒机连接远程服务器。用于任何需要 SSH 连接到内网服务器的的场景，例如：(1) 用户要求连接某台服务器 (2) 用户要求查看某台服务器的详情 (3) 用户要求 SSH 到某台机器 (4) 用户提供 IP 地址需要远程连接
---

# JumpServer 堡垒机连接

## 连接信息

- **JumpServer 地址**: `$JUMPSERVER_HOST`
- **SSH 端口**: `$JUMPSERVER_PORT`
- **用户名**: `$JUMPSERVER_USER`
- **密码**: `$JUMPSERVER_PASS`

## 加速登录：安装 sshpass（推荐）

```bash
apt-get update && apt-get install -y sshpass
```

安装后脚本会自动使用 sshpass 加速登录。

## 使用方法（两步完成）

### 第 1 步：连接目标机

```bash
bash /home/node/.claude/skills/jumpserver/scripts/connect-and-enter-target.sh <目标IP>
```

这个脚本**一次性**完成：连接 JumpServer → 输入目标 IP → 轮询等待目标 prompt 出现。
返回时已可直接在远程节点执行命令。支持连接复用（已有连接会直接返回）。

### 第 2 步：执行远程命令

```bash
bash /home/node/.claude/skills/jumpserver/scripts/run-remote-command.sh "<命令>"
```

脚本**一次性**完成：发送命令 → 轮询等待 prompt 返回 → 输出结果。
快速命令（`ls`、`uname`）约 0.5-1s 返回，无需固定 sleep。

长时间命令可指定超时（默认 60s）：
```bash
bash /home/node/.claude/skills/jumpserver/scripts/run-remote-command.sh "yum install -y nginx" 300
```

### 完整示例

```bash
# 连接
bash /home/node/.claude/skills/jumpserver/scripts/connect-and-enter-target.sh 10.246.104.45

# 执行命令
bash /home/node/.claude/skills/jumpserver/scripts/run-remote-command.sh "uname -a"
bash /home/node/.claude/skills/jumpserver/scripts/run-remote-command.sh "df -h"
bash /home/node/.claude/skills/jumpserver/scripts/run-remote-command.sh "journalctl --no-pager -n 100"
```

## 性能与稳定性要求（重要）

1. **禁止进入分页器**
   - 优先使用 `journalctl --no-pager`、`SYSTEMD_PAGER=cat`、`PAGER=cat`
   - 不要执行会进入 `less` / `more` 的命令

2. **查看日志优先使用非交互命令**
   ```bash
   bash /home/node/.claude/skills/jumpserver/scripts/run-remote-command.sh "export SYSTEMD_PAGER=cat PAGER=cat && journalctl --no-pager -n 100"
   bash /home/node/.claude/skills/jumpserver/scripts/run-remote-command.sh "tail -100 /var/log/messages"
   ```

## 查看目标机器详情

连接成功后执行：
```bash
bash /home/node/.claude/skills/jumpserver/scripts/run-remote-command.sh "echo '=== 系统信息 ===' && uname -a && echo -e '\n=== 主机名 ===' && hostname && echo -e '\n=== 内存信息 ===' && free -h && echo -e '\n=== 磁盘信息 ===' && df -h | grep -E '^/dev|^Filesystem'"
```

## 手动操作 tmux 会话（高级）

```bash
# 查看当前 pane 内容
tmux -S /tmp/cnpbot-tmux-sockets/cnpbot.sock capture-pane -p -J -t jumpserver:0.0 -S -200

# 查看会话状态
tmux -S /tmp/cnpbot-tmux-sockets/cnpbot.sock list-sessions
```
