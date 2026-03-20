#!/usr/bin/env bash
set -euo pipefail

# Usage: run-remote-command.sh "<command>" [timeout_seconds]
# 原子操作：在远程节点上执行命令 + 轮询等待 prompt 返回 + 输出结果
# 前提：tmux jumpserver 会话已存在且已连接目标机

REMOTE_CMD="${1:?Usage: run-remote-command.sh \"<command>\" [timeout_seconds]}"
TIMEOUT="${2:-60}"

SOCKET_DIR="${TMPDIR:-/tmp}/cnpbot-tmux-sockets"
SOCKET="${SOCKET_DIR}/cnpbot.sock"
SESSION="${JUMPSERVER_TMUX_SESSION:-jumpserver}"
PANE="${SESSION}:0.0"

if ! tmux -S "$SOCKET" has-session -t "$SESSION" 2>/dev/null; then
  echo "ERROR: tmux session '$SESSION' 不存在，请先运行 connect-and-enter-target.sh" >&2
  exit 1
fi

redact_sensitive_output() {
  sed -E "s/(sshpass[[:space:]]+-p[[:space:]]+)(\"[^\"]*\"|'[^']*'|[^[:space:]]+)/\\1'***'/g"
}

# 发送命令
tmux -S "$SOCKET" send-keys -t "$PANE" -- "$REMOTE_CMD" Enter

# 轮询等待 prompt 返回
start=$(date +%s)
while true; do
  now=$(date +%s)
  if (( now - start >= TIMEOUT )); then
    echo "WARNING: 命令执行超时 (${TIMEOUT}s)，输出当前内容" >&2
    break
  fi
  sleep 0.5
  out=$(tmux -S "$SOCKET" capture-pane -p -J -t "$PANE" -S -50 2>/dev/null || true)
  if echo "$out" | tail -1 | grep -qE '(\$|#)\s*$'; then
    break
  fi
done

# 输出完整结果
tmux -S "$SOCKET" capture-pane -p -J -t "$PANE" -S -200 | redact_sensitive_output
