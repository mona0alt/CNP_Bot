# Deep Agent Integration Design

## Overview

Integrate Deep Agents (LangGraph-based Python agent framework) into CNP-Bot as an alternative agent backend alongside the existing Claude Agent SDK. Users select agent type when creating a new session; default is `deepagent`.

## Constraints

- Runs in pod (no Docker-in-Docker) — local mode only
- Feature branch: `feature/deep-agent-integration`
- Python runner, direct `deepagents` SDK calls
- Full IPC reuse (send_message, ask_user, confirm, tasks)

## Architecture

### File Layout

```
container/
├── agent-runner/              # Existing Claude Agent runner (TypeScript)
├── deep-agent-runner/         # NEW: Deep Agent runner (Python)
│   ├── pyproject.toml
│   ├── src/
│   │   ├── main.py            # Entry: stdin → create_deep_agent → astream → stdout
│   │   ├── protocol.py        # ContainerInput/ContainerOutput parsing & output
│   │   ├── ipc_tools.py       # LangChain Tools: send_message, ask_user, schedule_task, etc.
│   │   └── hooks.py           # Dangerous command interception via custom execute tool
│   └── README.md
├── shared/
│   └── dangerous-commands.json # Shared rules (single source of truth)
├── scripts/
│   ├── cnp-confirm            # Existing, reused by Python runner
│   └── cnp-ask                # Existing, reused by Python runner
```

### Data Flow

```
Host Node.js
  │ spawn python container/deep-agent-runner/src/main.py
  │ stdin: ContainerInput JSON (includes secrets)
  ▼
Python runner (main.py)
  │ 1. Parse ContainerInput, inject secrets to env
  │ 2. create_deep_agent(backend=LocalShellBackend, tools=[ipc_tools + custom_execute])
  │ 3. Multi-turn loop:
  │    ├── astream_events(prompt, thread_id) → stream to stdout
  │    ├── poll /workspace/ipc/input/ for follow-up messages
  │    ├── on follow-up → new astream_events() call with same thread_id
  │    └── on _close sentinel → break loop, emit final output
  │ stdout: ---CNP_BOT_OUTPUT_START--- JSON ---CNP_BOT_OUTPUT_END---
  ▼
Host parses output markers → callbacks → WebSocket → frontend
```

## Host-Side Changes

### 1. Configuration (`src/config.ts`)

```typescript
export type AgentType = 'claude' | 'deepagent';
export const DEFAULT_AGENT_TYPE: AgentType = 'deepagent';
export const DEEP_AGENT_MODEL = process.env.DEEP_AGENT_MODEL || 'claude-sonnet-4-6';
```

### 2. Database (`src/db.ts`)

- `sessions` table: add `agent_type TEXT DEFAULT 'deepagent'` column
- Read/write `agent_type` when creating/restoring sessions

### 3. Container Runner (`src/container-runner.ts`)

`runContainerAgent()` selects spawn command by `agentType`:

```typescript
if (agentType === 'deepagent') {
  spawnCmd = 'python';
  spawnArgs = [path.resolve(process.cwd(), 'container/deep-agent-runner/src/main.py')];
  spawnOptions.env.DEEP_AGENT_MODEL = DEEP_AGENT_MODEL;
  spawnOptions.env.DEEPAGENT_CHECKPOINT_DB = path.join(DATA_DIR, 'store', 'deepagent-checkpoints.db');
}
```

Workspace symlinks, IPC directories, output parsing — unchanged.

Secrets passed via stdin JSON (same as Claude runner), never via env vars or disk.

### 4. Main Loop (`src/index.ts`)

- Read `agentType` from session record, pass to `runContainerAgent()`

### 5. Web Channel (`src/channels/web.ts` + `src/server.ts`)

- `createSession` message accepts optional `agentType` field (default `'deepagent'`)
- Pass through to session creation

### 6. Frontend

- New session dialog: radio select (Deep Agent default / Claude Agent)
- Session list: small badge showing agent type
- Existing sessions: agent type immutable

## Python Runner Design

### `main.py` — Multi-Turn Loop

```python
async def main():
    # 1. Read stdin JSON
    raw = sys.stdin.read()
    container_input = parse_container_input(raw)
    # ContainerInput fields: prompt, sessionId, groupFolder, chatJid,
    #   isMain, isScheduledTask, assistantName, secrets

    # 2. Inject secrets to environment (never write to disk)
    if container_input.secrets:
        for key, value in container_input.secrets.items():
            os.environ[key] = value

    # 3. Determine session/thread ID
    #    - If sessionId provided → resume (use as thread_id)
    #    - If not → generate new UUID, return as newSessionId
    thread_id = container_input.session_id or str(uuid.uuid4())

    # 4. Load system prompt
    system_prompt = load_system_prompt()  # /workspace/global/CLAUDE.md + group CLAUDE.md

    # 5. Build agent
    workspace_root = os.environ.get('WORKSPACE_ROOT', '/workspace')
    checkpoint_db = os.environ.get('DEEPAGENT_CHECKPOINT_DB', './checkpoints.db')

    agent = create_deep_agent(
        model=os.environ.get('DEEP_AGENT_MODEL', 'claude-sonnet-4-6'),
        backend=LocalShellBackend(
            root_dir=os.path.join(workspace_root, 'group'),
            virtual_mode=False,
        ),
        tools=[send_message, ask_user, schedule_task, list_tasks,
               pause_task, resume_task, cancel_task, custom_execute],
        system_prompt=system_prompt,
        checkpointer=SqliteSaver.from_conn_string(checkpoint_db),
    )

    config = {"configurable": {"thread_id": thread_id}}

    # 6. Multi-turn loop (mirrors TypeScript runner)
    await run_query(agent, container_input.prompt, config, thread_id)

    while True:
        msg = await poll_ipc_input()  # 500ms poll, checks _close sentinel
        if msg is None:  # _close received
            break
        await run_query(agent, msg, config, thread_id)

async def run_query(agent, prompt, config, thread_id):
    """Run one agent query and stream output."""
    result_text = ""
    usage_info = {}

    async for event in agent.astream_events(
        {"messages": [HumanMessage(content=prompt)]},
        config=config,
        version="v2",
    ):
        kind = event["event"]

        if kind == "on_chat_model_stream":
            # Text delta → stream event to frontend
            chunk = event["data"]["chunk"]
            if hasattr(chunk, "content") and chunk.content:
                emit_stream_event({"type": "text_delta", "text": chunk.content})
                result_text += chunk.content

        elif kind == "on_tool_start":
            emit_stream_event({
                "type": "tool_use_start",
                "name": event["name"],
                "input": event["data"].get("input", {}),
            })

        elif kind == "on_tool_end":
            emit_stream_event({
                "type": "tool_use_end",
                "name": event["name"],
                "output": str(event["data"].get("output", "")),
            })

        elif kind == "on_chat_model_end":
            # Extract usage from response metadata
            usage_info = extract_usage(event["data"])

    # Emit final result
    emit_output({
        "status": "success",
        "result": result_text,
        "newSessionId": thread_id,
        "usage": usage_info,
    })
```

### `protocol.py` — I/O Protocol

**Input**: Parse `ContainerInput` JSON from stdin. Handle all fields:
- `prompt`, `sessionId`, `groupFolder`, `chatJid`, `isMain`
- `isScheduledTask`, `assistantName`, `secrets`

**Output**: Wrap `ContainerOutput` JSON with markers:
```
---CNP_BOT_OUTPUT_START---
{"status":"success","result":"...","newSessionId":"...","streamEvent":...,"usage":{...}}
---CNP_BOT_OUTPUT_END---
```

**Stream Event Format**: Deep Agent emits a unified event format that the host-side translates:

```python
def emit_stream_event(event: dict):
    """Emit a stream event as a ContainerOutput with streamEvent field."""
    emit_output({"status": "success", "result": None, "streamEvent": event})
```

Stream event types emitted by Python runner:
- `{"type": "text_delta", "text": "..."}` — text chunk
- `{"type": "tool_use_start", "name": "...", "input": {...}}` — tool invocation
- `{"type": "tool_use_end", "name": "...", "output": "..."}` — tool result

Host-side `index.ts` streaming callback needs a small adapter to map these to the existing frontend protocol (currently expects Anthropic-specific `content_block_start/delta/stop`). This adapter lives in `src/index.ts` near the existing stream event handler.

### `ipc_tools.py`

LangChain `@tool` decorated async functions, direct file I/O (no MCP):

| Tool | Implementation |
|------|---------------|
| `send_message` | Write JSON `{type, text, timestamp}` to `/workspace/ipc/messages/{ts}.json` |
| `ask_user` | Write `ask_requests/{id}.json` → `await asyncio.to_thread(poll_ask_responses, id)` |
| `schedule_task` | Write JSON to `/workspace/ipc/tasks/{id}.json` |
| `list_tasks` / `pause_task` / `resume_task` / `cancel_task` | Read/write `/workspace/ipc/tasks/` |

All IPC tools use async wrappers (`asyncio.to_thread`) for filesystem polling to avoid blocking the event loop. JSON message formats match the existing TypeScript MCP tool formats exactly.

### `hooks.py` — Dangerous Command Interception

Approach: **custom `execute` tool that replaces the default** from `LocalShellBackend`. This tool wraps the backend's `execute()` method with a dangerous command check before invocation:

```python
@tool
async def custom_execute(command: str, timeout: int = 120) -> str:
    """Execute a shell command with dangerous command checking."""
    danger = check_dangerous(command)  # Load from shared JSON
    if danger and danger["severity"] == "high":
        result = subprocess.run(
            [os.environ['CNP_CONFIRM_BIN'], command, danger["reason"]],
            timeout=300,
        )
        if result.returncode == 2:
            return f"Command denied by user: {danger['reason']}"
    # Execute via backend
    return await asyncio.to_thread(
        subprocess.run, command, shell=True,
        capture_output=True, text=True, timeout=timeout, cwd=workspace_root,
    )
```

The default `execute` tool from `FilesystemMiddleware` is excluded by NOT using `LocalShellBackend` as a `SandboxBackendProtocol` — instead pass it as a plain `FilesystemBackend` and provide our own `custom_execute` tool.

### Session Persistence

- **Separate SQLite file**: `{DATA_DIR}/store/deepagent-checkpoints.db`
  - Avoids SQLITE_BUSY conflicts (host uses `better-sqlite3` sync, Python uses `aiosqlite` async — two processes cannot safely share one SQLite file)
  - LangGraph creates its own tables: `checkpoints`, `checkpoint_blobs`, `checkpoint_writes`
- **Session ID flow**:
  - New session: `ContainerInput.sessionId` is undefined → Python runner generates UUID → returns as `newSessionId`
  - Resume: `ContainerInput.sessionId` is set → used as LangGraph `thread_id` → checkpointer loads state
- **PG migration**: swap `SqliteSaver` → `PostgresSaver` (`langgraph-checkpoint-postgres`), host DB also migrates to PG. Two SQLite files → one PG instance, straightforward.

### Usage & Cost Tracking

Extract from LangGraph's `on_chat_model_end` event metadata:

```python
def extract_usage(event_data: dict) -> dict:
    metadata = event_data.get("output", {}).get("response_metadata", {})
    usage = metadata.get("usage", {})
    return {
        "input_tokens": usage.get("input_tokens", 0),
        "output_tokens": usage.get("output_tokens", 0),
        "model_usage": {
            os.environ.get('DEEP_AGENT_MODEL', 'unknown'): {
                "input_tokens": usage.get("input_tokens", 0),
                "output_tokens": usage.get("output_tokens", 0),
            }
        },
    }
```

### Error Handling

- **Startup validation**: `main.py` checks Python version (>=3.11), attempts `import deepagents`, and reports import errors as `ContainerOutput(status='error')` before exiting
- **Runtime errors**: Caught in the main loop, emitted as `ContainerOutput(status='error', error='...')`
- **Process crash**: Host detects non-zero exit code + stderr, reports to user (existing logic)

## Dangerous Commands — Shared Rules

### JSON Schema

```json
[
  {
    "pattern": "rm\\s+-rf\\s+/(?!\\s*tmp/)",
    "severity": "high",
    "reason": "Recursive delete from root"
  }
]
```

- `pattern`: Regex string (PCRE-compatible subset that works in both JS and Python)
- `severity`: `"high"` (requires confirmation) or `"medium"` (warning only)
- `reason`: Human-readable explanation

**Regex compatibility note**: Avoid JS-only features (lookbehind `(?<=...)` works in both, but named groups use different syntax). All current patterns use basic PCRE that is compatible.

Both runners load from `container/shared/dangerous-commands.json`:
- TypeScript: `JSON.parse(fs.readFileSync(...))` → compile with `new RegExp(pattern)`
- Python: `json.load(open(...))` → compile with `re.compile(pattern)`

## Python Environment

- Pod Dockerfile adds Python 3.11+ and a venv:
  ```dockerfile
  RUN python3 -m venv /opt/deepagent-venv
  RUN /opt/deepagent-venv/bin/pip install -e container/deepagent/deepagents/libs/deepagents
  ```
- `container-runner.ts` spawns: `/opt/deepagent-venv/bin/python container/deep-agent-runner/src/main.py`
- Dependencies managed via `pyproject.toml` in `container/deep-agent-runner/`

## Change Summary

| Component | Change |
|-----------|--------|
| `container/deep-agent-runner/` | **NEW** — Python runner (main.py, protocol.py, ipc_tools.py, hooks.py) |
| `container/shared/dangerous-commands.json` | **NEW** — shared rules file |
| `container/agent-runner/src/dangerous-commands.ts` | **MODIFY** — load from JSON |
| `src/config.ts` | AgentType type + defaults + DEEP_AGENT_MODEL |
| `src/db.ts` | sessions table `agent_type` column |
| `src/container-runner.ts` | spawn branch (python path + env) |
| `src/index.ts` | pass agentType + stream event adapter for deep agent format |
| `src/channels/web.ts` + `src/server.ts` | pass agentType through |
| Frontend | new session UI + session list badge |
| Dockerfile | Python 3.11 + venv + deepagents SDK |
