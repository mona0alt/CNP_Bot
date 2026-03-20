#!/usr/bin/env bash
set -euo pipefail

# Usage: connect-and-enter-target.sh <target_ip>
# 原子操作：连接 JumpServer + 输入目标 IP + 轮询等待目标 prompt 出现
# 脚本返回时，已可在远程节点执行命令。

TARGET_IP="${1:?Usage: connect-and-enter-target.sh <target_ip>}"

: "${JUMPSERVER_HOST:?JUMPSERVER_HOST is required}"
: "${JUMPSERVER_USER:?JUMPSERVER_USER is required}"
: "${JUMPSERVER_PASS:?JUMPSERVER_PASS is required}"

JUMPSERVER_PORT="${JUMPSERVER_PORT:-2222}"
SOCKET_DIR="${TMPDIR:-/tmp}/cnpbot-tmux-sockets"
SOCKET="${SOCKET_DIR}/cnpbot.sock"
SESSION="${JUMPSERVER_TMUX_SESSION:-jumpserver}"
PANE="${SESSION}:0.0"

CONNECT_TIMEOUT="${JUMPSERVER_CONNECT_TIMEOUT:-90}"

mkdir -p "$SOCKET_DIR"

redact_sensitive_output() {
  sed -E "s/(sshpass[[:space:]]+-p[[:space:]]+)(\"[^\"]*\"|'[^']*'|[^[:space:]]+)/\\1'***'/g"
}

capture() {
  tmux -S "$SOCKET" capture-pane -p -J -t "$PANE" -S -200 2>/dev/null || true
}

# 轮询等待 pane 输出匹配 pattern，最多 timeout 秒
wait_for_pattern() {
  local pattern="$1"
  local timeout="$2"
  local start
  start=$(date +%s)
  while true; do
    local now
    now=$(date +%s)
    if (( now - start >= timeout )); then
      return 1
    fi
    local out
    out=$(capture)
    if echo "$out" | grep -qE "$pattern"; then
      return 0
    fi
    sleep 0.5
  done
}

# 检测远程 shell prompt（$ 或 # 结尾）
is_remote_prompt() {
  local out
  out=$(capture)
  local last_line
  last_line=$(echo "$out" | grep -v '^\s*$' | tail -1)
  [[ -z "$last_line" ]] && return 1
  echo "$last_line" | grep -qE '(\$|#)\s*$'
}

# ── 1. 确保 tmux session 存在 ──
if ! tmux -S "$SOCKET" has-session -t "$SESSION" 2>/dev/null; then
  tmux -S "$SOCKET" new-session -d -s "$SESSION" -n shell
  sleep 0.5
fi

# ── 2. 检查是否已经在目标机的 shell 上（已有连接可复用） ──
current_cmd="$(tmux -S "$SOCKET" display-message -p -t "$PANE" '#{pane_current_command}' 2>/dev/null || true)"
if [[ "$current_cmd" == "ssh" ]]; then
  if is_remote_prompt; then
    echo "REUSED_CONNECTION=true"
    capture | redact_sensitive_output
    exit 0
  fi
fi

# ── 3. SSH 连接到 JumpServer ──
USE_SSHPASS=false
if command -v sshpass &>/dev/null; then
  USE_SSHPASS=true
fi

if [[ "$current_cmd" != "ssh" ]]; then
  tmux -S "$SOCKET" send-keys -t "$PANE" C-c
  sleep 0.3

  if [[ "$USE_SSHPASS" == "true" ]]; then
    tmux -S "$SOCKET" send-keys -t "$PANE" -- \
      "sshpass -p '${JUMPSERVER_PASS}' ssh -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=60 ${JUMPSERVER_USER}@${JUMPSERVER_HOST} -p${JUMPSERVER_PORT}" Enter
  else
    tmux -S "$SOCKET" send-keys -t "$PANE" -- \
      "ssh -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=60 ${JUMPSERVER_USER}@${JUMPSERVER_HOST} -p${JUMPSERVER_PORT}" Enter
  fi
fi

# ── 4. 等待 JumpServer 菜单出现 (Opt>) ──
if ! wait_for_pattern 'Opt>|opt>|目标主机|请选择' "$CONNECT_TIMEOUT"; then
  echo "ERROR: JumpServer 菜单等待超时 (${CONNECT_TIMEOUT}s)" >&2
  capture | redact_sensitive_output
  exit 1
fi

# ── 5. 输入目标 IP ──
tmux -S "$SOCKET" send-keys -t "$PANE" -- "$TARGET_IP" Enter

# ── 6. 等待目标机 shell prompt 出现 ──
if ! wait_for_pattern '(\$|#)\s*$' "$CONNECT_TIMEOUT"; then
  echo "ERROR: 目标主机连接超时 (${CONNECT_TIMEOUT}s)" >&2
  capture | redact_sensitive_output
  exit 1
fi

# ── 7. 输出最终 pane 内容 ──
capture | redact_sensitive_output

cat <<EOF

tmux socket: $SOCKET
tmux session: $SESSION
target: $TARGET_IP
EOF
