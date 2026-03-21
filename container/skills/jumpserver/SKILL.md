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

## ⚠️ 强制规则（必须遵守）

1. **禁止使用 `ssh`、`sshpass` 或任何自行构造的 SSH 命令连接目标机器**
2. **所有远程连接必须通过 `connect-and-enter-target.sh` 脚本**
3. **所有远程命令必须通过 `run-remote-command.sh` 脚本**
4. **`run-remote-command.sh` 第 3 个参数必须始终传入目标 IP**，这样脚本会自动处理连接/切换
5. 切换目标机器时，直接用新 IP 调用 `connect-and-enter-target.sh`，脚本会自动从当前机器退出并切换

## 使用方法（推荐：始终传目标IP）

```bash
# 连接并执行命令（推荐方式，run-remote-command 自动确保连接正确）
bash /home/node/.claude/skills/jumpserver/scripts/connect-and-enter-target.sh <目标IP>
bash /home/node/.claude/skills/jumpserver/scripts/run-remote-command.sh "<命令>" 60 <目标IP>
```

`run-remote-command.sh` 第 3 个参数传入目标 IP 后，脚本会：
- 如果 tmux session 不存在 → 自动调用 connect-and-enter-target.sh 建立连接
- 如果当前在其他目标机 → 自动切换到正确的目标机
- 如果已经在目标机 → 直接执行命令

### 完整示例：单台机器

```bash
bash /home/node/.claude/skills/jumpserver/scripts/connect-and-enter-target.sh 10.246.104.45
bash /home/node/.claude/skills/jumpserver/scripts/run-remote-command.sh "uname -a" 60 10.246.104.45
bash /home/node/.claude/skills/jumpserver/scripts/run-remote-command.sh "df -h" 60 10.246.104.45
bash /home/node/.claude/skills/jumpserver/scripts/run-remote-command.sh "journalctl --no-pager -n 100" 60 10.246.104.45
```

### 完整示例：同一 session 切换到不同机器

```bash
# 连接第一台
bash /home/node/.claude/skills/jumpserver/scripts/connect-and-enter-target.sh 10.246.104.45
bash /home/node/.claude/skills/jumpserver/scripts/run-remote-command.sh "df -h" 60 10.246.104.45

# 切换到第二台（脚本自动退出第一台，返回堡垒机菜单，再进入第二台）
bash /home/node/.claude/skills/jumpserver/scripts/connect-and-enter-target.sh 10.245.17.1
bash /home/node/.claude/skills/jumpserver/scripts/run-remote-command.sh "df -h" 60 10.245.17.1
```

## 性能与稳定性要求（重要）

1. **禁止进入分页器**
   - 优先使用 `journalctl --no-pager`、`SYSTEMD_PAGER=cat`、`PAGER=cat`
   - 不要执行会进入 `less` / `more` 的命令

2. **查看日志优先使用非交互命令**
   ```bash
   bash /home/node/.claude/skills/jumpserver/scripts/run-remote-command.sh "export SYSTEMD_PAGER=cat PAGER=cat && journalctl --no-pager -n 100" 60 <目标IP>
   bash /home/node/.claude/skills/jumpserver/scripts/run-remote-command.sh "tail -100 /var/log/messages" 60 <目标IP>
   ```

3. **长时间命令指定超时**
   ```bash
   bash /home/node/.claude/skills/jumpserver/scripts/run-remote-command.sh "yum install -y nginx" 300 <目标IP>
   ```

## 查看目标机器详情

连接成功后执行：
```bash
bash /home/node/.claude/skills/jumpserver/scripts/run-remote-command.sh "echo '=== 系统信息 ===' && uname -a && echo -e '\n=== 主机名 ===' && hostname && echo -e '\n=== 内存信息 ===' && free -h && echo -e '\n=== 磁盘信息 ===' && df -h | grep -E '^/dev|^Filesystem'" 60 <目标IP>
```

> 即使是同一台机器上的连续命令，也要重复传入目标 IP；脚本只用 `current_target` 判断是否需要切换，不会再隐式补全目标参数。

## 手动操作 tmux 会话（高级）

```bash
# 查看当前 pane 内容
tmux -S /tmp/cnpbot-tmux-sockets/cnpbot.sock capture-pane -p -J -t jumpserver:0.0 -S -200

# 查看会话状态
tmux -S /tmp/cnpbot-tmux-sockets/cnpbot.sock list-sessions
```
