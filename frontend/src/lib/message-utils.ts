import type { ContentBlock } from "./types";

export function applyEventToBlocks(blocks: ContentBlock[], event: any): ContentBlock[] {
  const newBlocks = [...blocks];

  if (event.type === 'content_block_start') {
    newBlocks.push({
      type: event.content_block.type,
      text: event.content_block.text || '',
      id: event.content_block.id,
      name: event.content_block.name,
      input: event.content_block.input,
      status: event.content_block.type === 'tool_use' ? 'calling' : undefined
    });
  } else if (event.type === 'content_block_delta') {
    const index = event.index;
    if (newBlocks[index]) {
      const block = { ...newBlocks[index] };
      if (event.delta.type === 'text_delta') {
        block.text = (block.text || '') + event.delta.text;
      } else if (event.delta.type === 'input_json_delta') {
        block.partial_json = (block.partial_json || '') + event.delta.partial_json;
      }
      newBlocks[index] = block;
    }
  } else if (event.type === 'content_block_stop') {
    const index = event.index;
    if (newBlocks[index]) {
      const block = { ...newBlocks[index] };
      if (block.type === 'tool_use') {
        if (block.partial_json && !block.input) {
          try {
            block.input = JSON.parse(block.partial_json);
          } catch {
            // Keep partial if parsing fails
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
        block.result = event.content.map((c: any) => c.text || JSON.stringify(c)).join('\n');
      } else {
        block.result = event.content;
      }
      newBlocks[index] = block;
    }
  }

  return newBlocks;
}