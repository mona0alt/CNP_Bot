#!/usr/bin/env bash
set -euo pipefail

: "${JUMPSERVER_HOST:?JUMPSERVER_HOST is required}"
: "${JUMPSERVER_USER:?JUMPSERVER_USER is required}"
: "${JUMPSERVER_PASS:?JUMPSERVER_PASS is required}"

JUMPSERVER_PORT="${JUMPSERVER_PORT:-2222}"
SOCKET_DIR="${TMPDIR:-/tmp}/cnpbot-tmux-sockets"
SOCKET="${SOCKET_DIR}/cnpbot.sock"
SESSION="${JUMPSERVER_TMUX_SESSION:-jumpserver}"

mkdir -p "$SOCKET_DIR"

redact_sensitive_output() {
  sed -E "s/(sshpass[[:space:]]+-p[[:space:]]+)(\"[^\"]*\"|'[^']*'|[^[:space:]]+)/\\1'***'/g"
}

# 检查 sshpass 是否可用
USE_SSHPASS=false
if command -v sshpass &>/dev/null; then
  USE_SSHPASS=true
fi

if ! tmux -S "$SOCKET" has-session -t "$SESSION" 2>/dev/null; then
  tmux -S "$SOCKET" new-session -d -s "$SESSION" -n shell
  sleep 1
fi

if ! tmux -S "$SOCKET" has-session -t "$SESSION" 2>/dev/null; then
  echo "Failed to create tmux session '$SESSION' on socket '$SOCKET'" >&2
  exit 1
fi

pane_target="${SESSION}:0.0"
current_pane="$(
  tmux -S "$SOCKET" display-message -p -t "$pane_target" '#{pane_current_command}' 2>/dev/null || true
)"

if [[ "$current_pane" != "ssh" ]]; then
  # 清空当前 pane
  tmux -S "$SOCKET" send-keys -t "$pane_target" C-c
  sleep 1

  if [[ "$USE_SSHPASS" == "true" ]]; then
    # 使用 sshpass 自动输入密码，避免交互式输入
    tmux -S "$SOCKET" send-keys -t "$pane_target" -- "sshpass -p '${JUMPSERVER_PASS}' ssh -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=60 ${JUMPSERVER_USER}@${JUMPSERVER_HOST} -p${JUMPSERVER_PORT}" Enter
  else
    # 交互式 SSH 连接（需要手动输入密码）
    tmux -S "$SOCKET" send-keys -t "$pane_target" -- "ssh -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=60 ${JUMPSERVER_USER}@${JUMPSERVER_HOST} -p${JUMPSERVER_PORT}" Enter
  fi
  sleep 3
fi

tmux -S "$SOCKET" capture-pane -p -J -t "$pane_target" -S -200 | redact_sensitive_output

cat <<EOF

tmux socket: $SOCKET
tmux session: $SESSION
EOF

if [[ "$USE_SSHPASS" != "true" ]]; then
  echo "sshpass not found, using interactive mode:"
  echo "If the SSH prompt asks to trust the host, send: yes"
  echo "If it asks for a password, send: \$JUMPSERVER_PASS"
fi
