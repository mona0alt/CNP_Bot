import { describe, expect, it } from 'vitest';

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
});
