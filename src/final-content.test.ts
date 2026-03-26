import { describe, expect, it } from 'vitest';

import { mergeThinkingBlocksIntoFinalBlocks } from './final-content.js';

describe('mergeThinkingBlocksIntoFinalBlocks', () => {
  it('最终消息缺少 thinking 时，应补入 stream 阶段保留的 thinking blocks', () => {
    const finalBlocks = [
      {
        type: 'jumpserver_session',
        id: 'jump-1',
        stage: 'completed',
      },
      {
        type: 'text',
        text: '最终结论',
      },
    ];

    const merged = mergeThinkingBlocksIntoFinalBlocks(finalBlocks, [
      { type: 'thinking', text: '先连接 JumpServer。' },
      { type: 'thinking', text: '再检查远端日志。' },
    ]);

    expect(merged).toEqual([
      { type: 'thinking', text: '先连接 JumpServer。' },
      { type: 'thinking', text: '再检查远端日志。' },
      {
        type: 'jumpserver_session',
        id: 'jump-1',
        stage: 'completed',
      },
      {
        type: 'text',
        text: '最终结论',
      },
    ]);
  });

  it('最终消息已包含 thinking 时，不应重复追加 stream thinking', () => {
    const finalBlocks = [
      { type: 'thinking', text: '最终消息里的思考。' },
      { type: 'text', text: '最终结论' },
    ];

    const merged = mergeThinkingBlocksIntoFinalBlocks(finalBlocks, [
      { type: 'thinking', text: '流式阶段的思考。' },
    ]);

    expect(merged).toEqual(finalBlocks);
  });
});
