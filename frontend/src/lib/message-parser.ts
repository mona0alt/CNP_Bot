import type { ContentBlock } from "./types";

export function parseMessageContent(content: string): ContentBlock[] {
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    return [{ type: "text", text: content }];
  } catch {
    return [{ type: "text", text: content }];
  }
}

export function serializeMessageContent(blocks: ContentBlock[]): string {
  return JSON.stringify(blocks);
}