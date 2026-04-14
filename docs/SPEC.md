# CNP-Bot Specification

Intelligent DevOps Agent. Single Node.js process with Web Chat frontend, routing messages to Claude agents running in isolated Docker containers. Each conversation group has independent filesystem and memory.

---

## Table of Contents

1. [Architecture](#architecture)
2. [Technology Stack](#technology-stack)
3. [Folder Structure](#folder-structure)
4. [Configuration](#configuration)
5. [Memory System](#memory-system)
6. [Session Management](#session-management)
7. [Message Flow](#message-flow)
8. [Agent System](#agent-system)
9. [Container System](#container-system)
10. [IPC System](#ipc-system)
11. [Dangerous Command Mechanism](#dangerous-command-mechanism)
12. [Scheduled Tasks](#scheduled-tasks)
13. [Slash Commands](#slash-commands)
14. [Skills Engine](#skills-engine)
15. [Frontend](#frontend)
16. [Deployment](#deployment)
17. [Security Model](#security-model)
18. [Testing](#testing)
19. [Troubleshooting](#troubleshooting)

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          HOST (Node.js Process)                          │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────────┐     ┌────────────────────┐     ┌───────────────┐  │
│  │  Express + WS    │     │  SQLite Database   │     │  React SPA    │  │
│  │  (HTTP + WebSocket)────│  (messages.db)     │     │  (frontend/)  │  │
│  └────────┬─────────┘     └─────────┬──────────┘     └───────────────┘  │
│           │                         │                                    │
│  ┌────────┴─────────┐              │                                    │
│  │  Web Channel     │              │                                    │
│  │  (channels/web)  │──────────────┘                                    │
│  └────────┬─────────┘                                                   │
│           │                                                              │
│  ┌────────┴─────────┐  ┌──────────────────┐  ┌───────────────────────┐  │
│  │  Message Loop    │  │  Scheduler Loop  │  │  IPC Watcher          │  │
│  │  (polls SQLite)  │  │  (checks tasks)  │  │  (ask/confirm/chart)  │  │
│  └────────┬─────────┘  └────────┬─────────┘  └───────────────────────┘  │
│           │                     │                                        │
│           └─────────┬───────────┘                                        │
│                     │ spawns container                                   │
│                     ▼                                                    │
├──────────────────────────────────────────────────────────────────────────┤
│                      DOCKER CONTAINER                                    │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  AGENT RUNNER (Claude Agent SDK / Deep Agent)                   │    │
│  │                                                                   │    │
│  │  Volume mounts:                                                   │    │
│  │    groups/{name}/              → /workspace/group                  │    │
│  │    groups/global/              → /workspace/global (non-main)     │    │
│  │    data/sessions/{group}/.claude/ → /home/node/.claude/           │    │
│  │    data/ipc/{group}/           → /workspace/ipc                   │    │
│  │    Additional dirs             → /workspace/extra/*               │    │
│  │                                                                   │    │
│  │  Tools:                                                           │    │
│  │    Bash, Read, Write, Edit, Glob, Grep, WebSearch, WebFetch      │    │
│  │    agent-browser (Chromium), mcp__cnp-bot__* (scheduler via IPC) │    │
│  │                                                                   │    │
│  │  Skills:                                                          │    │
│  │    jumpserver (SSH), prometheus (monitoring), tmux (terminal)     │    │
│  │                                                                   │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  ┌────────────────────��─────────┐  ┌────────────────────────────────┐   │
│  │  cnp-confirm / cnp-ask       │  │  dangerous-commands.json       │   │
│  │  (Bash IPC scripts)          │  │  (shared rules engine)         │   │
│  └──────────────────────────────┘  └────────────────────────────────┘   │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Technology Stack

### Backend

| Component | Technology | Purpose |
|-----------|------------|---------|
| Runtime | Node.js 20+ (TypeScript) | Host process |
| HTTP Server | Express.js 5.x | REST API |
| WebSocket | ws 8.x | Real-time streaming |
| Database | SQLite (better-sqlite3) | Messages, sessions, tasks, users |
| Auth | JWT (jsonwebtoken) + bcrypt | User authentication |
| Logging | Pino | Structured logging |
| Validation | Zod | Schema validation |
| Scheduling | cron-parser | Cron expression parsing |

### Frontend

| Component | Technology | Purpose |
|-----------|------------|---------|
| Framework | React 19 + React Router 7 | SPA |
| Build | Vite | Development & bundling |
| Styling | Tailwind CSS 3.4 | Utility-first CSS |
| Markdown | react-markdown + remark-gfm | Message rendering |
| Charts | Recharts | Prometheus metrics display |
| Syntax | react-syntax-highlighter | Code block rendering |
| Icons | Lucide React | UI icons |

### Agent / Container

| Component | Technology | Purpose |
|-----------|------------|---------|
| Claude Agent | @anthropic-ai/claude-agent-sdk | Node.js agent runner |
| Deep Agent | LangChain + LangGraph (Python) | Python agent runner |
| Container | Docker | Isolated execution |
| Browser | agent-browser + Chromium | Web automation |
| MCP | stdio-based transport | Host-container communication |

---

## Folder Structure

```
cnp-bot/
├── CLAUDE.md                          # Project context for Claude Code
├── package.json                       # Node.js dependencies
├── tsconfig.json                      # TypeScript configuration
├── vitest.config.ts                   # Test configuration
├── Dockerfile                         # Main deployment image
├── docker-compose.yml                 # Docker Compose orchestration
├── start_with_ip.sh                   # Docker startup script
├── setup.sh                           # Installation script
├── .mcp.json                          # MCP server configuration (reference)
│
├── docs/
│   └── SPEC.md                        # This specification document
│
├── src/                               # Backend source
│   ├── index.ts                       # Orchestrator: state, message loop, agent invocation
│   ├── server.ts                      # Express HTTP + WebSocket server, JWT auth, REST API
│   ├── channels/
│   │   └── web.ts                     # Web Chat channel (WebSocket broadcast)
│   ├── router.ts                      # Message formatting and outbound routing
│   ├── config.ts                      # Configuration constants and env reading
│   ├── types.ts                       # TypeScript interfaces (Channel, RegisteredGroup, etc.)
│   ├── db.ts                          # SQLite schema, migrations, CRUD operations
│   ├── env.ts                         # .env file reader
│   ├── logger.ts                      # Pino logger setup
│   ├── group-queue.ts                 # Per-group queue with global concurrency limit
│   ├── group-folder.ts                # Group folder path validation
│   ├── container-runner.ts            # Spawns agents in Docker containers
│   ├── container-runtime.ts           # Docker runtime abstraction
│   ├── ipc.ts                         # IPC watcher: ask/confirm requests, audit logging
│   ├── mount-security.ts              # Mount allowlist validation
│   ├── task-scheduler.ts              # Runs scheduled tasks when due
│   ├── slash-commands.ts              # Built-in slash commands (/clear, /compact, etc.)
│   ├── final-content.ts              # Merge streaming thinking blocks into final content
│   ├── deepagent-stream-event-adapter.ts  # Normalize Deep Agent events to SDK format
│   ├── jumpserver-stream-aggregator.ts    # Aggregate JumpServer SSH session events
│   ├── jumpserver-diagnostic-logging.ts   # JumpServer debug logging
│   └── *.test.ts                      # Vitest test files (co-located)
│
├── frontend/                          # React SPA
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   └── src/
│       ├── App.tsx                    # Router: ProtectedRoute, AdminRoute
│       ├── main.tsx                   # React entry point
│       ├── pages/
│       │   ├── Chat.tsx               # Main chat UI with streaming
│       │   ├── Dashboard.tsx          # Groups, tasks, stats overview
│       │   ├── Login.tsx              # JWT login
│       │   └── Users.tsx              # Admin user management
│       ├── components/
│       │   ├── Chat/MessageItem.test.tsx
│       │   ├── ConfirmBashCard.tsx     # Dangerous command approval UI
│       │   ├── AskUserCard.tsx         # Agent-to-user question dialog
│       │   ├── ToolCallCard.tsx        # Generic tool use display
│       │   ├── JumpServerSessionCard.tsx  # SSH session state display
│       │   ├── PrometheusChartCard.tsx    # Metrics chart rendering
│       │   ├── ThoughtProcess.tsx      # Thinking block display
│       │   ├── MarkdownRenderer.tsx    # Rich markdown with syntax highlight
│       │   ├── SlashCommandPopup.tsx   # Slash command autocomplete
│       │   ├── Layout.tsx / Sidebar.tsx / StatusSidebar.tsx
│       │   └── ConfirmDialog.tsx
│       ├── contexts/
│       │   ├── AuthContext.tsx         # JWT auth state & role checking
│       │   ├── StreamingMessagesContext.tsx  # WebSocket + message merging
│       │   └── ThemeContext.tsx        # Light/dark theme
│       ├── hooks/
│       │   └── useChatWebSocket.ts    # WebSocket connection hook
│       └── lib/
│           ├── types.ts               # Frontend type definitions
│           ├── message-parser.ts      # Parse tool cards from messages
│           ├── message-utils.ts       # Message formatting helpers
│           ├── thought-parser.ts      # Extract thinking blocks
│           ├── tool-redaction.ts      # Hide sensitive tool output
│           ├── tool-visibility.ts     # Filter which tools to display
│           ├── interactive-events.ts  # Ask/confirm event handling
│           └── utils.ts              # Generic utilities
│
├── container/                         # Container-side code
│   ├── Dockerfile                     # Agent container image (based on nanobot)
│   ├── build.sh                       # Build script
│   ├── agent-runner/                  # Claude Agent SDK runner (Node.js)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts               # Entry: stdin JSON → agent loop → stdout markers
│   │       ├── dangerous-commands.ts  # Dangerous command rules (source of truth)
│   │       ├── jumpserver-dangerous-command.ts  # JumpServer-specific rules
│   │       └── ipc-mcp-stdio.ts       # Stdio-based MCP server
│   ├── deep-agent-runner/             # Deep Agent runner (Python)
│   │   ├── pyproject.toml
│   │   └── src/
│   │       ├── main.py                # Entry: stdin JSON → LangGraph agent → stdout
│   │       ├── protocol.py            # Container I/O serialization
│   │       ├── ipc_tools.py           # IPC tool definitions
│   │       └── hooks.py               # Dangerous command hook
│   ├── shared/
│   │   └── dangerous-commands.json    # Shared dangerous command rules
│   ├── scripts/
│   │   ├── cnp-confirm                # Bash script: IPC command confirmation
│   │   └── cnp-ask                    # Bash script: IPC user question
│   └── skills/                        # Agent skills (synced into containers)
│       ├── agent-browser/SKILL.md     # Browser automation (Chromium)
│       ├── jumpserver/                # SSH via JumpServer bastion
│       │   ├── SKILL.md
│       │   └── scripts/*.sh
│       ├── prometheus/                # Prometheus monitoring queries
│       │   ├── SKILL.md
│       │   └── scripts/*.js
│       └── tmux/                      # Tmux session control
│           ├── SKILL.md
│           └── scripts/*.sh
│
├── skills-engine/                     # Skill installation/update engine
│   ├── index.ts                       # CLI entry point
│   ├── apply.ts / update.ts / uninstall.ts / rebase.ts
│   ├── manifest.ts / lock.ts / backup.ts
│   ├── types.ts / constants.ts
│   └── __tests__/                     # 19 test files
│
├── setup/                             # First-time setup CLI
│   ├── index.ts                       # Step-based setup wizard
│   ├── environment.ts / platform.ts / container.ts
│   ├── register.ts / mounts.ts / service.ts / verify.ts
│   └── *.test.ts                      # Setup tests
│
├── k8s/                               # Kubernetes manifests
│   ├── deployment.yaml
│   ├── service.yaml
│   ├── configmap.yaml
│   ├── secret.yaml
│   └── pvc.yaml
│
├── groups/                            # Group data (gitignored contents)
│   ├── global/CLAUDE.md               # Global shared memory
│   ├── main/                          # Main control channel
│   │   ├── CLAUDE.md
│   │   └── logs/
│   └── {group-folder}/               # Per-group folders
│       ├── CLAUDE.md                  # Group-specific memory
│       ├── logs/                      # Container execution logs
│       └── *.md                       # Files created by agent
│
├── store/                             # Persistent storage (gitignored)
│   └── messages.db                    # SQLite database
│
├── data/                              # Runtime state (gitignored)
│   ├── sessions/{group}/.claude/      # Per-group Claude session data
│   ├── ipc/{group}/                   # Per-group IPC namespace
│   │   ├── input/                     # Follow-up messages to container
│   │   ├── ask_requests/ / ask_responses/
│   │   ├── confirm_requests/ / confirm_responses/
│   │   └── messages/ / tasks/
│   └── {group}/agent-runner-src/      # Per-group customized agent runner
│
├── logs/                              # Runtime logs (gitignored)
│   ├── cnp-bot.log
│   └── cnp-bot.error.log
│
└── .claude/
    └── skills/                        # Claude Code skills for project management
```

---

## Configuration

### Environment Variables

All configuration is in `src/config.ts`, read from `.env` or process environment:

| Variable | Default | Purpose |
|----------|---------|---------|
| `ASSISTANT_NAME` | `'Assistant'` | Trigger word (`@Assistant`) |
| `ASSISTANT_HAS_OWN_NUMBER` | `false` | Whether bot has its own messaging identity |
| `USE_LOCAL_AGENT` | `false` | Skip Docker, run agent locally |
| `JWT_SECRET` | *(required)* | JWT signing key; fatal if missing |
| `JWT_EXPIRES_IN` | `'7d'` | JWT token expiration |
| `DEFAULT_AGENT_TYPE` | `'deepagent'` | `'claude'` or `'deepagent'` |
| `DEEP_AGENT_MODEL` | `'claude-sonnet-4-6'` | Model for Deep Agent runner |
| `DEEP_AGENT_RUNNER_PATH` | `'container/deep-agent-runner/src/main.py'` | Python runner path |
| `DEEP_AGENT_PYTHON` | `'/opt/deepagent-venv/bin/python'` | Python interpreter path |
| `CONTAINER_IMAGE` | `'cnp-bot-agent:latest'` | Docker image name |
| `CONTAINER_TIMEOUT` | `1800000` (30min) | Max container execution time |
| `CONTAINER_MAX_OUTPUT_SIZE` | `10485760` (10MB) | Max stdout from container |
| `IDLE_TIMEOUT` | `900000` (15min) | Keep container alive after last result |
| `MAX_CONCURRENT_CONTAINERS` | `5` | Global concurrency limit |
| `POLL_INTERVAL` | `2000` | Message loop poll interval (ms) |
| `SCHEDULER_POLL_INTERVAL` | `60000` | Task scheduler poll interval (ms) |
| `TZ` | *system timezone* | Timezone for cron expressions |

### System Settings Management

- Admins can manage editable system configuration from the `/settings` page in the React frontend.
- The settings UI reads from and writes back to the project `.env`; `.env` remains the single source of truth.
- Saving may be followed by a restart request through the same page, depending on whether the active runtime manager supports automated restart.
- Changing `JWT_SECRET` requires re-authentication after restart because existing JWT sessions become invalid.

### Container Configuration

Groups can have additional directories mounted via `containerConfig` in the SQLite `registered_groups` table:

```typescript
registerGroup("web:default", {
  name: "Dev Team",
  folder: "dev-team",
  trigger: "@Assistant",
  added_at: new Date().toISOString(),
  containerConfig: {
    additionalMounts: [
      { hostPath: "~/projects/webapp", containerPath: "webapp", readonly: false },
    ],
    timeout: 600000,
  },
});
```

Additional mounts appear at `/workspace/extra/{containerPath}` inside the container.

### Claude Authentication

Configure in `.env`:

```bash
# Option 1: OAuth token (Claude subscription)
CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-...

# Option 2: API Key (pay-per-use)
ANTHROPIC_API_KEY=sk-ant-api03-...

# Option 3: Custom endpoint (e.g., proxy)
ANTHROPIC_BASE_URL=http://192.168.231.128:30080
ANTHROPIC_MODEL=/model/MiniMax-M2___5
```

Only auth variables are extracted from `.env` and mounted into containers at `/workspace/env-dir/env`.

### Mount Security

Allowlist stored at `~/.config/cnp-bot/mount-allowlist.json` (outside project root, tamper-proof from agents):

```json
{
  "allowedRoots": [
    { "path": "~/projects", "allowReadWrite": true },
    { "path": "/var/repos", "allowReadWrite": false }
  ],
  "blockedPatterns": [".ssh", ".gnupg"],
  "nonMainReadOnly": true
}
```

---

## Memory System

Hierarchical memory based on CLAUDE.md files, automatically loaded by Claude Agent SDK.

### Memory Hierarchy

| Level | Location | Read By | Written By | Purpose |
|-------|----------|---------|------------|---------|
| **Global** | `groups/global/CLAUDE.md` | All groups | Main only | Shared preferences and context |
| **Group** | `groups/{name}/CLAUDE.md` | That group | That group | Group-specific memory |
| **Files** | `groups/{name}/*.md` | That group | That group | Notes, research, documents |

### How Memory Works

1. **Agent Context Loading**: Agent runs with `cwd` set to `groups/{group-name}/`. The Claude Agent SDK automatically loads `../CLAUDE.md` (global) and `./CLAUDE.md` (group).

2. **Writing Memory**: When user says "remember this", agent writes to `./CLAUDE.md`. Main channel can write to global memory.

3. **Main Channel Privileges**: Only the "main" group can write global memory, manage groups, and schedule cross-group tasks.

---

## Session Management

### How Sessions Work

1. Each group has a session ID in SQLite (`sessions` table, keyed by `group_folder`)
2. The `sessions` table also tracks `agent_type` (`'claude'` or `'deepagent'`) per group
3. Session ID is passed to the agent runner's `resume` option
4. Session transcripts stored as JSONL in `data/sessions/{group}/.claude/`
5. Deep Agent sessions use LangGraph SQLite checkpointing for thread persistence

### Agent Type Selection

- Default agent type set by `DEFAULT_AGENT_TYPE` env var
- Per-chat override via `chats.agent_type` column in SQLite
- Agent type persisted in `sessions.agent_type` for session continuity

---

## Message Flow

### Incoming Message Flow

```
1. User sends message via Web Chat
   │
   ▼
2. Express server receives via REST API or WebSocket
   │
   ▼
3. Web Channel stores message in SQLite + broadcasts to WebSocket clients
   │
   ▼
4. Message loop polls SQLite (every 2 seconds)
   │
   ▼
5. Router checks:
   ├── Is chat_jid in registered groups? → No: auto-register (web chats)
   └── Does message match trigger pattern? → No: store but don't process
   │     (Groups with requiresTrigger=false skip trigger check)
   ▼
6. GroupQueue enqueues processing:
   ├── Fetch messages since last agent interaction
   ├── Format with timestamp and sender name
   └── Build prompt with conversation context
   │
   ▼
7. Container Runner spawns Docker container:
   ├── Mount group folder, sessions, IPC namespace
   ├── Pass input JSON via stdin
   ��── Select agent runner (Claude SDK or Deep Agent)
   │
   ▼
8. Agent processes message:
   ├── Reads CLAUDE.md files for memory
   ├── Uses tools (Bash, WebSearch, browser, etc.)
   ├── Streams events: text_delta, tool_use, thinking
   └── Dangerous commands → IPC confirm flow
   │
   ▼
9. Stream events broadcast to frontend via WebSocket in real time
   │
   ▼
10. Final response stored in SQLite + sent via channel
```

### Trigger Word Matching

Messages must start with the trigger pattern (default: `@Assistant`):
- `@Assistant what's the status?` → Triggers agent
- `@assistant help me` → Triggers (case insensitive)
- `Hey @Assistant` → Ignored (trigger not at start)
- Solo chats with `requiresTrigger=false` → Every message triggers

### Conversation Catch-Up

When triggered, the agent receives all messages since its last interaction:

```
[Jan 31 2:32 PM] John: hey everyone, check the monitoring dashboard
[Jan 31 2:33 PM] Sarah: CPU looks high on prod-3
[Jan 31 2:35 PM] John: @Assistant can you check what's happening on prod-3?
```

---

## Agent System

CNP-Bot supports two agent backends, selectable per chat.

### Claude Agent SDK (Node.js)

- **Runner**: `container/agent-runner/src/index.ts`
- **SDK**: `@anthropic-ai/claude-agent-sdk`
- **Features**: Streaming, session resume, MCP tools, agent swarms (experimental)
- **Protocol**: Read `ContainerInput` JSON from stdin → run queries → emit output markers to stdout

### Deep Agent (Python)

- **Runner**: `container/deep-agent-runner/src/main.py`
- **SDK**: LangChain + LangGraph with Anthropic integration
- **Features**: Extended thinking (configurable budget), SQLite checkpointing, tool use streaming
- **Model**: `claude-sonnet-4-6` (configurable via `DEEP_AGENT_MODEL`)
- **Protocol**: Same stdin/stdout JSON protocol as Claude runner

### Output Protocol

Both runners emit results wrapped in markers:

```
---CNP_BOT_OUTPUT_START---
{
  "status": "success",
  "result": "...",
  "newSessionId": "...",
  "usage": { "inputTokens": ..., "outputTokens": ... },
  "streamEvent": { ... },
  "slashCommands": [...]
}
---CNP_BOT_OUTPUT_END---
```

### Stream Event Adaptation

`deepagent-stream-event-adapter.ts` normalizes Deep Agent events to Claude SDK format, enabling the frontend to use a single rendering pipeline for both agent types.

---

## Container System

### Architecture

- **Runtime**: Docker (abstracted in `container-runtime.ts`)
- **Image**: `cnp-bot-agent:latest` (built from `container/Dockerfile`, based on `nanobot`)
- **Max Concurrent**: 5 containers (configurable)
- **Idle Timeout**: 15 minutes (keeps container alive for follow-up messages)
- **Execution Timeout**: 30 minutes max

### Volume Mounts

Each container mounts:

```
/workspace/group         ← groups/{name}/              (read-write)
/workspace/global        ← groups/global/              (read-only, non-main only)
/workspace/extra/{name}  ← additional mounts            (per containerConfig)
/home/node/.claude       ← data/sessions/{group}/.claude/ (read-write)
/workspace/ipc           ← data/ipc/{group}/           (read-write)
```

### Container Lifecycle

1. **Spawn**: `runContainerAgent()` creates Docker container with volume mounts
2. **Input**: Initial prompt JSON piped via stdin
3. **Processing**: Agent runner processes query, polls IPC for follow-ups
4. **Streaming**: Events written to stdout, parsed by host
5. **Follow-up**: Additional messages arrive via `/workspace/ipc/input/*.json`
6. **Close**: `_close` sentinel file signals end of session
7. **Idle**: Container stays alive for `IDLE_TIMEOUT` (15min) for follow-ups

---

## IPC System

File-based JSON messaging between host and container, namespaced per group at `data/ipc/{group}/`.

### Directory Layout

```
data/ipc/{group}/
├── input/                # Host → Container: follow-up messages
│   ├── {uuid}.json       # Message payload
│   └── _close            # Sentinel to end session
├── ask_requests/         # Container → Host: ask user a question
├── ask_responses/        # Host → Container: user's answer
├── confirm_requests/     # Container → Host: dangerous command approval
├── confirm_responses/    # Host → Container: approve/deny
├── messages/             # Shared message channel
└── tasks/                # Task snapshots
```

### Ask Flow

1. Container writes `ask_requests/{requestId}.json` with `{ type: "ask_user", question: "..." }`
2. Host IPC watcher detects file, broadcasts to frontend via WebSocket
3. Frontend shows `<AskUserCard />` dialog
4. User responds → host writes `ask_responses/{requestId}.json`
5. Container `cnp-ask` script reads response and exits

### Confirm Flow

1. Agent hook detects dangerous command
2. Container writes `confirm_requests/{requestId}.json` with `{ type: "confirm_bash", command: "...", reason: "..." }`
3. Host broadcasts to frontend → `<ConfirmBashCard />` shown
4. User approves/denies → `confirm_responses/{requestId}.json` written
5. Container `cnp-confirm` script reads response, hook allows/blocks execution
6. Result logged to `command_audit_log` table

### Orphan Cleanup

Stale response files (unread for 10 minutes) are automatically cleaned by the IPC watcher.

---

## Dangerous Command Mechanism

Prevents destructive operations from running without explicit user approval.

### Rule Engine

Rules defined in `container/agent-runner/src/dangerous-commands.ts` (source of truth), exported as `container/shared/dangerous-commands.json` for the Python runner.

### Severity Levels

| Severity | Behavior | Examples |
|----------|----------|---------|
| `high` | Always requires approval | `rm -rf /`, `shred`, `chmod 777 /`, `iptables -F` |
| `medium` | Requires approval | `rmdir`, `git reset --hard` |

### Hook Integration

- **Claude SDK runner**: Pre-Bash hook via `spawnSync` (argument array, not shell string)
- **Deep Agent runner**: Python hook in `hooks.py`
- Both use the same shared rules engine

### Audit Trail

Every dangerous command decision is logged to `command_audit_log`:

```sql
CREATE TABLE command_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_folder TEXT NOT NULL,
  command TEXT NOT NULL,
  reason TEXT,
  approved INTEGER NOT NULL,
  timestamp TEXT NOT NULL
);
```

---

## Scheduled Tasks

Built-in scheduler runs tasks as full agents in their group's context.

### Schedule Types

| Type | Value Format | Example |
|------|--------------|---------|
| `cron` | Cron expression | `0 9 * * 1-5` (weekdays at 9am) |
| `interval` | Milliseconds | `3600000` (every hour) |
| `once` | ISO timestamp | `2025-03-27T10:00:00Z` |

### Context Modes

| Mode | Behavior |
|------|----------|
| `group` | Reuse the group's existing session state |
| `isolated` | Fresh session per task run |

### Task Lifecycle

1. Task created via MCP tool `schedule_task` or agent conversation
2. Scheduler loop polls every 60 seconds for due tasks
3. Task runs in separate container (no 15-min idle timeout — closes after result)
4. Run result logged to `task_run_logs` table
5. Task can send message back to chat via `send_message` IPC tool

### MCP Tools (available to agents via IPC)

| Tool | Purpose |
|------|---------|
| `schedule_task` | Create a recurring or one-time task |
| `list_tasks` | Show tasks (group's own, or all if main) |
| `get_task` | Get task details and run history |
| `update_task` | Modify task prompt or schedule |
| `pause_task` / `resume_task` | Toggle task status |
| `cancel_task` | Delete a task |
| `send_message` | Send message to the group's chat |

---

## Slash Commands

Built-in commands processed by `src/slash-commands.ts` before reaching the agent.

| Command | Effect |
|---------|--------|
| `/clear` | Clear conversation history and start fresh session |
| `/compact` | Compact session (summarize and reset) |
| Custom | Groups can register custom slash commands |

The frontend provides autocomplete via `<SlashCommandPopup />`.

---

## Skills Engine

Located at `skills-engine/`, manages agent skill installation and updates.

### Mechanism

1. Read skill manifest from `.claude/skills/{skillName}/SKILL.md`
2. Apply transformations (patches, file copies) to the codebase
3. Support rollback via backup system
4. Lock file for reproducible installs

### Container Skills

Skills synced into each container at startup:

| Skill | Purpose |
|-------|---------|
| `agent-browser` | Browser automation via Chromium/Playwright |
| `jumpserver` | SSH to servers via JumpServer bastion host |
| `prometheus` | Query Prometheus metrics, render charts |
| `tmux` | Control tmux sessions for interactive CLIs |

---

## Frontend

### Authentication

- **Default admin**: `admin / admin123` (created on first startup, must change)
- **JWT**: 7-day expiration, stored in localStorage
- **Rate limiting**: 10 failed login attempts per 15 minutes per IP
- **Roles**: `admin` (full access) and `user` (chat only)

### Pages

| Page | Route | Access | Purpose |
|------|-------|--------|---------|
| Login | `/login` | Public | JWT authentication |
| Chat | `/chat/:jid?` | User+ | Main conversation interface |
| Dashboard | `/` | User+ | Groups, tasks, stats overview |
| Users | `/users` | Admin | User CRUD and password management |
| Settings | `/settings` | Admin | System-wide configuration editor backed by `.env` |

### Real-time Streaming

`StreamingMessagesContext` manages WebSocket connection to `/ws`:

1. Receives stream events (text_delta, tool_use, thinking blocks)
2. Buffers and merges text deltas into messages
3. Preserves thinking blocks across message chunks
4. Renders specialized cards:
   - `<ConfirmBashCard />` — dangerous command approval
   - `<AskUserCard />` — agent question dialog
   - `<ToolCallCard />` — generic tool invocation display
   - `<JumpServerSessionCard />` — SSH session state
   - `<PrometheusChartCard />` — metrics visualization
   - `<ThoughtProcess />` — thinking block display

### REST API

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/auth/login` | POST | Authenticate, get JWT |
| `/api/chats` | POST | Create web chat session |
| `/api/chats/:jid/messages` | GET | Fetch chat history |
| `/api/system-config` | GET / PUT | Read and update admin-only system settings |
| `/api/system-config/restart` | POST | Request service restart after saving config |
| `/api/system-config/restart-status` | GET | Poll service restart progress/status |
| `/api/chats/:jid/messages` | POST | Send message |
| `/api/chats/:jid/stop` | POST | Stop agent generation |
| `/api/chats/:jid` | DELETE | Delete chat |
| `/api/groups` | GET | List registered groups |
| `/api/users` | GET/POST | Admin: list/create users |
| `/api/users/:id/password` | PUT | Change password |
| `/ws` | WebSocket | Real-time streaming |

---

## Deployment

### Docker Deployment (recommended)

```bash
# Build and start with Docker
./start_with_ip.sh --docker
```

This script:
1. Builds the Docker image (Node.js backend + React frontend + Python deep-agent env)
2. Compiles TypeScript and Vite frontend
3. Installs container skills into `.claude/`
4. Starts the service

### Development

```bash
npm run dev        # Watch mode (tsx watch + Vite dev server)
npm run build      # Compile TypeScript + build frontend
npm start          # Run compiled dist/index.js
```

### Kubernetes

Manifests in `k8s/`:

```bash
kubectl apply -f k8s/
```

Includes: Deployment, Service, ConfigMap, Secret, PVC.

### Startup Sequence

1. Validate `JWT_SECRET` is configured (fatal if missing)
2. Initialize SQLite database (create tables, run migrations)
3. Load state from SQLite (registered groups, sessions, router state)
4. Start Express HTTP server + WebSocket
5. Connect channels (Web)
6. Start scheduler loop and IPC watcher
7. Set up per-group queue with `processGroupMessages`
8. Recover unprocessed messages from before shutdown
9. Start message polling loop

### Setup CLI

First-time setup wizard:

```bash
npm run setup
```

Steps: environment validation → platform detection → container setup → group registration → mount configuration → service installation → verification.

---

## Security Model

### Container Isolation

All agents run inside Docker containers:
- **Filesystem isolation**: Agents only access mounted directories
- **Safe Bash access**: Commands run inside container, not on host
- **Process isolation**: Container processes can't affect host
- **Non-root user**: Container runs as unprivileged `node` user (uid 1000)
- **Per-group IPC namespace**: Groups cannot read each other's IPC files

### Mount Security

- Allowlist stored at `~/.config/cnp-bot/mount-allowlist.json` (outside project, tamper-proof)
- Blocked patterns (`.ssh`, `.gnupg`) always filtered
- Non-main groups restricted to read-only unless explicitly allowed
- `validateAdditionalMounts()` prevents privilege escalation

### Dangerous Commands

- Rules engine checks Bash commands before execution
- High-severity commands require explicit user approval via IPC
- All decisions logged to `command_audit_log` for audit trail

### Authentication

- JWT tokens for API access, bcrypt for password hashing
- Login rate limiting prevents brute force
- Admin role required for user management endpoints
- Web JID verification: only `web:` prefixed chats accepted by web channel

### Prompt Injection Mitigation

- Container isolation limits blast radius
- Only registered groups processed
- Trigger word reduces accidental processing
- Per-group filesystem isolation
- Dangerous command approval prevents destructive operations

### Credential Storage

| Credential | Storage | Notes |
|------------|---------|-------|
| Claude Auth | `data/sessions/{group}/.claude/` | Per-group isolation |
| JWT Secret | `.env` | Required, fatal if missing |
| User Passwords | SQLite (bcrypt hash) | Never stored in plaintext |

---

## Testing

### Framework

Vitest for TypeScript, pytest for Python.

### Running Tests

```bash
npm test           # All TypeScript tests
npm run test:py    # Python deep-agent tests
npm run test:all   # Both Node + Python
npm run test:watch # Watch mode
```

### Test Coverage

**Backend (`src/*.test.ts`)** — 24 test files:

| Test File | Coverage |
|-----------|----------|
| `db.test.ts` | SQLite CRUD, sessions, users, tasks, router state |
| `server-chat.test.ts` | WebSocket session integration, tool card streaming |
| `server-create-chat.test.ts` | Chat creation API |
| `server-confirm-bash.test.ts` | Confirm bash API flow |
| `web-channel.test.ts` | Web channel message routing |
| `slash-commands.test.ts` | /clear, /compact, custom commands |
| `mount-security.test.ts` | Mount allowlist validation |
| `container-runtime.test.ts` | Docker lifecycle |
| `group-queue.test.ts` | Concurrent queue management |
| `group-folder.test.ts` | Folder path validation |
| `routing.test.ts` | Message routing logic |
| `formatting.test.ts` | Message formatting |
| `ipc-auth.test.ts` / `ipc-confirm-bash.test.ts` / `ipc-chart-message.test.ts` | IPC mechanisms |
| `confirm-bash.test.ts` / `frontend-confirm-event.test.ts` | Confirm flow |
| `dangerous-commands.test.ts` / `dangerous-commands-shared.test.ts` | Command rules |
| `jumpserver-*.test.ts` (4 files) | JumpServer SSH integration |
| `deepagent-stream-event-adapter.test.ts` | Event normalization |
| `final-content.test.ts` | Thinking block merging |
| `task-scheduler.test.ts` | Cron scheduling |

**Frontend (`frontend/src/**/*.test.{ts,tsx}`)** — 8 test files:

| Test File | Coverage |
|-----------|----------|
| `Chat.integration.test.tsx` | End-to-end chat flow |
| `MessageItem.test.tsx` | Message rendering |
| `ConfirmBashCard.test.tsx` | Confirm dialog UI |
| `JumpServerSessionCard.test.tsx` | SSH card rendering |
| `message-utils.test.ts` | Message helpers |
| `tool-redaction.test.ts` | Sensitive data filtering |
| `tool-visibility.test.ts` | Tool display filtering |
| `streaming-session-recovery.test.ts` | WebSocket reconnection |

**Setup (`setup/*.test.ts`)** — 4 test files:

| Test File | Coverage |
|-----------|----------|
| `environment.test.ts` | Env validation |
| `platform.test.ts` | OS detection |
| `register.test.ts` | Group registration |
| `service.test.ts` | Service installation |

**Skills Engine (`skills-engine/__tests__/*.test.ts`)** — 19 test files:

Covers: apply, backup, constants, customize, file-ops, lock, manifest, merge, path-remap, rebase, replay, state, structured, uninstall, update, etc.

**Python (`container/deep-agent-runner/tests/`)** — 4 test files:

| Test File | Coverage |
|-----------|----------|
| `test_hooks.py` | Dangerous command hook |
| `test_ipc_tools.py` | IPC tool definitions |
| `test_main.py` | Agent runner entry |
| `test_protocol.py` | I/O serialization |

---

## Database Schema

SQLite database at `store/messages.db`:

```sql
-- Chat sessions
chats (jid, name, last_message_time, channel, is_group, user_id, agent_type)

-- Message history
messages (id, chat_jid, sender, sender_name, content, timestamp, is_from_me, is_bot_message)
  INDEX idx_messages_chat_ts ON messages(chat_jid, timestamp)

-- Group registration
registered_groups (jid, name, folder, trigger_pattern, added_at, container_config, requires_trigger)

-- Session persistence
sessions (group_folder, session_id, agent_type)

-- Scheduled tasks
scheduled_tasks (id, group_folder, chat_jid, prompt, schedule_type, schedule_value,
                 next_run, last_run, last_result, status, created_at, context_mode)

-- Task execution logs
task_run_logs (id, task_id, run_at, duration_ms, status, result, error)

-- User accounts
users (id, username, password_hash, role, display_name, created_at, updated_at, last_login)

-- Dangerous command audit
command_audit_log (id, group_folder, command, reason, approved, timestamp)

-- Key-value state
router_state (key, value)
```

---

## Troubleshooting

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| No response to messages | Service not running | Check `docker ps` or `node dist/index.js` |
| "JWT_SECRET is not configured" | Missing env var | Set `JWT_SECRET` in `.env` |
| Container exits with code 1 | Session mount path wrong | Ensure mount is to `/home/node/.claude/` not `/root/.claude/` |
| Session not continuing | Session ID not saved | Check SQLite: `sqlite3 store/messages.db "SELECT * FROM sessions"` |
| Agent not responding | Wrong agent type | Check `DEFAULT_AGENT_TYPE` and per-chat `agent_type` |
| Dangerous command not prompting | Rules not matching | Check `container/shared/dangerous-commands.json` |
| IPC confirm timeout | Orphan response file | Watcher auto-cleans after 10 minutes |

### Log Locations

- `logs/cnp-bot.log` — Host stdout
- `logs/cnp-bot.error.log` — Host stderr
- `groups/{folder}/logs/container-*.log` — Per-container logs

### Debug Mode

```bash
npm run dev    # Watch mode with verbose output
```
