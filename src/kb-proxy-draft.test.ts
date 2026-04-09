import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./config.js', () => ({
  KB_API_KEY: 'dev-secret-key',
  KB_API_URL: 'http://kb.example',
  KB_EXTRACT_TIMEOUT: 30000,
  KB_ROOT_URI: 'viking://resources/cnp-kb/',
  KB_SEARCH_TIMEOUT: 15000,
}));

vi.mock('./logger.js', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

function jsonResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  } as Response;
}

describe('buildKnowledgeDraft', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('应生成可编辑的 markdown 草稿和根目录目标路径', async () => {
    const kbProxy = await import('./kb-proxy.js') as Record<string, unknown>;
    const buildKnowledgeDraft = kbProxy.buildKnowledgeDraft as undefined | ((
      messages: Array<{ role?: string; content: string }>,
      options?: { title?: string; chatJid?: string; chatName?: string },
    ) => {
      draftTitle: string;
      suggestedUri: string;
      content: string;
      source: { chatJid?: string; chatName?: string; messageCount: number; generatedAt: string };
      warnings: string[];
    });

    expect(typeof buildKnowledgeDraft).toBe('function');

    const result = buildKnowledgeDraft!(
      [
        { role: 'user', content: '生产环境数据库连接持续超时，应用大量报错，需要尽快定位。' },
        { role: 'assistant', content: '先检查连接池、网络连通性，再核对数据库负载与慢查询。' },
        { role: 'assistant', content: '最终发现连接池配置过小，扩容后恢复，同时保留慢查询排查步骤。' },
      ],
      {
        title: '数据库连接超时排查',
        chatJid: 'group-1',
        chatName: '运维群',
      },
    );

    expect(result.draftTitle).toBe('数据库连接超时排查');
    expect(result.suggestedUri).toBe('viking://resources/cnp-kb/数据库连接超时排查.md');
    expect(result.content).toContain('# 数据库连接超时排查');
    expect(result.content).toContain('## 摘要');
    expect(result.content).toContain('生产环境数据库连接持续超时');
    expect(result.source).toMatchObject({
      chatJid: 'group-1',
      chatName: '运维群',
      messageCount: 3,
    });
    expect(result.warnings).toEqual([]);
  });

  it('saveKnowledgeDraft 应通过 temp_upload 和 resources 接口保存文本资源', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        status: 'ok',
        result: {
          temp_path: '/app/data/temp/upload/upload_123.md',
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        status: 'ok',
        result: {
          status: 'success',
          root_uri: 'viking://resources/cnp-kb/数据库连接超时排查.md',
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        status: 'ok',
        result: [
          {
            uri: 'viking://resources/cnp-kb/数据库连接超时排查.md',
            rel_path: '数据库连接超时排查.md',
            isDir: true,
          },
          {
            uri: 'viking://resources/cnp-kb/数据库连接超时排查.md/upload_123.md',
            rel_path: '数据库连接超时排查.md/upload_123.md',
            isDir: false,
          },
        ],
      }));
    vi.stubGlobal('fetch', fetchMock);

    const { saveKnowledgeDraft } = await import('./kb-proxy.js');
    const result = await saveKnowledgeDraft({
      uri: 'viking://resources/cnp-kb/数据库连接超时排查.md',
      content: '# 数据库连接超时排查',
      overwrite: true,
    });

    expect(result).toEqual({
      success: true,
      uri: 'viking://resources/cnp-kb/数据库连接超时排查.md/upload_123.md',
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('http://kb.example/api/v1/resources/temp_upload');
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe('http://kb.example/api/v1/resources');
  });

  it('fsDelete 应对知识资源目录使用 recursive=true', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        status: 'ok',
        result: {
          removed: true,
        },
      }));
    vi.stubGlobal('fetch', fetchMock);

    const { fsDelete } = await import('./kb-proxy.js');
    const result = await fsDelete('viking://resources/cnp-kb/数据库连接超时排查.md');

    expect(result).toBe(true);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'http://kb.example/api/v1/fs?uri=viking%3A%2F%2Fresources%2Fcnp-kb%2F%E6%95%B0%E6%8D%AE%E5%BA%93%E8%BF%9E%E6%8E%A5%E8%B6%85%E6%97%B6%E6%8E%92%E6%9F%A5.md&recursive=true',
    );
  });
});
