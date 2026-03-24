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

jump_debug_enabled() {
  [[ "${JUMPSERVER_DEBUG:-0}" == "1" ]]
}

now_ms() {
  node -e 'process.stdout.write(String(Date.now()))'
}

jump_debug() {
  jump_debug_enabled || return 0
  printf 'JUMP_DEBUG script=run-remote-command %s\n' "$*" >&2
}

SCRIPT_START_MS="$(now_ms)"
jump_debug "phase=script_start target=$TARGET_IP timeout_s=$TIMEOUT command=\"$REMOTE_CMD\""

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
  jump_debug "phase=check_current_target current_target=$current_target target=$TARGET_IP"
  jump_debug "phase=ensure_target_connection_start current_target=$current_target target=$TARGET_IP"

  if [[ "$current_target" != "$TARGET_IP" ]]; then
    bash "${SCRIPT_DIR}/connect-and-enter-target.sh" "$TARGET_IP"
    jump_debug "phase=ensure_target_connection_done target=$TARGET_IP result=reconnected"
    return 0
  fi

  jump_debug "phase=ensure_target_connection_done target=$TARGET_IP result=reused"
}

run_once() {
  local attempt="${1:-1}"
  local wait_start_ms
  local elapsed_ms
  tmux -S "$SOCKET" send-keys -t "$PANE" -- "$REMOTE_CMD" Enter
  jump_debug "phase=remote_command_send attempt=$attempt target=$TARGET_IP command=\"$REMOTE_CMD\""

  local start
  local saw_prompt=false
  start=$(date +%s)
  wait_start_ms="$(now_ms)"
  jump_debug "phase=wait_remote_prompt_start attempt=$attempt timeout_s=$TIMEOUT target=$TARGET_IP"
  while true; do
    local now
    now=$(date +%s)
    if (( now - start >= TIMEOUT )); then
      elapsed_ms="$(( $(now_ms) - wait_start_ms ))"
      jump_debug "phase=remote_command_timeout attempt=$attempt target=$TARGET_IP elapsed_ms=$elapsed_ms reason=prompt_not_seen"
      echo "WARNING: 命令执行超时 (${TIMEOUT}s)，输出当前内容" >&2
      break
    fi
    sleep 0.3
    if capture_tail 3 | tail -1 | grep -qE '(\$|#)\s*$'; then
      saw_prompt=true
      elapsed_ms="$(( $(now_ms) - wait_start_ms ))"
      jump_debug "phase=wait_remote_prompt_done attempt=$attempt target=$TARGET_IP elapsed_ms=$elapsed_ms match_hint=shell_prompt"
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

if output="$(run_once 1)"; then
  jump_debug "phase=script_done target=$TARGET_IP result=success attempt=1 elapsed_ms=$(( $(now_ms) - SCRIPT_START_MS ))"
  printf '%s\n' "$output"
  exit 0
fi

jump_debug "phase=retry_after_failure attempt=1 retry=1 target=$TARGET_IP reason=run_once_failed"
rm -f "${SOCKET_DIR}/current_target"
bash "${SCRIPT_DIR}/connect-and-enter-target.sh" "$TARGET_IP"
if output="$(run_once 2)"; then
  jump_debug "phase=script_done target=$TARGET_IP result=success attempt=2 elapsed_ms=$(( $(now_ms) - SCRIPT_START_MS ))"
  printf '%s\n' "$output"
  exit 0
fi

jump_debug "phase=script_done target=$TARGET_IP result=error attempt=2 elapsed_ms=$(( $(now_ms) - SCRIPT_START_MS ))"
exit 1
