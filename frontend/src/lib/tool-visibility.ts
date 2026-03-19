import type { ContentBlock } from "./types";

function getToolCommand(block: ContentBlock): string {
  if (block.type !== "tool_use") return "";
  if (typeof block.input === "string") return block.input;
  if (
    typeof block.input === "object" &&
    block.input !== null &&
    "command" in block.input
  ) {
    return String((block.input as { command?: unknown }).command ?? "");
  }
  return "";
}

function isEmptyToolPayload(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (typeof value === "object") return Object.keys(value as object).length === 0;
  return false;
}

export function shouldHideToolUseBlock(block: ContentBlock): boolean {
  if (block.type !== "tool_use") return false;

  const command = getToolCommand(block);
  if (
    command &&
    /tmux\s+-S\s+\/tmp\/cnpbot-tmux-sockets\/cnpbot\.sock\b/.test(command)
  ) {
    return true;
  }

  const hasPartialInput =
    typeof block.partial_json === "string" && block.partial_json.trim().length > 0;
  const emptyInput = !hasPartialInput && isEmptyToolPayload(block.input);
  const emptyResult = isEmptyToolPayload(block.result);

  return (
    (block.status === "cancelled" ||
      block.status === "error" ||
      block.status === "executed") &&
    emptyInput &&
    emptyResult
  );
}
