import type { ContentBlock } from "./types";

const STREAM_INDEX_KEY = '__streamIndex';

type InternalContentBlock = ContentBlock & {
  [STREAM_INDEX_KEY]?: number;
};

interface StreamEvent {
  type: string;
  text?: string;
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
  block?: ContentBlock;
}

interface ToolContent {
  text?: string;
}

function findBlockPositionByStreamIndex(
  blocks: ContentBlock[],
  streamIndex: number,
): number {
  const mappedIndex = blocks.findIndex(
    (block) => (block as InternalContentBlock)[STREAM_INDEX_KEY] === streamIndex,
  );

  if (mappedIndex !== -1) return mappedIndex;
  return streamIndex < blocks.length ? streamIndex : -1;
}

export function finalizePendingToolCalls(
  blocks: ContentBlock[],
  status: 'error' | 'cancelled' = 'cancelled',
  result = status === 'cancelled' ? '已终止' : '执行失败',
): ContentBlock[] {
  let changed = false;

  const nextBlocks = blocks.map((block) => {
    if (block.type !== 'tool_use' || block.status !== 'calling') {
      return block;
    }

    changed = true;
    return {
      ...block,
      status,
      result: block.result ?? result,
    };
  });

  return changed ? nextBlocks : blocks;
}

export function applyEventToBlocks(blocks: ContentBlock[], event: StreamEvent): ContentBlock[] {
  const newBlocks = [...blocks];

  if (event.type === 'jumpserver_session' && event.block?.type === 'jumpserver_session') {
    let fallbackIndex = -1;
    for (let index = newBlocks.length - 1; index >= 0; index -= 1) {
      if (newBlocks[index]?.type === 'jumpserver_session') {
        fallbackIndex = index;
        break;
      }
    }
    const existingIndex = event.block.id
      ? newBlocks.findIndex(
          (block) =>
            block.type === 'jumpserver_session' &&
            block.id === event.block?.id,
        )
      : fallbackIndex;

    if (existingIndex !== -1) {
      newBlocks[existingIndex] = event.block;
    } else {
      newBlocks.push(event.block);
    }
    return newBlocks;
  }

  if (event.type === 'content_block_start' && event.content_block) {
    const nextBlock: InternalContentBlock = {
      type: event.content_block.type as ContentBlock['type'],
    } as InternalContentBlock;

    if (event.index !== undefined) {
      nextBlock[STREAM_INDEX_KEY] = event.index;
    }
    if (typeof event.content_block.text === 'string') {
      nextBlock.text = event.content_block.text;
    }
    if (
      event.content_block.type === 'thinking' ||
      event.content_block.type === 'redacted_thinking'
    ) {
      nextBlock.isComplete = false;
    }
    if (event.content_block.id !== undefined) {
      nextBlock.id = event.content_block.id;
    }
    if (event.content_block.name !== undefined) {
      nextBlock.name = event.content_block.name;
    }
    if (event.content_block.input !== undefined) {
      nextBlock.input = event.content_block.input;
    }
    if (event.content_block.type === 'tool_use') {
      nextBlock.status = 'calling';
    }

    newBlocks.push(nextBlock);
  } else if (event.type === 'content_block_delta' && event.delta && event.index !== undefined) {
    const index = findBlockPositionByStreamIndex(newBlocks, event.index);
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
    const index = findBlockPositionByStreamIndex(newBlocks, event.index);
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
      } else if (block.type === 'thinking' || block.type === 'redacted_thinking') {
        block.isComplete = true;
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

  // Deep agent event formats: text_delta, tool_use_start, tool_use_end
  if (event.type === 'text_delta') {
    const text = event.text ?? event.delta?.text ?? '';
    if (newBlocks.length > 0 && newBlocks[newBlocks.length - 1].type === 'text') {
      const lastBlock = { ...newBlocks[newBlocks.length - 1] };
      lastBlock.text = (lastBlock.text || '') + text;
      newBlocks[newBlocks.length - 1] = lastBlock;
    } else {
      newBlocks.push({ type: 'text', text });
    }
    return newBlocks;
  }

  if (event.type === 'tool_use_start') {
    newBlocks.push({
      type: 'tool_use',
      id: event.content_block?.id,
      name: event.content_block?.name,
      input: event.content_block?.input,
      status: 'calling',
    } as ContentBlock);
    return newBlocks;
  }

  if (event.type === 'tool_use_end') {
    // Mark the last tool_use block as executed
    for (let index = newBlocks.length - 1; index >= 0; index -= 1) {
      if (newBlocks[index].type === 'tool_use' && newBlocks[index].status === 'calling') {
        newBlocks[index] = { ...newBlocks[index], status: 'executed' };
        break;
      }
    }
    return newBlocks;
  }

  return newBlocks;
}
