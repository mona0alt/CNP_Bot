export interface ParsedSegment {
  type: 'text' | 'thought';
  content: string;
  isComplete?: boolean;
}

export function parseThoughts(text: string): ParsedSegment[] {
  const segments: ParsedSegment[] = [];
  const tagPairs = [
    { open: '<commentary>', close: '</commentary>' },
    { open: '<thinking>', close: '</thinking>' },
    { open: '<think>', close: '</think>' },
    { open: '<internal>', close: '</internal>' }
  ];

  let cursor = 0;

  while (cursor < text.length) {
    let next: { pair: { open: string; close: string }; index: number } | null = null;
    for (const pair of tagPairs) {
      const index = text.indexOf(pair.open, cursor);
      if (index === -1) continue;
      if (!next || index < next.index) {
        next = { pair, index };
      }
    }

    if (!next) {
      const remaining = text.slice(cursor);
      if (remaining.trim()) {
        segments.push({ type: 'text', content: remaining });
      }
      break;
    }

    if (next.index > cursor) {
      const plainText = text.slice(cursor, next.index);
      if (plainText.trim()) {
        segments.push({ type: 'text', content: plainText });
      }
    }

    const contentStartIndex = next.index + next.pair.open.length;
    const closeIndex = text.indexOf(next.pair.close, contentStartIndex);

    if (closeIndex === -1) {
      const thoughtContent = text.slice(contentStartIndex);
      segments.push({ type: 'thought', content: thoughtContent, isComplete: false });
      break;
    } else {
      const thoughtContent = text.slice(contentStartIndex, closeIndex);
      segments.push({ type: 'thought', content: thoughtContent, isComplete: true });
      cursor = closeIndex + next.pair.close.length;
    }
  }

  return segments;
}
