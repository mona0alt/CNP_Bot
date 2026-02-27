# Plan: Chat Session Management and Branding Update

## User Request
1.  Add session management features to the chat page, specifically "Delete Session".
2.  Change the logo text on the page from "NanoClaw" to "CNP-Bot".

## Implementation Steps

### 1. Backend Changes

#### 1.1 Database Layer (`src/db.ts`)
-   Implement `deleteChat(jid: string): void` function.
-   This function will execute:
    -   `DELETE FROM messages WHERE chat_jid = ?`
    -   `DELETE FROM chats WHERE jid = ?`

#### 1.2 API Layer (`src/server.ts`)
-   Add a new endpoint: `DELETE /api/chats/:jid`.
-   This endpoint will:
    -   Extract `jid` from request parameters.
    -   Call `deleteChat(jid)` from the database layer.
    -   Return a success response (200 OK).
    -   Handle errors appropriately (500 Internal Server Error).

### 2. Frontend Changes

#### 2.1 Branding Update (`frontend/src/components/Sidebar.tsx`)
-   Locate the header text "NanoClaw".
-   Update it to "CNP-Bot".

#### 2.2 Chat Interface (`frontend/src/pages/Chat.tsx`)
-   Import the `Trash2` icon from `lucide-react`.
-   Update the chat list item rendering to include a delete button.
    -   Position the delete button to the right of the chat item or show it on hover.
    -   Ensure clicking the delete button does not trigger the chat selection (stopPropagation).
-   Implement `handleDeleteChat(jid: string)`:
    -   Show a confirmation dialog (using `window.confirm` for simplicity).
    -   If confirmed, send a `DELETE` request to `/api/chats/:jid`.
    -   On success:
        -   Remove the chat from the local `chats` state.
        -   If the deleted chat was the currently selected one (`selectedJid`), clear the selection and message view.
    -   On error, log the error (and optionally alert the user).

## Verification Plan
1.  **Branding Check**: Open the web interface and verify the sidebar title says "CNP-Bot".
2.  **Delete Chat Flow**:
    -   Create a new chat session (or use an existing one).
    -   Verify it appears in the list.
    -   Click the delete button.
    -   Confirm the deletion.
    -   Verify the chat disappears from the list.
    -   Verify the chat is no longer selectable.
    -   (Optional) Check database directly to ensure messages are gone.
