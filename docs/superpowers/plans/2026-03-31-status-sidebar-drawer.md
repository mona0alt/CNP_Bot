# Status Sidebar Drawer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the fixed right StatusSidebar into an overlay drawer that slides in/out on button click, freeing up chat area width by default.

**Architecture:** StatusSidebar becomes an overlay drawer (absolute positioned within the chat area). Chat.tsx gains a `statusOpen` boolean state and a trigger button in the top bar. The existing `syncGeneratingState` is extended to store full status data in a `groupStatusMap`, eliminating the duplicate polling in StatusSidebar.

**Tech Stack:** React, TypeScript, Tailwind CSS, lucide-react icons

**Spec:** `docs/superpowers/specs/2026-03-31-status-sidebar-drawer-design.md`

---

### Task 1: Extend syncGeneratingState to store full GroupStatus

Chat.tsx's `syncGeneratingState` already fetches `/api/groups/:jid/status` every 3s but only uses `isActive`. Extend it to store the full response so StatusSidebar can receive status as a prop instead of polling independently.

**Files:**
- Modify: `frontend/src/components/StatusSidebar.tsx:10-28` (export GroupStatus type)
- Modify: `frontend/src/pages/Chat.tsx:31,294-318`

- [ ] **Step 1: Export GroupStatus type from StatusSidebar.tsx**

Move the `GroupStatus` and `ModelUsageEntry` interfaces to be exported:

```typescript
// StatusSidebar.tsx — change lines 10-28
export interface ModelUsageEntry {
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  contextWindow?: number;
  costUSD?: number;
}

export interface GroupStatus {
  workingDirectory: string | null;
  model: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    model_usage?: Record<string, ModelUsageEntry>;
    cost_usd?: number;
  };
  processReady: boolean;
  isActive: boolean;
}
```

- [ ] **Step 2: Add groupStatusMap state to Chat.tsx**

After the existing `generatingJids` state (line 31), add:

```typescript
import type { GroupStatus } from '@/components/StatusSidebar';

const [groupStatusMap, setGroupStatusMap] = useState<Record<string, GroupStatus>>({});
```

- [ ] **Step 3: Extend syncGeneratingState to populate groupStatusMap**

In the `syncGeneratingState` callback (lines 294-318), after updating `generatingJids`, also store the full status:

```typescript
const syncGeneratingState = useCallback(async (jid: string) => {
  if (!token) return;

  try {
    const res = await fetch(
      `${apiBase}/api/groups/${encodeURIComponent(jid)}/status`,
      { headers: authHeaders },
    );
    if (res.status === 401 || res.status === 403) {
      await handleUnauthorized();
      return;
    }
    if (!res.ok) return;

    const data = await res.json();
    setGeneratingJids((prev) => {
      const next = new Set(prev);
      if (data?.isActive) next.add(jid);
      else next.delete(jid);
      return next;
    });
    // Store full status for StatusSidebar
    if (data) {
      setGroupStatusMap((prev) => ({ ...prev, [jid]: data }));
    }
  } catch (error) {
    console.error('Failed to sync generating state', error);
  }
}, [apiBase, authHeaders, token, handleUnauthorized]);
```

- [ ] **Step 4: Verify build passes**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/StatusSidebar.tsx frontend/src/pages/Chat.tsx
git commit -m "refactor: export GroupStatus type and extend syncGeneratingState to store full status"
```

---

### Task 2: Refactor StatusSidebar into a drawer component

Transform StatusSidebar from a fixed sidebar into an overlay drawer with slide animation, receiving status as a prop.

**Files:**
- Modify: `frontend/src/components/StatusSidebar.tsx`

- [ ] **Step 1: Change StatusSidebar props interface**

Replace the existing props and remove internal fetch logic:

```typescript
interface StatusSidebarProps {
  status: GroupStatus | null;
  open: boolean;
  onClose: () => void;
}
```

Remove the `jid`, `apiBase`, `token` props. Remove the internal `useState<GroupStatus | null>`, the `useEffect` that fetches status, and the `effectiveToken` logic (lines 35-67).

- [ ] **Step 2: Implement drawer shell with overlay and slide animation**

Replace the component body. The outer structure becomes:

```tsx
export function StatusSidebar({ status, open, onClose }: StatusSidebarProps) {
  // Esc key handler (same pattern as ConfirmDialog)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!open) return;
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  // Keep all the existing derived values (modelUsage, totalCacheRead, etc.)
  // but guard them with status null check
  const modelUsage = status?.usage.model_usage;
  const modelNames = modelUsage ? Object.keys(modelUsage) : null;

  let totalCacheRead = 0;
  let totalCacheWrite = 0;
  let contextWindow: number | undefined;

  if (modelUsage) {
    for (const entry of Object.values(modelUsage)) {
      totalCacheRead += entry.cacheReadInputTokens ?? 0;
      totalCacheWrite += entry.cacheCreationInputTokens ?? 0;
      if (entry.contextWindow) contextWindow = entry.contextWindow;
    }
  }

  const totalTokens = status ? status.usage.input_tokens + status.usage.output_tokens : 0;
  const contextUsed = status?.usage.input_tokens ?? 0;
  const contextFill = contextWindow ? Math.min(contextUsed / contextWindow, 1) : null;

  return (
    <>
      {/* Backdrop - only visible when open */}
      <div
        className={`absolute inset-0 z-30 bg-black/30 transition-opacity duration-300 ease-out ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />

      {/* Drawer panel */}
      <div
        className={`absolute right-0 top-0 bottom-0 z-40 w-72 bg-card/95 backdrop-blur-sm border-l shadow-2xl flex flex-col transition-transform duration-300 ease-out ${
          open ? 'translate-x-0' : 'translate-x-full pointer-events-none'
        }`}
        role="dialog"
        aria-modal="true"
      >
        {/* Header with close button */}
        <div className="h-[60px] flex items-center px-4 border-b shrink-0 gap-2">
          <Activity className="w-4 h-4 text-blue-500" />
          <h3 className="font-semibold text-lg">状态</h3>
          {status && (
            <span className={`ml-auto mr-2 px-2 py-0.5 text-xs rounded-full ${
              status.isActive
                ? 'bg-blue-500/20 text-blue-600 dark:text-blue-400'
                : status.processReady
                ? 'bg-green-500/20 text-green-600 dark:text-green-400'
                : 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400'
            }`}>
              {status.isActive ? '运行中' : status.processReady ? '空闲' : '初始化'}
            </span>
          )}
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="关闭状态面板"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content - scrollable */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {status ? (
            <>
              {/* All existing content cards go here — unchanged */}
            </>
          ) : (
            <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
              加载中...
            </div>
          )}
        </div>
      </div>
    </>
  );
}
```

The content cards (进程状态、工作目录、模型、Token 使用、上下文窗口、费用) remain exactly as they are now — just moved inside the `{status ? (<>...</>) : ...}` conditional block.

- [ ] **Step 3: Add X icon import**

Add `X` to the lucide-react imports:

```typescript
import { Folder, Cpu, Activity, Circle, DollarSign, X } from "lucide-react";
```

- [ ] **Step 4: Commit** (Chat.tsx will have type errors until Task 3 — this is expected)

```bash
git add frontend/src/components/StatusSidebar.tsx
git commit -m "feat: convert StatusSidebar to overlay drawer with slide animation"
```

---

### Task 3: Update Chat.tsx — add trigger button and wire up drawer

Add the status trigger button to the chat top bar, manage `statusOpen` state, and pass new props to StatusSidebar.

**Files:**
- Modify: `frontend/src/pages/Chat.tsx`

- [ ] **Step 1: Add statusOpen state and Activity icon import**

At top of Chat.tsx, add `Activity` to lucide-react imports:

```typescript
import { Activity, ChevronRight, MessageSquare, PanelLeftOpen, Trash2 } from 'lucide-react';
```

After line 33 (`isSidebarCollapsed` state), add:

```typescript
const [statusOpen, setStatusOpen] = useState(false);
```

- [ ] **Step 2: Auto-close drawer on session change**

In the existing `useEffect` that resets `askRequests`/`confirmRequests` on `selectedJid` change (lines 346-349), add `setStatusOpen(false)`:

```typescript
useEffect(() => {
  setAskRequests([]);
  setConfirmRequests([]);
  setStatusOpen(false);
}, [selectedJid]);
```

- [ ] **Step 3: Add status trigger button to the chat top bar**

In the top bar's right-side button group (after the delete button, around line 601), add the status trigger button. The derived status color for the button:

```typescript
// Inside the top bar's right <div className="flex items-center gap-2">
// Add BEFORE the delete button:
// Derive status dot color (place before JSX return)
const currentStatus = selectedJid ? groupStatusMap[selectedJid] ?? null : null;
const statusDotColor = !currentStatus ? 'bg-gray-400'
  : currentStatus.isActive ? 'bg-blue-500'
  : currentStatus.processReady ? 'bg-green-500'
  : 'bg-yellow-500';

// In JSX, the button:
<button
  onClick={() => setStatusOpen(true)}
  className="h-9 w-9 inline-flex items-center justify-center rounded-xl border border-border/70 bg-background text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-colors relative"
  title="查看状态"
  aria-label="查看状态"
>
  <Activity size={18} />
  <span className={`absolute top-1.5 right-1.5 w-2 h-2 rounded-full ${statusDotColor}`} />
</button>
```

- [ ] **Step 4: Move StatusSidebar inside the chat area container and update props**

Currently StatusSidebar is rendered as a sibling of the chat `flex-1` div (line 671). Move it INSIDE the `flex-1` div and add `relative` to the container.

Change the chat area container (line 564):
```typescript
// FROM:
<div className="flex-1 flex flex-col bg-background h-full overflow-hidden">
// TO:
<div className="flex-1 flex flex-col bg-background h-full overflow-hidden relative">
```

Move the `<StatusSidebar ... />` from line 671 to INSIDE this container, right before the closing `</div>` of the flex-1 container (just before line 669's `</div>`).

Update the StatusSidebar props:
```typescript
// FROM:
<StatusSidebar jid={selectedJid} apiBase={apiBase} token={token} />

// TO:
<StatusSidebar
  status={selectedJid ? groupStatusMap[selectedJid] ?? null : null}
  open={statusOpen}
  onClose={() => setStatusOpen(false)}
/>
```

This StatusSidebar should render regardless of whether `selectedJid` is set (the component handles null status internally), placed at the end of the `flex-1` container, outside the `selectedJid ? ... : ...` conditional.

- [ ] **Step 5: Verify build passes**

Run: `cd frontend && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/Chat.tsx
git commit -m "feat: add status trigger button and wire up drawer in Chat page"
```

---

### Task 4: Update tests

The existing `Chat.integration.test.tsx` mocks StatusSidebar. Update the mock to match the new props interface.

**Files:**
- Modify: `frontend/src/pages/Chat.integration.test.tsx`

- [ ] **Step 1: Check current StatusSidebar mock in test file**

Read the test file to find the current mock and update it.

The mock should change from:
```typescript
vi.mock('@/components/StatusSidebar', () => ({
  StatusSidebar: () => <div data-testid="status-sidebar">status</div>,
}));
```

To accept the new props:
```typescript
vi.mock('@/components/StatusSidebar', () => ({
  StatusSidebar: ({ open }: { open: boolean }) => (
    open ? <div data-testid="status-sidebar">status</div> : null
  ),
}));
```

- [ ] **Step 2: Run all tests**

Run: `cd /root/project/CNP_BOT/CNP_Bot && npm test`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/Chat.integration.test.tsx
git commit -m "test: update StatusSidebar mock for new drawer props"
```

---

### Task 5: Visual verification and final cleanup

- [ ] **Step 1: Build the frontend**

Run: `cd frontend && npm run build`
Expected: Build succeeds with no errors

- [ ] **Step 2: Run full test suite**

Run: `cd /root/project/CNP_BOT/CNP_Bot && npm test`
Expected: All tests pass

- [ ] **Step 3: Final commit (if any cleanup needed)**

```bash
git add -A
git commit -m "chore: status sidebar drawer cleanup"
```
