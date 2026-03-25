# Deep Agent Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate Deep Agents (LangGraph Python framework) as an alternative agent backend in CNP-Bot, selectable per session, defaulting to deepagent.

**Architecture:** Python runner (`deep-agent-runner`) communicates with the host via the existing stdin/stdout + OUTPUT marker protocol. Host-side adds `agentType` routing at the config, DB, container-runner, and frontend layers. IPC is fully reused via filesystem.

**Tech Stack:** Python 3.11+, deepagents SDK (LangGraph), LangChain tools, Vitest (host tests), pytest (Python tests)

**Spec:** `docs/superpowers/specs/2026-03-24-deep-agent-integration-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `container/deep-agent-runner/pyproject.toml` | Python dependencies |
| `container/deep-agent-runner/src/__init__.py` | Package marker |
| `container/deep-agent-runner/src/main.py` | Entry point: stdin → agent → stdout, multi-turn loop |
| `container/deep-agent-runner/src/protocol.py` | ContainerInput/Output parsing, OUTPUT markers |
| `container/deep-agent-runner/src/ipc_tools.py` | LangChain tools: send_message, ask_user, schedule_task, etc. |
| `container/deep-agent-runner/src/hooks.py` | Custom execute tool with dangerous command check |
| `container/deep-agent-runner/tests/__init__.py` | Test package marker |
| `container/deep-agent-runner/tests/conftest.py` | sys.path setup so `from src.X import ...` works |
| `container/deep-agent-runner/tests/test_protocol.py` | Protocol unit tests |
| `container/deep-agent-runner/tests/test_ipc_tools.py` | IPC tools unit tests |
| `container/deep-agent-runner/tests/test_hooks.py` | Dangerous command check tests |
| `container/deep-agent-runner/tests/test_main.py` | Main entry integration tests |
| `container/shared/dangerous-commands.json` | Shared dangerous command rules |
| `src/dangerous-commands-shared.test.ts` | Shared JSON validation test |

### Modified Files

| File | Change |
|------|--------|
| `src/config.ts` | Add `AgentType`, `DEFAULT_AGENT_TYPE`, `DEEP_AGENT_MODEL` (after line 23) |
| `src/db.ts` | Add `agent_type` to `sessions` + `chats` tables; update get/set/getAllSessions; ALTER TABLE migration |
| `src/container-runner.ts` | Add `agentType` to `ContainerInput` interface (line 35); Python spawn branch in USE_LOCAL_AGENT (line 330) |
| `src/index.ts` | Change `sessions` type (line 117); pass agentType through (lines 954-1017); stream event adapter (line 631+) |
| `src/server.ts` | Accept `agentType` in `POST /api/chats` (line 244); return in `GET /api/chats` |
| `src/db.test.ts` | Update existing session tests to match new return type; add agentType tests |
| `container/agent-runner/src/dangerous-commands.ts` | Load patterns from shared JSON |
| `frontend/src/lib/types.ts` | Add `agent_type` to Chat interface |
| `frontend/src/pages/Chat.tsx` | Send agentType in POST body; agent type selector UI |
| `frontend/src/components/Chat/ChatSidebar.tsx` | Show agent type badge |
| `frontend/src/hooks/useChatWebSocket.ts` | Handle deep agent stream event format |

---

## Task 0: Create Feature Branch

**Files:** None (git only)

- [ ] **Step 1: Create and switch to feature branch**

```bash
cd /root/project/CNP_BOT/CNP_Bot
git checkout -b feature/deep-agent-integration
```

- [ ] **Step 2: Verify branch**

```bash
git branch --show-current
```

Expected: `feature/deep-agent-integration`

---

## Task 1: Shared Dangerous Commands JSON

**Files:**
- Create: `container/shared/dangerous-commands.json`
- Modify: `container/agent-runner/src/dangerous-commands.ts`
- Create: `src/dangerous-commands-shared.test.ts`

- [ ] **Step 1: Write the test for shared JSON loading**

```typescript
// src/dangerous-commands-shared.test.ts
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('shared dangerous-commands.json', () => {
  const jsonPath = path.resolve(__dirname, '../container/shared/dangerous-commands.json');

  it('exists and is valid JSON', () => {
    const raw = fs.readFileSync(jsonPath, 'utf-8');
    const rules = JSON.parse(raw);
    expect(Array.isArray(rules)).toBe(true);
    expect(rules.length).toBeGreaterThan(0);
  });

  it('each rule has pattern, severity, reason', () => {
    const rules = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    for (const rule of rules) {
      expect(rule).toHaveProperty('pattern');
      expect(rule).toHaveProperty('severity');
      expect(rule).toHaveProperty('reason');
      expect(['high', 'medium']).toContain(rule.severity);
      expect(() => new RegExp(rule.pattern)).not.toThrow();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test src/dangerous-commands-shared.test.ts
```

Expected: FAIL — file does not exist

- [ ] **Step 3: Read existing dangerous-commands.ts and extract patterns to JSON**

Read `container/agent-runner/src/dangerous-commands.ts` (lines 7-49) and extract ALL patterns from the `DANGEROUS_PATTERNS` array. Convert each `re: /pattern/` to a JSON string. Verify each compiles in both JS (`new RegExp()`) and Python (`re.compile()`).

Create `container/shared/dangerous-commands.json` with schema:
```json
[
  {"pattern": "regex_string", "severity": "high|medium", "reason": "human readable"}
]
```

- [ ] **Step 4: Refactor dangerous-commands.ts to load from JSON**

```typescript
// container/agent-runner/src/dangerous-commands.ts
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface DangerousRule {
  pattern: string;
  severity: 'high' | 'medium';
  reason: string;
}

const rulesJson: DangerousRule[] = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../shared/dangerous-commands.json'), 'utf-8')
);

export const DANGEROUS_PATTERNS = rulesJson.map((rule) => ({
  re: new RegExp(rule.pattern),
  reason: rule.reason,
  severity: rule.severity,
}));

export type DangerousSeverity = 'high' | 'medium';

export function checkDangerous(cmd: string): { reason: string; severity: DangerousSeverity } | null {
  for (const p of DANGEROUS_PATTERNS) {
    if (p.re.test(cmd)) {
      return { reason: p.reason, severity: p.severity };
    }
  }
  return null;
}
```

- [ ] **Step 5: Run all tests**

```bash
npm test
```

Expected: All pass (shared JSON test + existing dangerous command tests)

- [ ] **Step 6: Commit**

```bash
git add container/shared/dangerous-commands.json container/agent-runner/src/dangerous-commands.ts src/dangerous-commands-shared.test.ts
git commit -m "refactor: extract dangerous command rules to shared JSON"
```

---

## Task 2: Host Configuration (`src/config.ts`)

**Files:**
- Modify: `src/config.ts`

- [ ] **Step 1: Add AgentType and related constants**

After line 23 (after `SCHEDULER_POLL_INTERVAL`), add:

```typescript
export type AgentType = 'claude' | 'deepagent';
export const DEFAULT_AGENT_TYPE: AgentType =
  (process.env.DEFAULT_AGENT_TYPE as AgentType) || 'deepagent';
export const DEEP_AGENT_MODEL = process.env.DEEP_AGENT_MODEL || 'claude-sonnet-4-6';
export const DEEP_AGENT_RUNNER_PATH = process.env.DEEP_AGENT_RUNNER_PATH ||
  'container/deep-agent-runner/src/main.py';
export const DEEP_AGENT_PYTHON = process.env.DEEP_AGENT_PYTHON ||
  '/opt/deepagent-venv/bin/python';
```

- [ ] **Step 2: Run tests**

```bash
npm test
```

Expected: All pass

- [ ] **Step 3: Commit**

```bash
git add src/config.ts
git commit -m "feat: add AgentType config constants for deep agent"
```

---

## Task 3: Database Schema (`src/db.ts` + `src/db.test.ts`)

**Files:**
- Modify: `src/db.ts`
- Modify: `src/db.test.ts`
- Modify: `src/index.ts`

This task changes `getSession`/`setSession`/`getAllSessions` return types AND updates ALL callers and ALL existing tests in one atomic step to avoid intermediate breakage.

- [ ] **Step 1: Update existing session tests + add new tests in db.test.ts**

Replace the entire `describe('sessions')` block (lines 380-408 of `src/db.test.ts`):

```typescript
describe('sessions', () => {
  it('returns null for missing session', () => {
    expect(getSession('nonexistent')).toBeNull();
  });

  it('stores and retrieves a session (default agentType)', () => {
    setSession('main', 'sess-abc-123');
    expect(getSession('main')).toEqual({ sessionId: 'sess-abc-123', agentType: 'deepagent' });
  });

  it('overwrites on re-set', () => {
    setSession('main', 'old-id');
    setSession('main', 'new-id');
    expect(getSession('main')).toEqual({ sessionId: 'new-id', agentType: 'deepagent' });
  });

  it('returns all sessions as a map', () => {
    setSession('main', 'sess-1');
    setSession('other', 'sess-2', 'claude');
    const all = getAllSessions();
    expect(all).toEqual({
      main: { sessionId: 'sess-1', agentType: 'deepagent' },
      other: { sessionId: 'sess-2', agentType: 'claude' },
    });
  });

  it('deletes a session', () => {
    setSession('main', 'sess-del');
    deleteSession('main');
    expect(getSession('main')).toBeNull();
  });

  it('stores and retrieves agent_type deepagent', () => {
    setSession('test-group', 'session-123', 'deepagent');
    const session = getSession('test-group');
    expect(session).toEqual({ sessionId: 'session-123', agentType: 'deepagent' });
  });

  it('stores and retrieves agent_type claude', () => {
    setSession('test-group', 'session-456', 'claude');
    const session = getSession('test-group');
    expect(session).toEqual({ sessionId: 'session-456', agentType: 'claude' });
  });
});
```

- [ ] **Step 2: Run test to verify they fail**

```bash
npm test src/db.test.ts
```

Expected: FAIL — `getSession` returns string, not object; `setSession` doesn't accept 3 args

- [ ] **Step 3: Update sessions table schema + migration**

In `src/db.ts`:

1. Update CREATE TABLE (line 74-77):
```sql
CREATE TABLE IF NOT EXISTS sessions (
  group_folder TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  agent_type TEXT NOT NULL DEFAULT 'deepagent'
);
```

2. Add ALTER TABLE migration in the migration section (after existing migrations). Use try/catch pattern matching existing code:
```typescript
try {
  database.exec(`ALTER TABLE sessions ADD COLUMN agent_type TEXT NOT NULL DEFAULT 'deepagent'`);
} catch {
  // Column already exists
}
```

3. Add `agent_type` column to `chats` table too (for frontend badge display):
```sql
-- In CREATE TABLE:
CREATE TABLE IF NOT EXISTS chats (
  jid TEXT PRIMARY KEY,
  name TEXT,
  last_message_time TEXT,
  channel TEXT,
  is_group INTEGER DEFAULT 0,
  user_id TEXT,
  agent_type TEXT DEFAULT 'deepagent'
);
```
```typescript
// Migration:
try {
  database.exec(`ALTER TABLE chats ADD COLUMN agent_type TEXT DEFAULT 'deepagent'`);
} catch {
  // Column already exists
}
```

- [ ] **Step 4: Update getSession, setSession, getAllSessions**

```typescript
import type { AgentType } from './config.js';

export interface SessionInfo {
  sessionId: string;
  agentType: AgentType;
}

export function getSession(groupFolder: string): SessionInfo | null {
  const row = db
    .prepare('SELECT session_id, agent_type FROM sessions WHERE group_folder = ?')
    .get(groupFolder) as { session_id: string; agent_type: string } | undefined;
  if (!row) return null;
  return { sessionId: row.session_id, agentType: (row.agent_type || 'deepagent') as AgentType };
}

export function setSession(groupFolder: string, sessionId: string, agentType: AgentType = 'deepagent'): void {
  db.prepare(
    'INSERT OR REPLACE INTO sessions (group_folder, session_id, agent_type) VALUES (?, ?, ?)',
  ).run(groupFolder, sessionId, agentType);
}

export function deleteSession(groupFolder: string): void {
  db.prepare('DELETE FROM sessions WHERE group_folder = ?').run(groupFolder);
}

export function getAllSessions(): Record<string, SessionInfo> {
  const rows = db
    .prepare('SELECT group_folder, session_id, agent_type FROM sessions')
    .all() as Array<{ group_folder: string; session_id: string; agent_type: string }>;
  const result: Record<string, SessionInfo> = {};
  for (const row of rows) {
    result[row.group_folder] = {
      sessionId: row.session_id,
      agentType: (row.agent_type || 'deepagent') as AgentType,
    };
  }
  return result;
}
```

- [ ] **Step 5: Update storeChatMetadata to accept and store agentType**

Update `storeChatMetadata` (line 179) to accept optional `agentType` parameter and include in SQL:

```typescript
export function storeChatMetadata(
  chatJid: string,
  timestamp: string,
  name?: string,
  channel?: string,
  isGroup?: boolean,
  userId?: string,
  agentType?: AgentType,
): void {
  // Add agent_type to INSERT/UPDATE queries
  // In the INSERT VALUES, add agentType ?? 'deepagent'
  // In the ON CONFLICT UPDATE, add agent_type = COALESCE(excluded.agent_type, agent_type)
}
```

Also update `getChatList` (or the query used by `GET /api/chats`) to SELECT `agent_type` and return it.

- [ ] **Step 6: Update ALL callers in src/index.ts**

Key locations to update:

1. Line 117: Change type
```typescript
let sessions: Record<string, SessionInfo> = {};
```
(Add `import type { SessionInfo } from './db.js';`)

2. Line 206: `getAllSessions()` already returns new type — works.

3. Lines 960-961 (in `runAgent`): Extract sessionId + agentType:
```typescript
const session = sessions[group.folder];
const sessionId = session?.sessionId;
const agentType = session?.agentType ?? DEFAULT_AGENT_TYPE;
```

4. Lines 992-993 (output callback): Store as object:
```typescript
if (output.newSessionId) {
  sessions[group.folder] = { sessionId: output.newSessionId, agentType };
  setSession(group.folder, output.newSessionId, agentType);
}
```

5. Lines 1019-1020 (after runContainerAgent): Same pattern:
```typescript
if (output.newSessionId) {
  sessions[group.folder] = { sessionId: output.newSessionId, agentType };
  setSession(group.folder, output.newSessionId, agentType);
}
```

6. All `delete sessions[folder]` calls — no change needed (deleting from Record works the same).

7. Line 930-931: `setSession(group.folder, '')` → `setSession(group.folder, '', agentType)` or keep default.

8. Search for any other callers of `getSession`/`setSession` in the codebase and update.

- [ ] **Step 7: Run tests**

```bash
npm test
```

Expected: All pass

- [ ] **Step 8: Commit**

```bash
git add src/db.ts src/db.test.ts src/index.ts
git commit -m "feat: add agent_type column to sessions and chats tables"
```

---

## Task 4: Container Runner (`src/container-runner.ts`)

**Files:**
- Modify: `src/container-runner.ts`

NOTE: The existing signature is:
```typescript
export async function runContainerAgent(
  group: RegisteredGroup,
  input: ContainerInput,
  onProcess: (proc: ChildProcess, containerName: string) => void,
  onOutput?: (output: ContainerOutput) => Promise<void>,
): Promise<ContainerOutput>
```

We add `agentType` to the `ContainerInput` interface — NO signature change needed.

- [ ] **Step 1: Add agentType to ContainerInput interface**

In `src/container-runner.ts`, update `ContainerInput` (lines 35-44):

```typescript
export interface ContainerInput {
  prompt: string;
  sessionId?: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask?: boolean;
  assistantName?: string;
  secrets?: Record<string, string>;
  agentType?: AgentType;  // NEW
}
```

Add import:
```typescript
import { AgentType, DEEP_AGENT_MODEL, DEEP_AGENT_PYTHON, DEEP_AGENT_RUNNER_PATH, DATA_DIR } from './config.js';
```

- [ ] **Step 2: Add Python spawn branch in USE_LOCAL_AGENT block**

In the `USE_LOCAL_AGENT` block (around line 330), modify the spawn command selection:

```typescript
if (USE_LOCAL_AGENT) {
  if (input.agentType === 'deepagent') {
    spawnCmd = DEEP_AGENT_PYTHON;
    spawnArgs = [path.resolve(process.cwd(), DEEP_AGENT_RUNNER_PATH)];
  } else {
    spawnCmd = 'node';
    spawnArgs = [
      path.resolve(process.cwd(), 'container/agent-runner/dist/index.js'),
    ];
  }
  // ... rest of existing local setup (symlinks, etc.) unchanged
```

- [ ] **Step 3: Add deep agent env vars**

In the env setup section (around line 380), after existing env vars:

```typescript
if (input.agentType === 'deepagent') {
  spawnOptions.env!.DEEP_AGENT_MODEL = DEEP_AGENT_MODEL;
  spawnOptions.env!.DEEPAGENT_CHECKPOINT_DB = path.join(DATA_DIR, 'store', 'deepagent-checkpoints.db');
}
```

- [ ] **Step 4: Update caller in src/index.ts to pass agentType**

In `src/index.ts`, update the `runContainerAgent` call (around line 1004-1013):

```typescript
const output = await runContainerAgent(
  group,
  {
    prompt,
    sessionId,
    groupFolder: group.folder,
    chatJid,
    isMain,
    assistantName: ASSISTANT_NAME,
    agentType,  // NEW — from session record
  },
  (proc, containerName) =>
    queue.registerProcess(chatJid, proc, containerName, group.folder),
  wrappedOnOutput,
);
```

- [ ] **Step 5: Run tests**

```bash
npm test
```

Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add src/container-runner.ts src/index.ts
git commit -m "feat: add deepagent spawn path to container runner"
```

---

## Task 5: Stream Event Adapter (`src/index.ts`)

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Add stream event adapter for deep agent format**

In the streaming callback section (around line 631), where `result.streamEvent` is processed, add a conditional for deep agent events:

```typescript
if (result.streamEvent) {
  if (agentType === 'deepagent') {
    // Deep agent emits: { type: "text_delta" | "tool_use_start" | "tool_use_end" }
    // Forward to frontend as-is in a stream_event message
    broadcastToJid(chatJid, { type: 'stream_event', event: result.streamEvent });
  } else {
    // Existing Claude stream event handling (unchanged)
    // ...
  }
}
```

NOTE: The implementing agent must read the full streaming callback code (lines 631-884) to understand the exact structure and place the adapter correctly. The existing Claude handling code should be wrapped in `else` block, not duplicated.

- [ ] **Step 2: Run tests**

```bash
npm test
```

Expected: All pass

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: add stream event adapter for deep agent format"
```

---

## Task 6: Server API (`src/server.ts`)

**Files:**
- Modify: `src/server.ts`

- [ ] **Step 1: Update POST /api/chats to accept agentType**

In `src/server.ts`, update the `POST /api/chats` handler (line 244). Add body parsing middleware if not already present, and pass agentType:

```typescript
app.post('/api/chats', authenticateToken, (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const agentType: AgentType = req.body?.agentType || DEFAULT_AGENT_TYPE;
    const jid = 'web:' + randomUUID();
    const timestamp = new Date().toISOString();
    storeChatMetadata(
      jid,
      timestamp,
      'New Chat',
      'web',
      false,
      authReq.user!.userId,
      agentType,
    );
    // ... rest unchanged, but include agent_type in response JSON:
    res.status(201).json({
      jid,
      name: 'New Chat',
      last_message_time: timestamp,
      channel: 'web',
      is_group: 0,
      agent_type: agentType,
    });
  }
});
```

Add imports:
```typescript
import { AgentType, DEFAULT_AGENT_TYPE } from './config.js';
```

Ensure `express.json()` middleware is applied (check if `app.use(express.json())` exists).

- [ ] **Step 2: Update GET /api/chats to return agent_type**

Ensure the query that fetches chat list includes `agent_type` column. The implementing agent should read the `GET /api/chats` handler and add `agent_type` to the SELECT and response.

- [ ] **Step 3: Run tests**

```bash
npm test
```

Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add src/server.ts
git commit -m "feat: accept and return agentType in chat API"
```

---

## Task 7: Python Runner — Project Setup & Protocol

**Files:**
- Create: `container/deep-agent-runner/pyproject.toml`
- Create: `container/deep-agent-runner/src/__init__.py`
- Create: `container/deep-agent-runner/src/protocol.py`
- Create: `container/deep-agent-runner/tests/__init__.py`
- Create: `container/deep-agent-runner/tests/conftest.py`
- Create: `container/deep-agent-runner/tests/test_protocol.py`

- [ ] **Step 1: Create project structure**

```bash
mkdir -p container/deep-agent-runner/src container/deep-agent-runner/tests
```

Create `container/deep-agent-runner/pyproject.toml`:
```toml
[project]
name = "cnp-deep-agent-runner"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "deepagents",
    "langchain-core>=1.2.21,<2.0.0",
    "langchain-anthropic>=1.4.0,<2.0.0",
    "langgraph-checkpoint-sqlite>=2.0.0",
]

[project.optional-dependencies]
dev = ["pytest", "pytest-asyncio"]

[build-system]
requires = ["setuptools>=68.0"]
build-backend = "setuptools.build_meta"

[tool.setuptools.packages.find]
where = ["."]
include = ["src*"]

[tool.pytest.ini_options]
testpaths = ["tests"]
```

Create `container/deep-agent-runner/src/__init__.py` (empty file).
Create `container/deep-agent-runner/tests/__init__.py` (empty file).

Create `container/deep-agent-runner/tests/conftest.py`:
```python
import sys
import os
# Add project root to path so `from src.X import ...` works
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
```

- [ ] **Step 2: Write protocol tests**

```python
# container/deep-agent-runner/tests/test_protocol.py
import json
import pytest
from src.protocol import parse_container_input, emit_output, ContainerInput

def test_parse_container_input_full():
    raw = json.dumps({
        "prompt": "hello",
        "sessionId": "sess-123",
        "groupFolder": "my-group",
        "chatJid": "web:abc",
        "isMain": False,
        "isScheduledTask": False,
        "assistantName": "Bot",
        "secrets": {"ANTHROPIC_API_KEY": "sk-test"},
    })
    ci = parse_container_input(raw)
    assert ci.prompt == "hello"
    assert ci.session_id == "sess-123"
    assert ci.group_folder == "my-group"
    assert ci.secrets == {"ANTHROPIC_API_KEY": "sk-test"}

def test_parse_container_input_minimal():
    raw = json.dumps({
        "prompt": "hi",
        "groupFolder": "g1",
        "chatJid": "web:x",
        "isMain": True,
    })
    ci = parse_container_input(raw)
    assert ci.prompt == "hi"
    assert ci.session_id is None
    assert ci.secrets is None

def test_emit_output_format(capsys):
    emit_output({"status": "success", "result": "done", "newSessionId": "s1"})
    captured = capsys.readouterr()
    assert "---CNP_BOT_OUTPUT_START---" in captured.out
    assert "---CNP_BOT_OUTPUT_END---" in captured.out
    start = captured.out.index("---CNP_BOT_OUTPUT_START---") + len("---CNP_BOT_OUTPUT_START---\n")
    end = captured.out.index("---CNP_BOT_OUTPUT_END---")
    data = json.loads(captured.out[start:end].strip())
    assert data["status"] == "success"
    assert data["result"] == "done"
    assert data["newSessionId"] == "s1"
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd container/deep-agent-runner && python -m pytest tests/test_protocol.py -v
```

Expected: FAIL — module not found

- [ ] **Step 4: Implement protocol.py**

```python
# container/deep-agent-runner/src/protocol.py
from __future__ import annotations
import json
import sys
from dataclasses import dataclass
from typing import Any

OUTPUT_START = "---CNP_BOT_OUTPUT_START---"
OUTPUT_END = "---CNP_BOT_OUTPUT_END---"

@dataclass
class ContainerInput:
    prompt: str
    group_folder: str
    chat_jid: str
    is_main: bool
    session_id: str | None = None
    is_scheduled_task: bool = False
    assistant_name: str | None = None
    secrets: dict[str, str] | None = None

def parse_container_input(raw: str) -> ContainerInput:
    data = json.loads(raw)
    return ContainerInput(
        prompt=data["prompt"],
        group_folder=data["groupFolder"],
        chat_jid=data["chatJid"],
        is_main=data.get("isMain", False),
        session_id=data.get("sessionId"),
        is_scheduled_task=data.get("isScheduledTask", False),
        assistant_name=data.get("assistantName"),
        secrets=data.get("secrets"),
    )

def emit_output(data: dict[str, Any]) -> None:
    payload = json.dumps(data, ensure_ascii=False)
    sys.stdout.write(f"{OUTPUT_START}\n{payload}\n{OUTPUT_END}\n")
    sys.stdout.flush()

def emit_stream_event(event: dict[str, Any]) -> None:
    emit_output({"status": "success", "result": None, "streamEvent": event})
```

- [ ] **Step 5: Run tests**

```bash
cd container/deep-agent-runner && python -m pytest tests/test_protocol.py -v
```

Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add container/deep-agent-runner/
git commit -m "feat: add deep-agent-runner project with protocol module"
```

---

## Task 8: Python Runner — IPC Tools

**Files:**
- Create: `container/deep-agent-runner/src/ipc_tools.py`
- Create: `container/deep-agent-runner/tests/test_ipc_tools.py`

- [ ] **Step 1: Write IPC tools tests**

```python
# container/deep-agent-runner/tests/test_ipc_tools.py
import json
import os
import tempfile
import pytest
from src.ipc_tools import create_ipc_tools

@pytest.fixture
def ipc_dir():
    with tempfile.TemporaryDirectory() as d:
        for sub in ['messages', 'ask_requests', 'ask_responses', 'tasks']:
            os.makedirs(os.path.join(d, sub))
        yield d

def test_send_message_writes_file(ipc_dir):
    tools = create_ipc_tools(ipc_dir, "web:abc", "test-group")
    send_msg = next(t for t in tools if t.name == "send_message")
    result = send_msg.invoke({"message": "hello world"})
    files = os.listdir(os.path.join(ipc_dir, 'messages'))
    assert len(files) == 1
    data = json.loads(open(os.path.join(ipc_dir, 'messages', files[0])).read())
    assert data["text"] == "hello world"
    assert data["chatJid"] == "web:abc"
    assert data["type"] == "message"

def test_schedule_task_writes_file(ipc_dir):
    tools = create_ipc_tools(ipc_dir, "web:abc", "test-group")
    sched = next(t for t in tools if t.name == "schedule_task")
    result = sched.invoke({
        "name": "check-disk",
        "schedule_type": "cron",
        "schedule_value": "0 * * * *",
        "prompt": "check disk usage",
    })
    files = os.listdir(os.path.join(ipc_dir, 'tasks'))
    assert len(files) == 1
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd container/deep-agent-runner && python -m pytest tests/test_ipc_tools.py -v
```

- [ ] **Step 3: Implement ipc_tools.py**

```python
# container/deep-agent-runner/src/ipc_tools.py
from __future__ import annotations
import asyncio
import json
import os
import time
import uuid
from langchain_core.tools import tool

def create_ipc_tools(ipc_dir: str, chat_jid: str, group_folder: str) -> list:
    """Create IPC tools bound to a specific IPC directory and session context."""

    @tool
    def send_message(message: str) -> str:
        """Send a message to the user immediately."""
        msg_id = f"{int(time.time() * 1000)}_{uuid.uuid4().hex[:8]}"
        payload = {
            "type": "message",
            "chatJid": chat_jid,
            "text": message,
            "groupFolder": group_folder,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
        }
        fpath = os.path.join(ipc_dir, "messages", f"{msg_id}.json")
        with open(fpath, "w") as f:
            json.dump(payload, f)
        return "Message sent."

    @tool
    def ask_user(question: str) -> str:
        """Ask the user a question and wait for their response."""
        request_id = uuid.uuid4().hex
        payload = {
            "type": "ask_user",
            "requestId": request_id,
            "chatJid": chat_jid,
            "question": question,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
        }
        req_path = os.path.join(ipc_dir, "ask_requests", f"{request_id}.json")
        with open(req_path, "w") as f:
            json.dump(payload, f)
        # Poll for response (blocking — LangChain tools run in executor thread)
        resp_path = os.path.join(ipc_dir, "ask_responses", f"{request_id}.json")
        deadline = time.time() + 300
        while time.time() < deadline:
            if os.path.exists(resp_path):
                with open(resp_path) as f:
                    resp = json.load(f)
                os.remove(resp_path)
                return resp.get("answer", "")
            time.sleep(0.5)
        return "[Timeout: no response from user]"

    @tool
    def schedule_task(name: str, schedule_type: str, schedule_value: str, prompt: str) -> str:
        """Schedule a recurring or one-time task.
        Args:
            name: Task name
            schedule_type: One of 'cron', 'interval', 'once'
            schedule_value: Cron expression, interval in seconds, or ISO timestamp
            prompt: The prompt to execute when the task fires
        """
        task_id = uuid.uuid4().hex
        payload = {
            "type": "schedule_task",
            "taskId": task_id,
            "prompt": prompt,
            "schedule_type": schedule_type,
            "schedule_value": schedule_value,
            "targetJid": chat_jid,
            "createdBy": group_folder,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
        }
        fpath = os.path.join(ipc_dir, "tasks", f"{task_id}.json")
        with open(fpath, "w") as f:
            json.dump(payload, f)
        return f"Task '{name}' scheduled (id: {task_id})."

    @tool
    def list_tasks() -> str:
        """List all scheduled tasks for this group."""
        tasks_file = os.path.join(ipc_dir, "current_tasks.json")
        if not os.path.exists(tasks_file):
            return "No tasks found."
        with open(tasks_file) as f:
            tasks = json.load(f)
        return json.dumps(tasks, indent=2) if tasks else "No tasks found."

    @tool
    def pause_task(task_id: str) -> str:
        """Pause a scheduled task."""
        _write_task_action("pause_task", task_id)
        return f"Task {task_id} paused."

    @tool
    def resume_task(task_id: str) -> str:
        """Resume a paused task."""
        _write_task_action("resume_task", task_id)
        return f"Task {task_id} resumed."

    @tool
    def cancel_task(task_id: str) -> str:
        """Cancel a scheduled task."""
        _write_task_action("cancel_task", task_id)
        return f"Task {task_id} cancelled."

    def _write_task_action(action: str, task_id: str):
        payload = {"type": action, "taskId": task_id}
        fpath = os.path.join(ipc_dir, "tasks", f"{action}_{task_id}.json")
        with open(fpath, "w") as f:
            json.dump(payload, f)

    return [send_message, ask_user, schedule_task, list_tasks, pause_task, resume_task, cancel_task]
```

Note: `ask_user` uses synchronous `time.sleep()` which is fine — LangChain `@tool` sync functions are automatically run in an executor thread by LangGraph, so they don't block the event loop.

- [ ] **Step 4: Run tests**

```bash
cd container/deep-agent-runner && python -m pytest tests/test_ipc_tools.py -v
```

Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add container/deep-agent-runner/src/ipc_tools.py container/deep-agent-runner/tests/test_ipc_tools.py
git commit -m "feat: add IPC tools for deep agent runner"
```

---

## Task 9: Python Runner — Dangerous Command Hook

**Files:**
- Create: `container/deep-agent-runner/src/hooks.py`
- Create: `container/deep-agent-runner/tests/test_hooks.py`

- [ ] **Step 1: Write hook tests**

```python
# container/deep-agent-runner/tests/test_hooks.py
import json
import os
import tempfile
import pytest
from src.hooks import load_dangerous_rules, check_dangerous

@pytest.fixture
def rules_file():
    rules = [
        {"pattern": "rm\\s+-rf\\s+/", "severity": "high", "reason": "Recursive delete from root"},
        {"pattern": "shutdown", "severity": "high", "reason": "System shutdown"},
        {"pattern": "rmdir", "severity": "medium", "reason": "Remove directory"},
    ]
    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
        json.dump(rules, f)
        yield f.name
    os.unlink(f.name)

def test_load_rules(rules_file):
    rules = load_dangerous_rules(rules_file)
    assert len(rules) == 3

def test_check_dangerous_high(rules_file):
    rules = load_dangerous_rules(rules_file)
    result = check_dangerous("rm -rf /etc", rules)
    assert result is not None
    assert result["severity"] == "high"

def test_check_dangerous_medium(rules_file):
    rules = load_dangerous_rules(rules_file)
    result = check_dangerous("rmdir /tmp/foo", rules)
    assert result is not None
    assert result["severity"] == "medium"

def test_check_dangerous_safe(rules_file):
    rules = load_dangerous_rules(rules_file)
    result = check_dangerous("ls -la /tmp", rules)
    assert result is None
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd container/deep-agent-runner && python -m pytest tests/test_hooks.py -v
```

- [ ] **Step 3: Implement hooks.py**

```python
# container/deep-agent-runner/src/hooks.py
from __future__ import annotations
import json
import os
import re
import subprocess
from langchain_core.tools import tool

def load_dangerous_rules(json_path: str) -> list[dict]:
    with open(json_path) as f:
        rules = json.load(f)
    for rule in rules:
        rule["_compiled"] = re.compile(rule["pattern"])
    return rules

def check_dangerous(command: str, rules: list[dict]) -> dict | None:
    for rule in rules:
        if rule["_compiled"].search(command):
            return {"severity": rule["severity"], "reason": rule["reason"]}
    return None

def create_execute_tool(workspace_root: str, rules: list[dict], confirm_bin: str | None = None):
    """Create a custom execute tool with dangerous command checking.

    This replaces the default execute from FilesystemMiddleware to add
    dangerous command interception via cnp-confirm.
    """

    @tool
    def execute(command: str, timeout: int = 120) -> str:
        """Execute a shell command in the workspace."""
        danger = check_dangerous(command, rules)
        if danger and danger["severity"] == "high" and confirm_bin:
            try:
                result = subprocess.run(
                    [confirm_bin, command, danger["reason"]],
                    timeout=300,
                    capture_output=True,
                )
                if result.returncode == 2:
                    return f"Command denied by user: {danger['reason']}"
            except subprocess.TimeoutExpired:
                return "Command confirmation timed out."
            except FileNotFoundError:
                pass  # confirm binary not available, proceed

        try:
            result = subprocess.run(
                command,
                shell=True,
                capture_output=True,
                text=True,
                timeout=timeout,
                cwd=workspace_root,
                env={**os.environ},
            )
            output = result.stdout
            if result.stderr:
                output += f"\nSTDERR:\n{result.stderr}"
            return f"Exit code: {result.returncode}\n{output}"
        except subprocess.TimeoutExpired:
            return f"Command timed out after {timeout}s"
        except Exception as e:
            return f"Error executing command: {e}"

    return execute
```

- [ ] **Step 4: Run tests**

```bash
cd container/deep-agent-runner && python -m pytest tests/test_hooks.py -v
```

Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add container/deep-agent-runner/src/hooks.py container/deep-agent-runner/tests/test_hooks.py
git commit -m "feat: add dangerous command hook for deep agent runner"
```

---

## Task 10: Python Runner — Main Entry Point

**Files:**
- Create: `container/deep-agent-runner/src/main.py`
- Create: `container/deep-agent-runner/tests/test_main.py`

IMPORTANT: This file uses **absolute imports** (not relative) because the host spawns it as `python -m src.main` from the `container/deep-agent-runner/` directory.

- [ ] **Step 1: Write integration tests**

```python
# container/deep-agent-runner/tests/test_main.py
import json
import os
import uuid
import pytest
from src.protocol import parse_container_input

def test_parse_input_and_inject_secrets():
    input_data = {
        "prompt": "hello",
        "groupFolder": "test",
        "chatJid": "web:abc",
        "isMain": False,
        "secrets": {"ANTHROPIC_API_KEY": "sk-test-123"},
    }
    ci = parse_container_input(json.dumps(input_data))
    if ci.secrets:
        for k, v in ci.secrets.items():
            os.environ[k] = v
    assert os.environ.get("ANTHROPIC_API_KEY") == "sk-test-123"
    del os.environ["ANTHROPIC_API_KEY"]

def test_session_id_generation():
    # New session — generate UUID
    ci_new = parse_container_input(json.dumps({
        "prompt": "hi", "groupFolder": "g", "chatJid": "j", "isMain": False
    }))
    thread_id = ci_new.session_id or str(uuid.uuid4())
    assert ci_new.session_id is None
    assert len(thread_id) == 36

    # Resume — use existing
    ci_resume = parse_container_input(json.dumps({
        "prompt": "hi", "groupFolder": "g", "chatJid": "j", "isMain": False,
        "sessionId": "existing-123"
    }))
    thread_id = ci_resume.session_id or str(uuid.uuid4())
    assert thread_id == "existing-123"
```

- [ ] **Step 2: Implement main.py**

```python
#!/usr/bin/env python3
"""CNP-Bot Deep Agent Runner — entry point.

Invoked by host as: python -m src.main (from container/deep-agent-runner/)
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import uuid

from src.protocol import parse_container_input, emit_output, emit_stream_event
from src.ipc_tools import create_ipc_tools
from src.hooks import load_dangerous_rules, create_execute_tool


def main():
    try:
        asyncio.run(async_main())
    except Exception as e:
        emit_output({"status": "error", "result": None, "error": str(e)})
        sys.exit(1)


async def async_main():
    # 1. Startup validation
    try:
        from deepagents import create_deep_agent
        from deepagents.backends.local_shell import LocalShellBackend
        from langchain_core.messages import HumanMessage
    except ImportError as e:
        emit_output({"status": "error", "result": None, "error": f"Failed to import deepagents: {e}"})
        sys.exit(1)

    # 2. Read stdin
    raw = sys.stdin.read()
    container_input = parse_container_input(raw)

    # 3. Inject secrets (never write to disk)
    if container_input.secrets:
        for key, value in container_input.secrets.items():
            os.environ[key] = value

    # 4. Session ID
    thread_id = container_input.session_id or str(uuid.uuid4())

    # 5. System prompt
    workspace_root = os.environ.get("WORKSPACE_ROOT", "/workspace")
    system_prompt = _load_system_prompt(workspace_root)

    # 6. IPC tools
    ipc_dir = os.environ.get("IPC_DIR", os.path.join(workspace_root, "ipc"))
    ipc_tools = create_ipc_tools(ipc_dir, container_input.chat_jid, container_input.group_folder)

    # 7. Dangerous command rules + custom execute
    shared_rules_path = os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "..", "..", "shared", "dangerous-commands.json"
    )
    confirm_bin = os.environ.get("CNP_CONFIRM_BIN")
    rules = load_dangerous_rules(shared_rules_path) if os.path.exists(shared_rules_path) else []
    execute_tool = create_execute_tool(
        os.path.join(workspace_root, "group"), rules, confirm_bin
    )

    # 8. Build agent
    # Pass backend as FilesystemBackend (not SandboxBackendProtocol) to avoid
    # duplicate execute tool — our custom execute_tool replaces the default.
    from deepagents.backends.filesystem import FilesystemBackend
    backend = FilesystemBackend(root_dir=os.path.join(workspace_root, "group"))

    checkpoint_db = os.environ.get("DEEPAGENT_CHECKPOINT_DB", "")
    checkpointer = None
    if checkpoint_db:
        os.makedirs(os.path.dirname(checkpoint_db), exist_ok=True)
        from langgraph.checkpoint.sqlite import SqliteSaver
        checkpointer = SqliteSaver.from_conn_string(checkpoint_db)

    model = os.environ.get("DEEP_AGENT_MODEL", "claude-sonnet-4-6")

    agent = create_deep_agent(
        model=model,
        backend=backend,
        tools=[*ipc_tools, execute_tool],
        system_prompt=system_prompt,
        checkpointer=checkpointer,
    )

    config = {"configurable": {"thread_id": thread_id}}

    # 9. Run first query
    await _run_query(agent, container_input.prompt, config, thread_id)

    # 10. Multi-turn loop
    input_dir = os.path.join(ipc_dir, "input")
    os.makedirs(input_dir, exist_ok=True)

    while True:
        msg = await _poll_ipc_input(input_dir)
        if msg is None:
            break
        await _run_query(agent, msg, config, thread_id)


async def _run_query(agent, prompt, config, thread_id):
    from langchain_core.messages import HumanMessage

    result_text = ""
    usage_info = {}

    try:
        async for event in agent.astream_events(
            {"messages": [HumanMessage(content=prompt)]},
            config=config,
            version="v2",
        ):
            kind = event.get("event", "")

            if kind == "on_chat_model_stream":
                chunk = event.get("data", {}).get("chunk")
                if chunk and hasattr(chunk, "content") and isinstance(chunk.content, str) and chunk.content:
                    emit_stream_event({"type": "text_delta", "text": chunk.content})
                    result_text += chunk.content

            elif kind == "on_tool_start":
                emit_stream_event({
                    "type": "tool_use_start",
                    "name": event.get("name", ""),
                    "input": event.get("data", {}).get("input", {}),
                })

            elif kind == "on_tool_end":
                emit_stream_event({
                    "type": "tool_use_end",
                    "name": event.get("name", ""),
                    "output": str(event.get("data", {}).get("output", "")),
                })

            elif kind == "on_chat_model_end":
                output_data = event.get("data", {}).get("output")
                if output_data and hasattr(output_data, "response_metadata"):
                    rm = output_data.response_metadata or {}
                    u = rm.get("usage", {})
                    usage_info = {
                        "input_tokens": u.get("input_tokens", 0),
                        "output_tokens": u.get("output_tokens", 0),
                        "model_usage": {
                            os.environ.get("DEEP_AGENT_MODEL", "unknown"): {
                                "input_tokens": u.get("input_tokens", 0),
                                "output_tokens": u.get("output_tokens", 0),
                            }
                        },
                    }
    except Exception as e:
        emit_output({"status": "error", "result": None, "error": str(e)})
        return

    emit_output({
        "status": "success",
        "result": result_text or None,
        "newSessionId": thread_id,
        "usage": usage_info,
    })


async def _poll_ipc_input(input_dir: str) -> str | None:
    while True:
        close_path = os.path.join(input_dir, "_close")
        if os.path.exists(close_path):
            try:
                os.remove(close_path)
            except OSError:
                pass
            return None

        files = sorted(f for f in os.listdir(input_dir) if f.endswith(".json"))
        if files:
            fpath = os.path.join(input_dir, files[0])
            try:
                with open(fpath) as f:
                    data = json.load(f)
                os.remove(fpath)
                return data.get("text", "")
            except (json.JSONDecodeError, OSError):
                try:
                    os.remove(fpath)
                except OSError:
                    pass

        await asyncio.sleep(0.5)


def _load_system_prompt(workspace_root: str) -> str:
    parts = []
    for sub in ["global/CLAUDE.md", "group/CLAUDE.md"]:
        p = os.path.join(workspace_root, sub)
        if os.path.exists(p):
            with open(p) as f:
                parts.append(f.read())
    return "\n\n".join(parts) if parts else ""


if __name__ == "__main__":
    main()
```

Key design decisions:
- Uses `FilesystemBackend` (not `LocalShellBackend`) to avoid duplicate execute tool. Our custom `execute_tool` with dangerous command checking replaces the SDK's built-in one.
- Absolute imports (`from src.X`) — invoked as `python -m src.main`.
- Secrets injected via env vars, never written to disk.

- [ ] **Step 3: Update container-runner.ts spawn command**

The host must invoke the Python runner as a module:

```typescript
// In container-runner.ts, deepagent branch:
spawnCmd = DEEP_AGENT_PYTHON;
spawnArgs = ['-m', 'src.main'];
spawnOptions.cwd = path.resolve(process.cwd(), 'container/deep-agent-runner');
```

- [ ] **Step 4: Run tests**

```bash
cd container/deep-agent-runner && python -m pytest tests/ -v
npm test
```

Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add container/deep-agent-runner/src/main.py container/deep-agent-runner/tests/test_main.py src/container-runner.ts
git commit -m "feat: add deep agent runner main entry point with multi-turn loop"
```

---

## Task 11: Frontend Changes

**Files:**
- Modify: `frontend/src/lib/types.ts`
- Modify: `frontend/src/pages/Chat.tsx`
- Modify: `frontend/src/components/Chat/ChatSidebar.tsx`
- Modify: `frontend/src/hooks/useChatWebSocket.ts`

- [ ] **Step 1: Update Chat type**

In `frontend/src/lib/types.ts`, add to Chat interface:

```typescript
export interface Chat {
  jid: string;
  name: string;
  last_message_time: string;
  last_message: string;
  last_user_message: string;
  is_group: number;
  agent_type?: 'claude' | 'deepagent';  // NEW
}
```

- [ ] **Step 2: Update createChatSession to send agentType**

In `frontend/src/pages/Chat.tsx`:

Add state:
```typescript
const [newChatAgentType, setNewChatAgentType] = useState<'claude' | 'deepagent'>('deepagent');
```

Update fetch (around line 191):
```typescript
const res = await fetch(`${apiBase}/api/chats`, {
  method: 'POST',
  headers: { ...authHeaders, 'Content-Type': 'application/json' },
  body: JSON.stringify({ agentType: newChatAgentType }),
});
```

- [ ] **Step 3: Add agent type selector UI**

Add a simple selector before creating. The implementing agent should read Chat.tsx to find the best integration point. If the current flow is a direct button click with no dialog, add a popover or toggle near the "新建" button. Options:
- A small toggle/dropdown next to the create button
- A popover that appears on click before creating

- [ ] **Step 4: Show agent type badge in session list**

In `frontend/src/components/Chat/ChatSidebar.tsx`, add badge in session item:

```tsx
{chat.agent_type && (
  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
    chat.agent_type === 'deepagent'
      ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
      : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
  }`}>
    {chat.agent_type === 'deepagent' ? 'Deep' : 'Claude'}
  </span>
)}
```

- [ ] **Step 5: Handle deep agent stream events**

In `frontend/src/hooks/useChatWebSocket.ts`, in the stream_event handler, add handling for deep agent event types alongside existing Anthropic events:

```typescript
// Deep agent events
if (event.type === 'text_delta') {
  // Append event.text to current streaming message
} else if (event.type === 'tool_use_start') {
  // Show tool invocation with event.name, event.input
} else if (event.type === 'tool_use_end') {
  // Show tool result with event.name, event.output
}
```

The implementing agent must read the full `useChatWebSocket.ts` stream_event handler to understand the current structure and add support without breaking existing Claude events.

- [ ] **Step 6: Run tests**

```bash
npm test
```

Expected: All pass

- [ ] **Step 7: Commit**

```bash
git add frontend/
git commit -m "feat: add agent type selector and badges to frontend"
```

---

## Task 12: End-to-End Verification

- [ ] **Step 1: Run full host test suite**

```bash
npm test
```

Expected: All tests pass

- [ ] **Step 2: Run Python tests**

```bash
cd container/deep-agent-runner && python -m pytest tests/ -v
```

Expected: All pass

- [ ] **Step 3: Verify Python runner startup**

```bash
cd container/deep-agent-runner && \
echo '{"prompt":"hello","groupFolder":"test","chatJid":"web:test","isMain":false}' | \
  WORKSPACE_ROOT=/tmp/test-workspace \
  python -m src.main
```

Should either produce output markers (if ANTHROPIC_API_KEY is set) or a clean error JSON (`status: "error"` with import message).

- [ ] **Step 4: Final commit**

```bash
git status
# If any uncommitted changes:
git add -A && git commit -m "chore: final cleanup for deep agent integration"
```
