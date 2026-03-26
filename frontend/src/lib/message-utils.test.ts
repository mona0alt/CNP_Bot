import { describe, expect, it } from 'vitest';

import { parseMessageContent } from './message-parser';
import { applyEventToBlocks } from './message-utils';

describe('applyEventToBlocks', () => {
  it('兼容 deepagent 顶层 text_delta.text 字段', () => {
    const blocks = applyEventToBlocks([], {
      type: 'text_delta',
      text: '你好，',
    } as any);

    const next = applyEventToBlocks(blocks, {
      type: 'text_delta',
      text: '世界',
    } as any);

    expect(next).toEqual([{ type: 'text', text: '你好，世界' }]);
  });

  it('流式过程中有 text/tool 插入时，thinking delta 仍应更新到对应的 thinking block', () => {
    let blocks = applyEventToBlocks([], {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'thinking', text: '' },
    } as any);

    blocks = applyEventToBlocks(blocks, {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'thinking_delta', thinking: '第一段思考' },
    } as any);

    blocks = applyEventToBlocks(blocks, {
      type: 'text_delta',
      text: '正文片段',
    } as any);

    blocks = applyEventToBlocks(blocks, {
      type: 'content_block_start',
      index: 1,
      content_block: {
        type: 'tool_use',
        id: 'tool-1',
        name: 'Bash',
        input: { command: 'pwd' },
      },
    } as any);

    blocks = applyEventToBlocks(blocks, {
      type: 'content_block_start',
      index: 2,
      content_block: { type: 'thinking', text: '' },
    } as any);

    blocks = applyEventToBlocks(blocks, {
      type: 'content_block_delta',
      index: 2,
      delta: { type: 'thinking_delta', thinking: '第二段思考' },
    } as any);

    expect(blocks).toHaveLength(4);
    expect(blocks[0]).toMatchObject({ type: 'thinking', text: '第一段思考' });
    expect(blocks[1]).toMatchObject({ type: 'text', text: '正文片段' });
    expect(blocks[2]).toMatchObject({
      type: 'tool_use',
      id: 'tool-1',
      name: 'Bash',
      input: { command: 'pwd' },
      status: 'calling',
    });
    expect(blocks[3]).toMatchObject({
      type: 'thinking',
      text: '第二段思考',
      isComplete: false,
    });

    blocks = applyEventToBlocks(blocks, {
      type: 'content_block_stop',
      index: 2,
    } as any);

    expect(blocks[3]).toMatchObject({
      type: 'thinking',
      text: '第二段思考',
      isComplete: true,
    });
  });

  it('经过 JSON round-trip 后，thinking delta 仍应更新到原始 stream index 对应的 thinking block', () => {
    let content = JSON.stringify([] as unknown[]);

    const applyRoundTripEvent = (event: any) => {
      const blocks = parseMessageContent(content);
      const nextBlocks = applyEventToBlocks(blocks, event);
      content = JSON.stringify(nextBlocks);
      return parseMessageContent(content);
    };

    applyRoundTripEvent({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'thinking', text: '' },
    });

    applyRoundTripEvent({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'thinking_delta', thinking: '第一段思考' },
    });

    applyRoundTripEvent({
      type: 'text_delta',
      text: '正文片段',
    });

    applyRoundTripEvent({
      type: 'content_block_start',
      index: 1,
      content_block: {
        type: 'tool_use',
        id: 'tool-1',
        name: 'Bash',
        input: { command: 'pwd' },
      },
    });

    applyRoundTripEvent({
      type: 'content_block_start',
      index: 2,
      content_block: { type: 'thinking', text: '' },
    });

    const blocks = applyRoundTripEvent({
      type: 'content_block_delta',
      index: 2,
      delta: { type: 'thinking_delta', thinking: '第二段思考' },
    });

    expect(blocks[2]).toMatchObject({
      type: 'tool_use',
      id: 'tool-1',
      name: 'Bash',
      input: { command: 'pwd' },
      status: 'calling',
    });
    expect(blocks[3]).toMatchObject({
      type: 'thinking',
      text: '第二段思考',
      isComplete: false,
    });
  });
});
