import type { StreamToolEvent } from './jumpserver-stream-aggregator.js';

interface DeepAgentStreamEvent {
  type: string;
  content_block?: {
    type?: string;
    id?: string;
    name?: string;
    input?: { command?: string };
  };
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

export function adaptDeepAgentToolEvent(
  event: DeepAgentStreamEvent,
): StreamToolEvent | null {
  if (
    event.type === 'content_block_start' &&
    event.content_block?.type === 'tool_use'
  ) {
    return {
      type: 'tool_use',
      name: event.content_block.name,
      toolUseId: event.content_block.id,
      input: event.content_block.input,
    };
  }

  if (event.type === 'tool_result') {
    return {
      type: 'tool_result',
      toolUseId: event.tool_use_id,
      content: event.content,
      isError: event.is_error,
    };
  }

  return null;
}
