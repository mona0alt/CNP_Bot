# Chat Page Features Implementation Plan

## Goal
Add slash commands support to the input box and a status sidebar to the chat page.

## Features

### 1. Slash Commands
- **Trigger**: Typing `/` in the input box.
- **UI**: A popup menu appearing above the input box showing available commands.
- **Commands**:
  - `/help`: Show available commands and help info.
  - `/clear`: Clear the chat history view (client-side).
  - `/status`: Show current status (highlight sidebar).
- **Implementation**:
  - Create `SlashCommandPopup` component.
  - Update `Chat.tsx` to handle input changes and render the popup.
  - Intercept slash commands in `handleSendMessage`.

### 2. Status Sidebar
- **Location**: Right side of the chat interface.
- **Content**:
  - **Working Directory**: The current group's folder path.
  - **Model**: The current LLM model being used.
  - **Context Usage**: Current input/output token usage (accumulated for the session).
- **Implementation**:
  - Create `StatusSidebar` component.
  - Add `/api/groups/:jid/status` endpoint to backend.
  - Update `agent-runner` to extract token usage from LLM responses.
  - Store usage stats in backend memory (`groupStats`).
  - Update `Chat.tsx` to include the sidebar.

## detailed Steps

### Backend
1.  **Update `ContainerOutput` Interface**:
    - Modify `src/container-runner.ts` and `container/agent-runner/src/index.ts` to include `usage` field.
2.  **Capture Usage in Agent Runner**:
    - Modify `container/agent-runner/src/index.ts` to parse `usage` (input/output tokens) from SDK result messages.
    - Rebuild `agent-runner`.
3.  **Store and Expose Usage**:
    - Update `src/index.ts` to store `usage` in an in-memory `groupStats` object when `runAgent` completes.
    - Update `src/server.ts` to add `GET /api/groups/:jid/status` endpoint, returning working directory, model, and usage.

### Frontend
1.  **Create Components**:
    - `frontend/src/components/StatusSidebar.tsx`: Fetches and displays status.
    - `frontend/src/components/SlashCommandPopup.tsx`: Shows command list.
2.  **Update Chat Page**:
    - Modify `frontend/src/pages/Chat.tsx`:
      - Import new components.
      - Add state for slash command popup.
      - Implement slash command logic in input handler.
      - Add `StatusSidebar` to the layout.

## Verification
- Run `npm run build` in `container/agent-runner` (Done).
- Start the application and verify:
  - Slash commands appear when typing `/`.
  - Status sidebar shows correct info.
  - Token usage updates after bot responses.
