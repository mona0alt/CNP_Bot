# CNP-Bot

> Intelligent DevOps Agent — runs Claude agents securely in Docker containers, with a Web Chat frontend for real-time interaction.

<p align="center">
  <a href="README_zh.md">中文</a>
</p>

Lightweight, secure, customizable. Single Node.js process, React frontend, dual agent backend (Claude Agent SDK + Deep Agent), per-group container isolation.

## Features

- **Web Chat UI** — React SPA with real-time streaming, thinking blocks, tool cards, and multi-user auth (JWT)
- **Dual Agent Backend** — Claude Agent SDK (Node.js) and Deep Agent (Python/LangGraph), switchable per chat
- **Container Isolation** — Every conversation group runs in its own Docker container with independent filesystem
- **DevOps Skills** — Built-in JumpServer SSH, Prometheus monitoring, browser automation, tmux control
- **Dangerous Command Protection** — Rules engine blocks destructive Bash commands; requires explicit user approval via UI
- **Scheduled Tasks** — Cron / interval / one-time tasks that run as full agents
- **Per-group Memory** — Each group has its own `CLAUDE.md`, session state, and file workspace
- **Agent Swarms** — Experimental support for teams of agents collaborating on complex tasks

## Quick Start

### Docker (recommended)

```bash
git clone https://github.com/mona0alt/CNP_Bot.git
cd CNP_Bot

# Configure
cp .env.example .env
# Edit .env: set JWT_SECRET, ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN

# Build and run
./start_with_ip.sh --docker
```

### Manual

```bash
git clone https://github.com/mona0alt/CNP_Bot.git
cd CNP_Bot
npm install
cd frontend && npm install && cd ..
npm run build
npm start
```

### With Claude Code

```bash
git clone https://github.com/mona0alt/CNP_Bot.git
cd CNP_Bot
claude
```

Then run `/setup`. Claude Code handles dependencies, authentication, container setup, and service configuration.

## Architecture

```
Web Browser ──WebSocket──▶ Express + WS Server ──▶ SQLite ──▶ Message Loop
                                │                                   │
                                │                            GroupQueue (max 5)
                                │                                   │
                                ▼                                   ▼
                          React SPA                     Docker Container
                      (Chat, Dashboard,            ┌─────────────────────┐
                       Users, Login)               │  Agent Runner       │
                                                   │  (Claude SDK or     │
                                                   │   Deep Agent)       │
                                                   │                     │
                                                   │  Skills:            │
                                                   │  - JumpServer SSH   │
                                                   │  - Prometheus       │
                                                   │  - Browser          │
                                                   │  - Tmux             │
                                                   └─────────────────────┘
                                                     ▲           │
                                                     │  IPC      │ Stream
                                                     │ (fs-based)│ Events
                                                     ▼           ▼
                                                   ask/confirm ──▶ WebSocket ──▶ Frontend
```

Single Node.js process. Agents execute in isolated Docker containers. Only mounted directories are accessible. Per-group message queue with concurrency control. File-based IPC for ask/confirm workflows.

### Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Orchestrator: state, message loop, agent invocation |
| `src/server.ts` | Express HTTP + WebSocket server, JWT auth, REST API |
| `src/channels/web.ts` | Web Chat channel (WebSocket broadcast) |
| `src/container-runner.ts` | Spawns agent containers with volume mounts |
| `src/ipc.ts` | IPC watcher: ask/confirm requests, audit logging |
| `src/db.ts` | SQLite operations (messages, groups, sessions, users, audit) |
| `src/task-scheduler.ts` | Scheduled task execution |
| `src/group-queue.ts` | Per-group queue with global concurrency limit |
| `container/agent-runner/` | Claude Agent SDK runner (Node.js, runs inside container) |
| `container/deep-agent-runner/` | Deep Agent runner (Python/LangGraph, runs inside container) |
| `container/skills/` | Agent skills: jumpserver, prometheus, browser, tmux |
| `groups/*/CLAUDE.md` | Per-group memory |
| `frontend/` | React 19 + Tailwind CSS SPA |

## Usage

Talk to the assistant via Web Chat (default trigger: `@Assistant`):

```
@Assistant check CPU usage on prod-3 via Prometheus
@Assistant SSH into 10.245.17.1 and check disk space
@Assistant review the git history for the past week and summarize changes
@Assistant every Monday at 9am, compile a monitoring report and send it here
```

From the main channel, manage groups and tasks:

```
@Assistant list all scheduled tasks
@Assistant pause the Monday report task
@Assistant add group "Ops Team"
```

### Slash Commands

Type `/` in the chat input for autocomplete:

| Command | Effect |
|---------|--------|
| `/clear` | Clear conversation and start fresh session |
| `/compact` | Summarize and compact the session |

## Configuration

Key environment variables (`.env`):

```bash
JWT_SECRET=<required>               # JWT signing key
ASSISTANT_NAME=Assistant            # Trigger word (@Assistant)
DEFAULT_AGENT_TYPE=deepagent        # 'claude' or 'deepagent'
ANTHROPIC_API_KEY=sk-ant-api03-...  # Or CLAUDE_CODE_OAUTH_TOKEN
CONTAINER_IMAGE=cnp-bot-agent:latest
MAX_CONCURRENT_CONTAINERS=5
```

See [`docs/SPEC.md`](docs/SPEC.md) for full configuration reference.

## Security

- **Container isolation** — Agents run in Docker containers, not on the host. Bash commands execute inside the container.
- **Mount security** — External allowlist (`~/.config/cnp-bot/mount-allowlist.json`) controls which host directories can be mounted. Sensitive paths (`.ssh`, `.gnupg`) are always blocked.
- **Dangerous command protection** — Rules engine detects destructive commands (`rm -rf`, `shred`, `iptables -F`, etc.) and requires explicit approval via the UI before execution.
- **Audit trail** — Every dangerous command decision is logged to `command_audit_log` in SQLite.
- **Authentication** — JWT + bcrypt with role-based access (admin/user) and login rate limiting.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Backend | Node.js 20+, Express 5, WebSocket (ws), TypeScript |
| Frontend | React 19, Vite, Tailwind CSS, React Router 7 |
| Database | SQLite (better-sqlite3) |
| Agent (Node.js) | @anthropic-ai/claude-agent-sdk |
| Agent (Python) | LangChain + LangGraph + Anthropic |
| Container | Docker |
| Auth | JWT + bcrypt |
| Testing | Vitest + pytest |

## Testing

```bash
npm test           # TypeScript tests (55 test files)
npm run test:py    # Python deep-agent tests (4 test files)
npm run test:all   # Both
```

## Customizing

Tell Claude Code what you want:

- "Change the trigger word to @Bot"
- "Add a custom greeting when users say good morning"
- "Store conversation summaries weekly"

Or run `/customize` for guided changes. The codebase is small enough that Claude can safely modify it.

### Skills

Instead of adding features to the codebase, use [Claude Code skills](https://code.claude.com/docs/en/skills). Skills in `.claude/skills/` teach Claude Code how to transform the installation.

Container-side skills in `container/skills/`:
- **jumpserver** — SSH to servers via JumpServer bastion host
- **prometheus** — Query Prometheus metrics, render charts in chat
- **agent-browser** — Browser automation via Chromium
- **tmux** — Control tmux sessions for interactive CLIs

## Requirements

- Linux or macOS
- Node.js 20+
- Docker
- Python 3 (for Deep Agent runner)

## Deployment

| Method | Command |
|--------|---------|
| Docker | `./start_with_ip.sh --docker` |
| Kubernetes | `kubectl apply -f k8s/` |
| Manual | `npm run build && npm start` |
| Development | `npm run dev` |

## Project Structure

```
cnp-bot/
├── src/                    # Backend (TypeScript)
├── frontend/               # React SPA
├── container/
│   ├── agent-runner/       # Claude Agent SDK runner
│   ├── deep-agent-runner/  # Python/LangGraph runner
│   ├── skills/             # Agent skills (jumpserver, prometheus, etc.)
│   └── shared/             # Shared config (dangerous command rules)
├── skills-engine/          # Skill installer/updater
├── setup/                  # First-time setup CLI
├── k8s/                    # Kubernetes manifests
├── groups/                 # Per-group memory & workspace
├── store/                  # SQLite database
└── data/                   # Sessions, IPC namespaces
```

See [`docs/SPEC.md`](docs/SPEC.md) for the full specification.

## FAQ

**Why Docker?**
Docker provides cross-platform support and a mature ecosystem. Containers give OS-level isolation, not just application-level permission checks.

**Is this secure?**
Agents run in containers with filesystem isolation. Destructive commands require explicit approval. All decisions are audit-logged. The codebase is small enough to review entirely.

**How do I debug issues?**
Run `npm run dev` for verbose output, or ask Claude Code: "Why isn't the scheduler running?" "What's in the recent logs?"

## License

MIT
