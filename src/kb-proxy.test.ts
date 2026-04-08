import { describe, expect, it } from 'vitest';

import { buildQueryProfile, filterMessages, rankForInjection } from './kb-proxy.js';

describe('rankForInjection', () => {
  it('在基础分相同的情况下应优先提升叶子节点（level 2）', () => {
    const profile = buildQueryProfile('kubernetes 发布流程');

    const branchScore = rankForInjection(
      {
        uri: 'viking://resources/cnp-kb/docs/',
        score: 0.72,
        level: 1,
        abstract: 'kubernetes 发布流程总览',
      },
      profile,
    );
    const leafScore = rankForInjection(
      {
        uri: 'viking://resources/cnp-kb/docs/sop/deploy.md',
        score: 0.72,
        level: 2,
        abstract: 'kubernetes 发布流程总览',
      },
      profile,
    );

    expect(leafScore).toBeGreaterThan(branchScore);
  });

  it('应提升与查询词汇重叠更高的结果', () => {
    const profile = buildQueryProfile('kubernetes deployment rollout');

    const related = rankForInjection(
      {
        uri: 'viking://resources/cnp-kb/docs/sop/rollout.md',
        score: 0.61,
        level: 2,
        abstract: 'kubernetes deployment rollout maxSurge maxUnavailable',
      },
      profile,
    );
    const unrelated = rankForInjection(
      {
        uri: 'viking://resources/cnp-kb/docs/incidents/oom.md',
        score: 0.61,
        level: 2,
        abstract: 'database backup window and retention policy',
      },
      profile,
    );

    expect(related).toBeGreaterThan(unrelated);
  });
});

describe('filterMessages', () => {
  it('应移除内容少于 10 个字符的消息', () => {
    const filtered = filterMessages([
      { role: 'user', content: '太短了' },
      { role: 'assistant', content: '这是一个足够长的有效消息内容。' },
    ]);

    expect(filtered).toEqual([{ role: 'assistant', content: '这是一个足够长的有效消息内容。' }]);
  });

  it('应移除 slash command 消息', () => {
    const filtered = filterMessages([
      { role: 'user', content: '/deploy production now' },
      { role: 'assistant', content: '这是一条正常的知识提取候选消息内容。' },
    ]);

    expect(filtered).toEqual([{ role: 'assistant', content: '这是一条正常的知识提取候选消息内容。' }]);
  });

  it('应将超长消息截断到 24000 个字符', () => {
    const filtered = filterMessages([
      { role: 'assistant', content: 'a'.repeat(25000) },
    ]);

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.content).toHaveLength(24000);
  });
});
