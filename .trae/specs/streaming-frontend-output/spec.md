# Streaming Frontend Output Spec

## Why
Currently, the chat interface updates messages in bulk after the backend receives the full response or after a polling interval. Users want a more responsive experience where the AI's response is streamed token-by-token. Additionally, the `<commentary>` (thinking process) tags are displayed raw and need to be beautified.

## What Changes
- **Backend (Agent Runner)**: Enable streaming (`includePartialMessages: true`) in the Claude Agent SDK and forward partial `content_block_delta` events to the container output stream.
- **Backend (Container Runner)**: Parse and forward streaming events from the agent runner.
- **Backend (Server & Web Channel)**: Implement a mechanism to broadcast partial message updates to connected WebSocket clients.
- **Frontend (Chat)**: Handle streaming update events to append content to the last message in real-time.
- **Frontend (MarkdownRenderer)**: Transform `<commentary>` tags into a styled block (e.g., a blockquote or a collapsible section) for better readability.

## Impact
- **Agent Runner**: Will now emit `progress` events in addition to `success/error`.
- **Web Channel**: Will support sending partial updates.
- **Frontend**: Will feel much faster and more interactive.
- **User Experience**: Improved readability of the AI's thought process.

## ADDED Requirements
### Requirement: Streaming Response
The system SHALL stream the AI's response to the frontend as it is generated.

#### Scenario: Success case
- **WHEN** the user sends a message
- **THEN** the AI's response should appear token-by-token in the chat window.

### Requirement: Beautified Commentary
The system SHALL display `<commentary>` blocks in a visually distinct and aesthetically pleasing way.

#### Scenario: Success case
- **WHEN** the AI response contains `<commentary>...</commentary>`
- **THEN** it should be rendered as a styled block (e.g., "Thinking Process") instead of raw XML tags.

## MODIFIED Requirements
### Requirement: Web Channel Message Handling
The `WebChannel` SHALL support a `streamMessage` method (or similar) to broadcast partial updates to the WebSocket server.
The `startServer` function SHALL expose a `broadcast` capability.

### Requirement: Agent Runner Output
The `agent-runner` SHALL be configured to request partial messages from the SDK and output them in a format the `container-runner` can parse.
