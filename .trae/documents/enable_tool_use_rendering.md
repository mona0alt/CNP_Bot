# Plan: Enable Rich Markdown Rendering in Chat Interface

This plan aims to implement a visual representation for Claude Agent tool calls (Tool Use) in the chat interface, moving away from raw JSON or hidden executions to a user-friendly, interactive UI.

## 1. Backend Updates (Agent Runner & Host)

### 1.1 `container/agent-runner/src/index.ts`
- **Objective**: Ensure `tool_use` blocks are preserved in the final output and `stream_event`s are emitted correctly.
- **Action**:
    - Modify the `result` handling loop to check for structured `content` (blocks) in the final message, not just a flat text string.
    - If structured content exists, serialize it to JSON and return it as the result.
    - Ensure `stream_event`s for `tool_use` (start, delta, stop) are passed through to `writeOutput`.

### 1.2 `src/types.ts` & `src/channels/web.ts`
- **Objective**: Support streaming of raw events to the frontend.
- **Action**:
    - Add `streamEvent` method to `Channel` interface.
    - Implement `streamEvent` in `WebChannel` to broadcast `{ type: 'stream_event', event: ... }` to the WebSocket.

### 1.3 `src/index.ts` (Host Logic)
- **Objective**: Forward tool events from the agent runner to the web channel.
- **Action**:
    - In `processGroupMessages` -> `runAgent` callback:
        - Handle `content_block_start` (type: `tool_use`).
        - Handle `content_block_delta` (type: `input_json_delta`).
        - Handle `content_block_stop`.
        - Forward these events via `channel.streamEvent`.
    - When handling the final `result`, if it's a serialized JSON array of blocks, store it directly in the DB (as a JSON string) and send it to the user.

## 2. Frontend Updates (Chat Interface)

### 2.1 Type Definitions
- **Objective**: Define structures for Tool Use and Content Blocks.
- **Action**:
    - Define `ToolUseBlock`, `TextBlock`, `ContentBlock` interfaces.
    - Update `Message` interface (or a processed version of it) to support `content: string | ContentBlock[]`.

### 2.2 Component: `ToolCallCard`
- **Objective**: Create the visual component for tool calls.
- **Action**:
    - Create `src/components/ToolCallCard.tsx`.
    - **Props**: `toolName`, `input` (JSON), `status` (calling/executed/error), `result` (optional), `isExpanded` (default false).
    - **UI**:
        - Header: Tool name + Status badge.
        - Body: Collapsible "Input" section (Code Block style).
        - Footer/Overlay: Result status.
        - Animations: Pulsing dot for "Calling" state.

### 2.3 Message Rendering Logic (`Chat.tsx`)
- **Objective**: Parse message content and render appropriate components.
- **Action**:
    - Implement a `parseMessageContent(content: string)` helper:
        - Try `JSON.parse`. If it's an array of blocks, return it.
        - If not, return `[{ type: 'text', text: content }]`.
    - Update the rendering loop in `Chat.tsx` to iterate over blocks:
        - `text` -> `MarkdownRenderer`
        - `tool_use` -> `ToolCallCard`
    - **Streaming Updates**:
        - Update WebSocket `onmessage` handler to process `stream_event`.
        - Maintain a "current tool call" state or append deltas to the last block in the message.
        - Handle `input_json_delta` to accumulate the JSON string.
        - Handle partial JSON parsing (try/catch wrapping) for the "Input" display during streaming.

### 2.4 Linking Tool Results
- **Objective**: Associate `tool_result` with `tool_use`.
- **Action**:
    - The backend `agent-runner` emits results. We need to ensure the frontend receives them.
    - Since `tool_result` is usually a separate message (User role) in the transcript, but we want to show it ON the card:
        - We might need to look ahead in the message list or store results in a way that links back to the `tool_use_id`.
        - *Simplification for this iteration*: Focus on the `tool_use` card itself. If the system sends `tool_result` blocks back (which it usually doesn't to the user, only to the model), we might not see them in the `messages` list.
        - However, the user request says: "Link tool_use_id with tool_result... feedback result status on the original card".
        - This implies we need to fetch or receive the result.
        - **Refinement**: The `agent-runner` logs results. We can modify `agent-runner` to emit a special event or message when a tool finishes, containing the result, and send this to the frontend to update the *existing* message state.

## 3. Implementation Steps

1.  **Backend**: Modify `agent-runner` to support structured output and pass-through events.
2.  **Backend**: Update `WebChannel` and `src/index.ts` to forward events.
3.  **Frontend**: Create `ToolCallCard` component.
4.  **Frontend**: Update `Chat.tsx` to parse and render blocks.
5.  **Frontend**: Implement streaming logic for tool events.
6.  **Verification**: Test with a tool-using prompt (e.g., "Check the weather" or "List files").
