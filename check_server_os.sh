#!/bin/bash

# 脚本：检查 10.246.104.45 服务器的操作系统信息
# 使用 jumpserver 技能连接并获取系统信息

# 设置变量
JUMPSERVER_USER="liudi"
JUMPSERVER_HOST="10.245.17.1"
JUMPSERVER_PORT="2222"
JUMPSERVER_PASS="root@2022-BJ"
TARGET_SERVER="10.246.104.45"

# 创建 tmux 会话
SOCKET_DIR="${TMPDIR:-/tmp}/clawdbot-tmux-sockets"
mkdir -p "$SOCKET_DIR"
SOCKET="$SOCKET_DIR/clawdbot.sock"
SESSION="server-check"

echo "正在连接到 JumpServer: $JUMPSERVER_HOST"
echo "目标服务器: $TARGET_SERVER"

# 创建 tmux 会话
tmux -S "$SOCKET" new -d -s "$SESSION" -n shell

# SSH 到 JumpServer
tmux -S "$SOCKET" send-keys -t "$SESSION":0.0 -- "ssh ${JUMPSERVER_USER}@${JUMPSERVER_HOST} -p${JUMPSERVER_PORT}" Enter
sleep 3

# 输入 yes 确认（如果需要）
tmux -S "$SOCKET" send-keys -t "$SESSION":0.0 -- "yes" Enter
sleep 2

# 输入 JumpServer 密码
tmux -S "$SOCKET" send-keys -t "$SESSION":0.0 -- "$JUMPSERVER_PASS" Enter
sleep 3

# 连接到目标服务器
tmux -S "$SOCKET" send-keys -t "$SESSION":0.0 -- "$TARGET_SERVER" Enter
sleep 3

# 获取系统信息
echo "正在获取系统信息..."
tmux -S "$SOCKET" send-keys -t "$SESSION":0.0 -- 'echo "=== 系统信息 ===" && uname -a' Enter
sleep 1
tmux -S "$SOCKET" send-keys -t "$SESSION":0.0 -- 'echo -e "\n=== 主机名 ===" && hostname' Enter
sleep 1
tmux -S "$SOCKET" send-keys -t "$SESSION":0.0 -- 'echo -e "\n=== 操作系统 ===" && cat /etc/os-release' Enter
sleep 1
tmux -S "$SOCKET" send-keys -t "$SESSION":0.0 -- 'echo -e "\n=== CPU 信息 ===" && lscpu | grep -E "Model name|CPU\(s\)|Thread|Core|Socket"' Enter
sleep 1
tmux -S "$SOCKET" send-keys -t "$SESSION":0.0 -- 'echo -e "\n=== 内存信息 ===" && free -h' Enter
sleep 1
tmux -S "$SOCKET" send-keys -t "$SESSION":0.0 -- 'echo -e "\n=== 磁盘信息 ===" && df -h | grep -E "^/dev|^Filesystem"' Enter
sleep 1

# 查看输出
echo "正在捕获输出结果..."
tmux -S "$SOCKET" capture-pane -p -J -t "$SESSION":0.0 -S -500

# 清理会话（可选）
# tmux -S "$SOCKET" kill-session -t "$SESSION"

echo "操作完成。请检查上述输出结果。"