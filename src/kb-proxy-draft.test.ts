import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./config.js', () => ({
  KB_API_KEY: 'dev-secret-key',
  KB_API_URL: 'http://kb.example',
  KB_API_ACCOUNT: 'acme',
  KB_API_USER: 'default-user',
  KB_API_AGENT_ID: 'kb-agent',
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
          temp_file_id: 'upload_123.md',
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
      uri: 'viking://resources/cnp-kb/数据库连接超时排查.md',
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('http://kb.example/api/v1/resources/temp_upload');
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe('http://kb.example/api/v1/resources');
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      temp_file_id: 'upload_123.md',
      to: 'viking://resources/cnp-kb/数据库连接超时排查.md',
      wait: true,
    });
  });

  it('writeContent 应通过资源上传链路覆盖现有知识文件', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        status: 'ok',
        result: {
          temp_file_id: 'upload_456.md',
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
            isDir: false,
          },
        ],
      }));
    vi.stubGlobal('fetch', fetchMock);

    const { writeContent } = await import('./kb-proxy.js');
    const result = await writeContent(
      'viking://resources/cnp-kb/数据库连接超时排查.md',
      '# 更新后的内容',
      'replace',
    );

    expect(result).toBe(true);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('http://kb.example/api/v1/resources/temp_upload');
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe('http://kb.example/api/v1/resources');
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      temp_file_id: 'upload_456.md',
      to: 'viking://resources/cnp-kb/数据库连接超时排查.md',
      wait: true,
    });
  });

  it('writeContent 在资源已创建但 fsTree 失败时应回退为成功', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        status: 'ok',
        result: {
          temp_uri: 'temp://upload/upload_789.md',
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        status: 'ok',
        result: {
          root_uri: 'viking://resources/cnp-kb/数据库连接超时排查.md',
        },
      }))
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => JSON.stringify({ error: 'tree failed' }),
      } as Response);
    vi.stubGlobal('fetch', fetchMock);

    const { writeContent } = await import('./kb-proxy.js');
    const result = await writeContent(
      'viking://resources/cnp-kb/数据库连接超时排查.md',
      '# 更新后的内容',
      'replace',
    );

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain('/api/v1/fs/tree?uri=');
  });

  it('writeContent 应将 upload 叶子文件 uri 规范化为资源根 uri', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        status: 'ok',
        result: {
          temp_file_id: 'upload_900.md',
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        status: 'ok',
        result: {
          resource_uri: 'viking://resources/cnp-kb/数据库连接超时排查.md',
        },
      }));
    vi.stubGlobal('fetch', fetchMock);

    const { writeContent } = await import('./kb-proxy.js');
    const result = await writeContent(
      'viking://resources/cnp-kb/数据库连接超时排查.md/upload_900.md',
      '# 更新后的内容',
      'replace',
    );

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      temp_file_id: 'upload_900.md',
      to: 'viking://resources/cnp-kb/数据库连接超时排查.md',
      wait: true,
    });
  });

  it('writeContent 应兼容 temp_upload 返回 temp_file_id', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        status: 'ok',
        result: {
          temp_file_id: 'upload_new.md',
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        status: 'ok',
        result: {
          root_uri: 'viking://resources/cnp-kb/数据库连接超时排查.md',
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        status: 'ok',
        result: [
          {
            uri: 'viking://resources/cnp-kb/数据库连接超时排查.md',
            rel_path: '数据库连接超时排查.md',
            isDir: false,
          },
        ],
      }));
    vi.stubGlobal('fetch', fetchMock);

    const { writeContent } = await import('./kb-proxy.js');
    const result = await writeContent(
      'viking://resources/cnp-kb/数据库连接超时排查.md',
      '# 更新后的内容',
      'replace',
    );

    expect(result).toBe(true);
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      temp_file_id: 'upload_new.md',
      to: 'viking://resources/cnp-kb/数据库连接超时排查.md',
      wait: true,
    });
  });

  it('writeContent 在创建接口返回非知识库根 root_uri 时不应再请求 fsTree', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        status: 'ok',
        result: {
          temp_uri: 'temp://upload/upload_901.md',
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        status: 'ok',
        result: {
          root_uri: 'viking://resources/upload_ea7e7f8bb88d4af8b6cc2f995094e867',
        },
      }));
    vi.stubGlobal('fetch', fetchMock);

    const { writeContent } = await import('./kb-proxy.js');
    const result = await writeContent(
      'viking://resources/cnp-kb/数据库连接超时排查.md/upload_901.md',
      '# 更新后的内容',
      'replace',
    );

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('readContent 读取文档根 uri 为空时应回退到叶子文件', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        status: 'ok',
        result: {
          content: '',
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        status: 'ok',
        result: [
          {
            uri: 'viking://resources/cnp-kb/数据库连接超时排查.md/upload_901.md',
            rel_path: 'upload_901.md',
            isDir: false,
          },
        ],
      }))
      .mockResolvedValueOnce(jsonResponse({
        status: 'ok',
        result: {
          content: '# 最新内容',
        },
      }));
    vi.stubGlobal('fetch', fetchMock);

    const { readContent } = await import('./kb-proxy.js');
    const result = await readContent('viking://resources/cnp-kb/数据库连接超时排查.md');

    expect(result).toBe('# 最新内容');
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'http://kb.example/api/v1/content/read?uri=viking%3A%2F%2Fresources%2Fcnp-kb%2F%E6%95%B0%E6%8D%AE%E5%BA%93%E8%BF%9E%E6%8E%A5%E8%B6%85%E6%97%B6%E6%8E%92%E6%9F%A5.md',
    );
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      'http://kb.example/api/v1/fs/tree?uri=viking%3A%2F%2Fresources%2Fcnp-kb%2F%E6%95%B0%E6%8D%AE%E5%BA%93%E8%BF%9E%E6%8E%A5%E8%B6%85%E6%97%B6%E6%8E%92%E6%9F%A5.md',
    );
    expect(String(fetchMock.mock.calls[2]?.[0])).toBe(
      'http://kb.example/api/v1/content/read?uri=viking%3A%2F%2Fresources%2Fcnp-kb%2F%E6%95%B0%E6%8D%AE%E5%BA%93%E8%BF%9E%E6%8E%A5%E8%B6%85%E6%97%B6%E6%8E%92%E6%9F%A5.md%2Fupload_901.md',
    );
  });

  it('fsTree 应将文档资源目录折叠为可编辑文件节点', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        status: 'ok',
        result: [
          {
            uri: 'viking://resources/cnp-kb/数据库连接超时排查.md',
            rel_path: '数据库连接超时排查.md',
            isDir: true,
          },
          {
            uri: 'viking://resources/cnp-kb/数据库连接超时排查.md/upload_901.md',
            rel_path: '数据库连接超时排查.md/upload_901.md',
            isDir: false,
          },
        ],
      }));
    vi.stubGlobal('fetch', fetchMock);

    const { fsTree } = await import('./kb-proxy.js');
    const result = await fsTree('viking://resources/cnp-kb/');

    expect(result).toEqual([
      {
        uri: 'viking://resources/cnp-kb/数据库连接超时排查.md',
        name: '数据库连接超时排查.md',
        type: 'file',
        children: [],
      },
    ]);
  });

  it('fsTree 在知识库根目录不存在时应自动创建后重试', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => JSON.stringify({
          error: {
            message: 'no such directory: /default/resources/cnp-kb',
          },
        }),
      } as Response)
      .mockResolvedValueOnce(jsonResponse({
        status: 'ok',
        result: {
          created: true,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        status: 'ok',
        result: [],
      }));
    vi.stubGlobal('fetch', fetchMock);

    const { fsTree } = await import('./kb-proxy.js');
    const result = await fsTree('viking://resources/cnp-kb/');

    expect(result).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'http://kb.example/api/v1/fs/tree?uri=viking%3A%2F%2Fresources%2Fcnp-kb%2F',
    );
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe('http://kb.example/api/v1/fs/mkdir');
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      uri: 'viking://resources/cnp-kb/',
    });
    expect(String(fetchMock.mock.calls[2]?.[0])).toBe(
      'http://kb.example/api/v1/fs/tree?uri=viking%3A%2F%2Fresources%2Fcnp-kb%2F',
    );
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
