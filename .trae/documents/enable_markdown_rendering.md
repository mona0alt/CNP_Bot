# Plan: Enable Rich Markdown Rendering in Chat Interface

The goal is to enhance the chat interface to support rich Markdown rendering for messages, specifically focusing on beautiful typography, tool call visualization (as cards), and task list rendering.

## 1. Install Dependencies
Install the necessary libraries for Markdown rendering and syntax highlighting in the `frontend` directory.
- `react-markdown`: The core library for rendering Markdown in React.
- `remark-gfm`: A plugin to support GitHub Flavored Markdown (tables, strikethrough, task lists).
- `@tailwindcss/typography`: A plugin for Tailwind CSS to simplify Markdown styling.
- `react-syntax-highlighter`: For beautiful code highlighting in tool calls and code blocks.

## 2. Update Configuration (`frontend/tailwind.config.js`)
- Add `@tailwindcss/typography` to the plugins list.

## 3. Create Markdown Components (`frontend/src/components/MarkdownRenderer.tsx`)
Create a dedicated component for rendering Markdown to keep `Chat.tsx` clean.

- **Props**: `content` (string).
- **Plugins**: Use `remark-gfm`.
- **Custom Components**:
  - **Code Blocks (`code`)**:
    - Intercept code blocks.
    - Render them as "Cards" with a header (showing language/tool name) and a content body.
    - Use `react-syntax-highlighter` for the content.
    - Add a copy button in the header.
  - **Task Lists (`li` with checkbox)**:
    - Style checkboxes (`input type="checkbox"`) to look modern and clear, representing "Planned Tasks".
  - **Links (`a`)**: Ensure they open in new tabs and are styled distinctively.
  - **Tables**: Style tables with borders and padding.

## 4. Update Chat Component (`frontend/src/pages/Chat.tsx`)
- Import the new `MarkdownRenderer` component.
- Replace the raw message content rendering with `<MarkdownRenderer content={msg.content} />`.
- Ensure the container handles overflow properly for wide content (like tables or code).

## 5. Verification
- Verify that the code compiles without errors.
- Ensure all dependencies are added.
- Check that the Markdown rendering supports:
  - Standard text formatting (bold, italic).
  - Code blocks (rendered as cards).
  - Task lists (rendered clearly).
  - Tables.
