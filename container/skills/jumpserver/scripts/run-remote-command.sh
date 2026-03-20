#!/usr/bin/env bash
set -euo pipefail

# Usage: run-remote-command.sh "<command>" [timeout_seconds] [target_ip]
# 原子操作：在远程节点上执行命令 + 轮询等待 prompt 返回 + 输出结果
#
# target_ip（可选）：传入后脚本会检查当前是否在该目标机上，
#                   不一致则自动调用 connect-and-enter-target.sh 切换

REMOTE_CMD="${1:?Usage: run-remote-command.sh \"<command>\" [timeout_seconds] [target_ip]}"
TIMEOUT="${2:-60}"
TARGET_IP="${3:-}"

SOCKET_DIR="${TMPDIR:-/tmp}/cnpbot-tmux-sockets"
SOCKET="${SOCKET_DIR}/cnpbot.sock"
SESSION="${JUMPSERVER_TMUX_SESSION:-jumpserver}"
PANE="${SESSION}:0.0"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 如果没传 TARGET_IP，尝试从文件读取上次连接的目标
if [[ -z "$TARGET_IP" ]] && [[ -f "${SOCKET_DIR}/current_target" ]]; then
  TARGET_IP="$(cat "${SOCKET_DIR}/current_target" 2>/dev/null || true)"
fi

redact_sensitive_output() {
  sed -E "s/(sshpass[[:space:]]+-p[[:space:]]+)(\"[^\"]*\"|'[^']*'|[^[:space:]]+)/\\1'***'/g"
}

capture_tail() {
  local lines="${1:-10}"
  tmux -S "$SOCKET" capture-pane -p -J -t "$PANE" -S "-${lines}" 2>/dev/null || true
}

is_connected_to_target() {
  local target="$1"
  local escaped_target
  escaped_target=$(echo "$target" | sed 's/\./\\./g')
  local ip_as_dash
  ip_as_dash=$(echo "$target" | tr '.' '-')
  local last_lines
  last_lines=$(capture_tail 5)
  echo "$last_lines" | grep -qE "@[^]]*($escaped_target|$ip_as_dash)" && return 0
  return 1
}

# ── 确保连接就绪 ──
SESSION_EXISTS=false
if tmux -S "$SOCKET" has-session -t "$SESSION" 2>/dev/null; then
  SESSION_EXISTS=true
fi

if [[ -n "$TARGET_IP" ]]; then
  # 有 TARGET_IP：session 不存在或目标不匹配，自动连接/切换
  if [[ "$SESSION_EXISTS" == "false" ]] || ! is_connected_to_target "$TARGET_IP"; then
    bash "${SCRIPT_DIR}/connect-and-enter-target.sh" "$TARGET_IP"
  fi
elif [[ "$SESSION_EXISTS" == "false" ]]; then
  echo "ERROR: tmux session '$SESSION' 不存在，请先运行 connect-and-enter-target.sh" >&2
  exit 1
fi

# ── 发送命令 ──
tmux -S "$SOCKET" send-keys -t "$PANE" -- "$REMOTE_CMD" Enter

# ── 轮询等待 prompt 返回 ──
start=$(date +%s)
while true; do
  now=$(date +%s)
  if (( now - start >= TIMEOUT )); then
    echo "WARNING: 命令执行超时 (${TIMEOUT}s)，输出当前内容" >&2
    break
  fi
  sleep 0.3
  if capture_tail 3 | tail -1 | grep -qE '(\$|#)\s*$'; then
    break
  fi
done

# ── 输出完整结果 ──
tmux -S "$SOCKET" capture-pane -p -J -t "$PANE" -S -200 | redact_sensitive_output
