# Tasks

- [ ] Task 1: Enable Streaming in Agent Runner
  - [ ] SubTask 1.1: Modify `container/agent-runner/src/index.ts` to set `includePartialMessages: true` in `query` options.
  - [ ] SubTask 1.2: Handle `stream_event` (specifically `content_block_delta` with `text_delta`) from the `query` generator.
  - [ ] SubTask 1.3: Emit `progress` events (wrapped in markers) to stdout.
  - [ ] SubTask 1.4: Rebuild `agent-runner`.

- [ ] Task 2: Implement Streaming in Container Runner & Core
  - [ ] SubTask 2.1: Update `src/container-runner.ts`'s `ContainerOutput` interface to include `status: 'progress'`.
  - [ ] SubTask 2.2: Update `runContainerAgent` to handle `progress` output and call `onOutput` with it.
  - [ ] SubTask 2.3: Update `src/index.ts`'s `runAgent` callback to handle `progress` output and forward to the channel.

- [ ] Task 3: Implement Web Channel Streaming
  - [ ] SubTask 3.1: Modify `src/server.ts` to export or return a `broadcastToJid` function from `startServer`.
  - [ ] SubTask 3.2: Update `src/channels/web.ts` to accept `broadcast` capability.
  - [ ] SubTask 3.3: Implement `streamMessage(jid, text)` in `WebChannel` (and update `Channel` interface if necessary, or just cast).
  - [ ] SubTask 3.4: Wire up `broadcast` from `server.ts` to `WebChannel` in `src/index.ts`.

- [ ] Task 4: Frontend Streaming Support
  - [ ] SubTask 4.1: Update `src/server.ts` WebSocket handler to support `type: 'stream'` messages (or rely on `broadcast` sending correct JSON).
  - [ ] SubTask 4.2: Update `frontend/src/pages/Chat.tsx` to handle `type: 'stream'` (or `chunk`) messages from WebSocket.
  - [ ] SubTask 4.3: Implement logic to append streaming chunks to the current assistant message.

- [ ] Task 5: Beautify Commentary
  - [ ] SubTask 5.1: Update `frontend/src/pages/Chat.tsx` or `MarkdownRenderer.tsx` to process message content.
  - [ ] SubTask 5.2: Replace `<commentary>...</commentary>` with a styled block (e.g., `> **Thinking Process:**\n> ...`) or use a custom component if possible.
  - [ ] SubTask 5.3: Ensure the streaming updates also handle the commentary replacement correctly (so partial tags don't break rendering if possible, though full replacement on each update is simpler).

- [ ] Task 6: Verification
  - [ ] SubTask 6.1: Verify streaming works end-to-end.
  - [ ] SubTask 6.2: Verify commentary is beautified.
