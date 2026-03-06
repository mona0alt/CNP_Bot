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

## 连接流程

1. **SSH 连接到 JumpServer**
   ```bash
   ssh "${JUMPSERVER_USER}@${JUMPSERVER_HOST}" -p"${JUMPSERVER_PORT}"
   ```

2. **首次连接需确认密钥** - 输入 `yes`

3. **输入密码** - `$JUMPSERVER_PASS`

4. **登录成功后，搜索目标 IP** - 直接输入 IP 地址（如 `10.246.104.45`）并回车

5. **再次输入目标机器密码** - 根据实际情况输入

## 使用 tmux 会话连接

```bash
SOCKET_DIR="${TMPDIR:-/tmp}/clawdbot-tmux-sockets"
mkdir -p "$SOCKET_DIR"
SOCKET="$SOCKET_DIR/clawdbot.sock"
SESSION=jumpserver

# 创建新会话
tmux -S "$SOCKET" new -d -s "$SESSION" -n shell

# SSH 到 JumpServer
tmux -S "$SOCKET" send-keys -t "$SESSION":0.0 -- "ssh ${JUMPSERVER_USER}@${JUMPSERVER_HOST} -p${JUMPSERVER_PORT}" Enter
sleep 3

# 输入 yes 确认
tmux -S "$SOCKET" send-keys -t "$SESSION":0.0 -- 'yes' Enter
sleep 2

# 输入密码
tmux -S "$SOCKET" send-keys -t "$SESSION":0.0 -- "$JUMPSERVER_PASS" Enter
sleep 3

# 查看输出
tmux -S "$SOCKET" capture-pane -p -J -t "$SESSION":0.0 -S -200
```

## 查看目标机器详情

连接成功后执行：
```bash
echo "=== 系统信息 ===" && uname -a
echo -e "\n=== 主机名 ===" && hostname
echo -e "\n=== 操作系统 ===" && cat /etc/os-release
echo -e "\n=== CPU 信息 ===" && lscpu | grep -E "Model name|CPU\(s\)|Thread|Core|Socket"
echo -e "\n=== 内存信息 ===" && free -h
echo -e "\n=== 磁盘信息 ===" && df -h | grep -E "^/dev|^Filesystem"
```
