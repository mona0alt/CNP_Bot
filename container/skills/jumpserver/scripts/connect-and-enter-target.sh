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

CONNECT_TIMEOUT="${JUMPSERVER_CONNECT_TIMEOUT:-30}"

mkdir -p "$SOCKET_DIR"

redact_sensitive_output() {
  sed -E "s/(sshpass[[:space:]]+-p[[:space:]]+)(\"[^\"]*\"|'[^']*'|[^[:space:]]+)/\\1'***'/g"
}

# 抓取 pane 最后 N 行（默认 10），用于精确匹配最新输出
capture_tail() {
  local lines="${1:-10}"
  tmux -S "$SOCKET" capture-pane -p -J -t "$PANE" -S "-${lines}" 2>/dev/null || true
}

# 抓取 pane 大范围输出
capture_full() {
  tmux -S "$SOCKET" capture-pane -p -J -t "$PANE" -S -200 2>/dev/null || true
}

# 清空 pane 历史，确保后续 capture 只包含新输出
clear_pane_history() {
  tmux -S "$SOCKET" send-keys -t "$PANE" "" ""
  tmux -S "$SOCKET" clear-history -t "$PANE" 2>/dev/null || true
}

# 轮询等待 pane 最后几行匹配 pattern（快速、精确）
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
    if capture_tail 5 | grep -qE "$pattern"; then
      return 0
    fi
    sleep 0.3
  done
}

# 堡垒机菜单 pattern
MENU_PATTERN='\[Host\]>|Opt>|opt>'

# 检测是否在堡垒机菜单
is_at_menu() {
  capture_tail 5 | grep -qE "$MENU_PATTERN"
}

# ── 1. 确保 tmux session 存在 ──
if ! tmux -S "$SOCKET" has-session -t "$SESSION" 2>/dev/null; then
  tmux -S "$SOCKET" new-session -d -s "$SESSION" -n shell
  sleep 0.3
fi

# 判断 pane 当前进程是否为 SSH 会话（sshpass 包裹 ssh 时 pane_current_command 是 sshpass）
is_pane_in_ssh() {
  local cmd="$1"
  [[ "$cmd" == "ssh" || "$cmd" == "sshpass" ]]
}

# ── 2. 检查当前连接状态 ──
current_cmd="$(tmux -S "$SOCKET" display-message -p -t "$PANE" '#{pane_current_command}' 2>/dev/null || true)"

if is_pane_in_ssh "$current_cmd"; then
  if is_at_menu; then
    # 已在堡垒机菜单，直接跳到步骤 4 输入 IP
    echo "Already at jump server menu"
  else
    # run-remote-command.sh 已根据 current_target 决定需要连接/切换；
    # 这里不再通过 prompt 判断是否已在目标机，统一退回堡垒机菜单后重新进入目标。
    echo "Switching target: exiting current host..."
    clear_pane_history
    tmux -S "$SOCKET" send-keys -t "$PANE" "exit" Enter
    if ! wait_for_pattern "$MENU_PATTERN" 10; then
      echo "ERROR: 未能返回堡垒机菜单" >&2
      capture_tail 20 | redact_sensitive_output
      exit 1
    fi
  fi
fi

# ── 3. 如果不在 SSH 会话中，建立到 JumpServer 的连接 ──
current_cmd="$(tmux -S "$SOCKET" display-message -p -t "$PANE" '#{pane_current_command}' 2>/dev/null || true)"
if ! is_pane_in_ssh "$current_cmd"; then
  USE_SSHPASS=false
  if command -v sshpass &>/dev/null; then
    USE_SSHPASS=true
  fi
  if [[ "$USE_SSHPASS" == "true" ]]; then
    tmux -S "$SOCKET" send-keys -t "$PANE" -- \
      "sshpass -p '${JUMPSERVER_PASS}' ssh -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=60 ${JUMPSERVER_USER}@${JUMPSERVER_HOST} -p${JUMPSERVER_PORT}" Enter
  else
    tmux -S "$SOCKET" send-keys -t "$PANE" -- \
      "ssh -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=60 ${JUMPSERVER_USER}@${JUMPSERVER_HOST} -p${JUMPSERVER_PORT}" Enter
  fi
  if ! wait_for_pattern "$MENU_PATTERN" "$CONNECT_TIMEOUT"; then
    echo "ERROR: JumpServer 菜单等待超时 (${CONNECT_TIMEOUT}s)" >&2
    capture_tail 20 | redact_sensitive_output
    exit 1
  fi
fi

# ── 4. 输入目标 IP ──
tmux -S "$SOCKET" send-keys -t "$PANE" -- "$TARGET_IP" Enter

# ── 5. 等待目标机 shell prompt 出现（同时检测连接失败快速退出）──
wait_start=$(date +%s)
while true; do
  wait_now=$(date +%s)
  if (( wait_now - wait_start >= CONNECT_TIMEOUT )); then
    echo "ERROR: 目标主机连接超时 (${CONNECT_TIMEOUT}s)" >&2
    capture_tail 20 | redact_sensitive_output
    exit 1
  fi
  tail_output=$(capture_tail 5)
  # 检测目标机 shell prompt
  if echo "$tail_output" | tail -1 | grep -qE '(\$|#)\s*$'; then
    break
  fi
  # 检测 JumpServer 连接失败（返回菜单表示连接失败）
  if echo "$tail_output" | grep -qE 'error:|错误|网络不通'; then
    echo "ERROR: JumpServer 连接目标失败" >&2
    capture_tail 20 | redact_sensitive_output
    exit 1
  fi
  if echo "$tail_output" | tail -1 | grep -qE '\[Host\]>'; then
    echo "ERROR: 目标主机连接失败（已返回堡垒机菜单）" >&2
    capture_tail 20 | redact_sensitive_output
    exit 1
  fi
  sleep 0.3
done

# ── 6. 记录当前目标并输出 ──
echo "$TARGET_IP" > "${SOCKET_DIR}/current_target"

capture_full | redact_sensitive_output

cat <<EOF

tmux socket: $SOCKET
tmux session: $SESSION
target: $TARGET_IP
EOF
