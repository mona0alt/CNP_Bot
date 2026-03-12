import type { ContentBlock } from "./types";

interface StreamEvent {
  type: string;
  content_block?: {
    type: string;
    text?: string;
    id?: string;
    name?: string;
    input?: unknown;
  };
  delta?: {
    type: string;
    text?: string;
    partial_json?: string;
    thinking?: string;
  };
  index?: number;
  tool_use_id?: string;
  is_error?: boolean;
  content?: unknown;
}

interface ToolContent {
  text?: string;
}

export function applyEventToBlocks(blocks: ContentBlock[], event: StreamEvent): ContentBlock[] {
  const newBlocks = [...blocks];

  if (event.type === 'content_block_start' && event.content_block) {
    newBlocks.push({
      type: event.content_block.type,
      text: event.content_block.text || '',
      id: event.content_block.id,
      name: event.content_block.name,
      input: event.content_block.input,
      status: event.content_block.type === 'tool_use' ? 'calling' : undefined
    });
  } else if (event.type === 'content_block_delta' && event.delta && event.index !== undefined) {
    const index = event.index;
    if (newBlocks[index]) {
      const block = { ...newBlocks[index] };
      if (event.delta.type === 'text_delta') {
        block.text = (block.text || '') + (event.delta.text || '');
      } else if (event.delta.type === 'input_json_delta') {
        block.partial_json = (block.partial_json || '') + (event.delta.partial_json || '');
      } else if (event.delta.type === 'thinking_delta') {
        block.text = (block.text || '') + (event.delta.thinking || '');
      }
      newBlocks[index] = block;
    }
  } else if (event.type === 'content_block_stop' && event.index !== undefined) {
    const index = event.index;
    if (newBlocks[index]) {
      const block = { ...newBlocks[index] };
      if (block.type === 'tool_use') {
        const isEmptyObject = typeof block.input === 'object' && block.input !== null && Object.keys(block.input as object).length === 0;
        if (block.partial_json && isEmptyObject) {
          try {
            block.input = JSON.parse(block.partial_json);
          } catch {
            block.input = block.partial_json;
          }
        }
      }
      newBlocks[index] = block;
    }
  } else if (event.type === 'tool_result') {
    const index = newBlocks.findIndex(b => b.type === 'tool_use' && b.id === event.tool_use_id);
    if (index !== -1) {
      const block = { ...newBlocks[index] };
      block.status = event.is_error ? 'error' : 'executed';
      if (Array.isArray(event.content)) {
        block.result = event.content.map((c: ToolContent) => c.text || JSON.stringify(c)).join('\n');
      } else {
        if (event.content === null || event.content === undefined) {
          block.result = undefined;
        } else if (typeof event.content === 'object') {
          block.result = event.content as object;
        } else {
          block.result = String(event.content);
        }
      }
      newBlocks[index] = block;
    }
  }

  return newBlocks;
}
