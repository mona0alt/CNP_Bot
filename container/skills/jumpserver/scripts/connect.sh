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
  tmux -S "$SOCKET" send-keys -t "$pane_target" C-c
  sleep 1
  tmux -S "$SOCKET" send-keys -t "$pane_target" -- "ssh ${JUMPSERVER_USER}@${JUMPSERVER_HOST} -p${JUMPSERVER_PORT}" Enter
  sleep 3
fi

tmux -S "$SOCKET" capture-pane -p -J -t "$pane_target" -S -200

cat <<EOF

tmux socket: $SOCKET
tmux session: $SESSION
If the SSH prompt asks to trust the host, send: yes
If it asks for a password, send: \$JUMPSERVER_PASS
EOF
