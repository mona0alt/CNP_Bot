# Jumpserver Skill

This skill allows the agent to interact with Jumpserver.

## Diagnostic logging

- Set `JUMPSERVER_DEBUG=1` to enable long-term diagnostic logging for JumpServer execution.
- Diagnostics are emitted as debug logs only; they are **not** written into SQLite.
- Logs include command, phase, elapsed time, retry path, and prompt matching hints.
- Logs intentionally avoid re-printing the full remote command output body.
