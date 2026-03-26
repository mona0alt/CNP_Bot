export type ThinkingContentBlock = {
  type: 'thinking' | 'redacted_thinking';
  text?: string;
  [key: string]: unknown;
};

function isThinkingBlock(block: unknown): block is ThinkingContentBlock {
  if (!block || typeof block !== 'object') return false;
  const type = (block as { type?: unknown }).type;
  return type === 'thinking' || type === 'redacted_thinking';
}

export function mergeThinkingBlocksIntoFinalBlocks(
  finalBlocks: unknown[],
  streamThinkingBlocks: ThinkingContentBlock[],
): unknown[] {
  if (streamThinkingBlocks.length === 0) return finalBlocks;

  const finalHasThinkingBlocks = finalBlocks.some(isThinkingBlock);
  if (finalHasThinkingBlocks) return finalBlocks;

  return [...streamThinkingBlocks, ...finalBlocks];
}
