# Plan: Chat Session Control Optimization

## Objective

Optimize the chat session control logic by adding a "Stop" button to terminate backend output immediately and disabling user input while the model is generating a response.

## Analysis

### Frontend (`frontend/src/pages/Chat.tsx`)

* Currently lacks a state to track if the bot is generating (`isGenerating`).

* Needs a mechanism to send a "stop" signal to the backend.

* Needs to listen for completion signals (full message update or error) to reset the generating state.

### Backend (`src/index.ts`, `src/server.ts`, `src/group-queue.ts`)

* `GroupQueue` manages agent processes but doesn't expose a way to stop them explicitly.

* `processGroupMessages` retries on error/exit, which needs to be bypassed if the exit was caused by a user stop request.

* WebSocket handler in `server.ts` needs to support a `stop` message type.

## Proposed Changes

### 1. Backend: Implement Stop Logic

#### `src/group-queue.ts`

* Update `GroupState` interface to include `interrupted: boolean`.

* Add `stopGroup(groupJid: string): void` method:

  * Find the group state.

  * Set `interrupted = true`.

  * If a process is running, kill it (SIGTERM).

* Add `isInterrupted(groupJid: string): boolean` helper.

* Ensure `runForGroup` resets `interrupted = false` before starting.

#### `src/server.ts`

* Update `ServerOpts` to include `onStopGeneration?: (jid: string) => void`.

* In the WebSocket `message` handler, check for `parsed.type === 'stop'`.

* If 'stop' received, call `opts.onStopGeneration(jid)`.

#### `src/index.ts`

* Update `processGroupMessages` to check `queue.isInterrupted(chatJid)` when `runAgent` returns 'error'.

  * If interrupted, log it and return `true` (success) to prevent cursor rollback and retry.

* Pass an `onStopGeneration` callback to `startServer`.

### 2. Frontend: UI & State Updates

#### `frontend/src/pages/Chat.tsx`

* Add `isGenerating` state (boolean).

* Update `handleSendMessage`:

  * Set `isGenerating(true)`.

* Update `useEffect` (WebSocket listener):

  * When receiving `type: 'message'` (final message) or `type: 'error'`, set `isGenerating(false)`.

* Add `handleStop` function:

  * Send `JSON.stringify({ type: "stop" })` via WebSocket.

  * Set `isGenerating(false)`.

* UI Changes:

  * Disable input textarea and Send button when `isGenerating` is true.

  * Add a "Stop" button (visible only when `isGenerating` is true) or replace the Send button with a Stop button during generation.

## Implementation Steps

1. **Backend**: Modify `src/group-queue.ts` to add interruption support.
2. **Backend**: Update `src/server.ts` to handle 'stop' WebSocket messages.
3. **Backend**: Update `src/index.ts` to wire up the stop signal and handle interrupted states in the message loop.
4. **Frontend**: Modify `frontend/src/pages/Chat.tsx` to implement the blocking logic and Stop button.
5. **Verification**: Test sending a message and stopping it mid-stream; verify that the backend process stops and the frontend state resets.

