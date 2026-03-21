#!/usr/bin/env bash
set -euo pipefail

# Usage: run-remote-command.sh "<command>" [timeout_seconds] <target_ip>
# 原子操作：根据 current_target 决定是否切换目标机，然后在远程节点执行命令。

REMOTE_CMD="${1:?Usage: run-remote-command.sh \"<command>\" [timeout_seconds] <target_ip>}"
TIMEOUT="${2:-60}"
TARGET_IP="${3:?Usage: run-remote-command.sh \"<command>\" [timeout_seconds] <target_ip>}"

SOCKET_DIR="${TMPDIR:-/tmp}/cnpbot-tmux-sockets"
SOCKET="${SOCKET_DIR}/cnpbot.sock"
SESSION="${JUMPSERVER_TMUX_SESSION:-jumpserver}"
PANE="${SESSION}:0.0"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

redact_sensitive_output() {
  sed -E "s/(sshpass[[:space:]]+-p[[:space:]]+)(\"[^\"]*\"|'[^']*'|[^[:space:]]+)/\\1'***'/g"
}

capture_tail() {
  local lines="${1:-10}"
  tmux -S "$SOCKET" capture-pane -p -J -t "$PANE" -S "-${lines}" 2>/dev/null || true
}

capture_full() {
  tmux -S "$SOCKET" capture-pane -p -J -t "$PANE" -S -200 2>/dev/null || true
}

ensure_target_connection() {
  local current_target=""
  if [[ -f "${SOCKET_DIR}/current_target" ]]; then
    current_target="$(cat "${SOCKET_DIR}/current_target" 2>/dev/null || true)"
  fi

  if [[ "$current_target" != "$TARGET_IP" ]]; then
    bash "${SCRIPT_DIR}/connect-and-enter-target.sh" "$TARGET_IP"
  fi
}

run_once() {
  tmux -S "$SOCKET" send-keys -t "$PANE" -- "$REMOTE_CMD" Enter

  local start
  local saw_prompt=false
  start=$(date +%s)
  while true; do
    local now
    now=$(date +%s)
    if (( now - start >= TIMEOUT )); then
      echo "WARNING: 命令执行超时 (${TIMEOUT}s)，输出当前内容" >&2
      break
    fi
    sleep 0.3
    if capture_tail 3 | tail -1 | grep -qE '(\$|#)\s*$'; then
      saw_prompt=true
      break
    fi
  done

  capture_full | redact_sensitive_output
  if [[ "$saw_prompt" == "true" ]]; then
    return 0
  fi
  return 1
}

ensure_target_connection

if output="$(run_once)"; then
  printf '%s\n' "$output"
  exit 0
fi

rm -f "${SOCKET_DIR}/current_target"
bash "${SCRIPT_DIR}/connect-and-enter-target.sh" "$TARGET_IP"
run_once
