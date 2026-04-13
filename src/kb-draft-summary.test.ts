import { describe, expect, it, vi } from 'vitest';

vi.mock('./config.js', () => ({
  KB_SUMMARY_LLM_API_URL: 'https://llm.example/v1',
  KB_SUMMARY_LLM_API_KEY: 'summary-secret',
  KB_SUMMARY_LLM_MODEL: 'gpt-4.1-mini',
  KB_SUMMARY_LLM_TIMEOUT: 12000,
}));

describe('kb draft summary helper', () => {
  it('getKnowledgeDraftPrompt 应包含 no-tools 约束与固定标题', async () => {
    const { getKnowledgeDraftPrompt } = await import('./kb-draft-summary.js');

    const prompt = getKnowledgeDraftPrompt('[user] 数据库连接超时');

    expect(prompt).toContain('CRITICAL: Respond with TEXT ONLY');
    expect(prompt).toContain('<analysis>');
    expect(prompt).toContain('## 摘要');
    expect(prompt).toContain('## 关键结论');
    expect(prompt).toContain('## 后续建议');
  });

  it('parseKnowledgeDraftSummary 应提取 summary / conclusions / followUps', async () => {
    const { parseKnowledgeDraftSummary } = await import('./kb-draft-summary.js');

    const parsed = parseKnowledgeDraftSummary(`
<analysis>scratch</analysis>
<summary>
## 摘要
定位到连接池配置不足。

## 关键结论
- 根因是连接池过小
- 扩容后恢复

## 后续建议
- 复核峰值连接数
</summary>`);

    expect(parsed).toEqual({
      summary: '定位到连接池配置不足。',
      conclusions: ['根因是连接池过小', '扩容后恢复'],
      followUps: ['复核峰值连接数'],
    });
  });

  it('parseKnowledgeDraftSummary 在缺少 <summary> 时应抛错', async () => {
    const { parseKnowledgeDraftSummary } = await import('./kb-draft-summary.js');

    expect(() => parseKnowledgeDraftSummary('plain text')).toThrow(/summary/i);
  });
});
