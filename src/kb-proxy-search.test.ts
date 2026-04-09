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

function errorResponse(message: string, status = 500): Response {
  return {
    ok: false,
    status,
    statusText: 'Internal Server Error',
    text: async () => JSON.stringify({
      status: 'error',
      error: {
        message,
      },
    }),
  } as Response;
}

describe('kb search failure handling', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('search 在所有搜索范围都失败时应抛出错误，而不是伪装成空结果', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(errorResponse('scope root failed'))
      .mockResolvedValueOnce(errorResponse('scope user failed'))
      .mockResolvedValueOnce(errorResponse('scope agent failed')));

    const { search } = await import('./kb-proxy.js');

    await expect(search('容器云团队有哪些人')).rejects.toThrow('scope root failed');
  });

  it('search 应兼容 OpenViking 的 resources 结果结构', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          status: 'ok',
          result: {
            memories: [],
            resources: [
              {
                uri: 'viking://resources/cnp-kb/team.md',
                content: '容器云团队成员包含 jimmy',
                score: 0.91,
                category: 'resources',
              },
            ],
            skills: [],
            total: 1,
          },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ status: 'ok', result: { memories: [], resources: [], skills: [], total: 0 } }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ status: 'ok', result: { memories: [], resources: [], skills: [], total: 0 } }),
      } as Response));

    const { search } = await import('./kb-proxy.js');
    const result = await search('容器云团队有哪些人');

    expect(result).toEqual([
      expect.objectContaining({
        uri: 'viking://resources/cnp-kb/team.md',
        abstract: '容器云团队成员包含 jimmy',
        category: 'resources',
        score: 0.91,
      }),
    ]);
  });

  it('search 在语义搜索为空时应回退到 grep 结果', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ status: 'ok', result: { memories: [], resources: [], skills: [], total: 0 } }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          status: 'ok',
          result: {
            matches: [
              {
                uri: 'viking://resources/cnp-kb/team.md/upload_x.md',
                line: 3,
                content: '容器云团队有哪些人：jimmy、alice',
              },
            ],
            count: 1,
          },
        }),
      } as Response));

    const { search } = await import('./kb-proxy.js');
    const result = await search('容器云团队有哪些人', {
      targetUri: 'viking://resources/cnp-kb/',
    });

    expect(result).toEqual([
      expect.objectContaining({
        uri: 'viking://resources/cnp-kb/team.md/upload_x.md',
        abstract: '容器云团队有哪些人：jimmy、alice',
        category: 'grep',
        score: 1,
      }),
    ]);
  });

  it('getRelevantContext 在会话 transcript 场景下应使用消息正文作为检索词', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ status: 'ok', result: { memories: [], resources: [], skills: [], total: 0 } }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ status: 'ok', result: { memories: [], resources: [], skills: [], total: 0 } }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ status: 'ok', result: { memories: [], resources: [], skills: [], total: 0 } }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ status: 'ok', result: { matches: [], count: 0 } }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ status: 'ok', result: { matches: [], count: 0 } }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ status: 'ok', result: { matches: [], count: 0 } }),
      } as Response);
    vi.stubGlobal('fetch', fetchMock);

    const { getRelevantContext } = await import('./kb-proxy.js');

    await getRelevantContext(
      '<messages>\n'
      + '<message sender="Alice" time="2026-04-09T10:00:00.000Z">先帮我排查一下</message>\n'
      + '<message sender="Alice" time="2026-04-09T10:00:05.000Z">数据库连接超时怎么处理</message>\n'
      + '</messages>',
      { limit: 3 },
    );

    expect(fetchMock).toHaveBeenCalled();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      query: '先帮我排查一下\n数据库连接超时怎么处理',
    });
  });

  it('search 在 trusted mode 下应携带账号和用户头', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ status: 'ok', result: { memories: [], resources: [], skills: [], total: 0 } }),
      } as Response);
    vi.stubGlobal('fetch', fetchMock);

    const { search } = await import('./kb-proxy.js');

    await search('数据库连接超时', {
      targetUri: 'viking://resources/cnp-kb/',
      identity: {
        userId: 'alice',
      },
    } as any);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers).toMatchObject({
      authorization: 'Bearer dev-secret-key',
      'X-OpenViking-Account': 'acme',
      'X-OpenViking-User': 'alice',
      'X-OpenViking-Agent': 'kb-agent',
    });
  });

  it('writeContent 后应使同一查询的知识库上下文缓存失效', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          status: 'ok',
          result: {
            resources: [
              {
                uri: 'viking://resources/cnp-kb/team.md',
                content: '旧版团队信息：jimmy',
                score: 0.91,
                category: 'resources',
              },
            ],
            memories: [],
            skills: [],
            total: 1,
          },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          status: 'ok',
          result: {
            content: '旧版团队信息：jimmy',
          },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          status: 'ok',
          result: {
            temp_file_id: 'upload_team.md',
          },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          status: 'ok',
          result: {
            resource_uri: 'viking://resources/cnp-kb/team.md',
          },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          status: 'ok',
          result: {
            resources: [
              {
                uri: 'viking://resources/cnp-kb/team.md',
                content: '新版团队信息：alice',
                score: 0.93,
                category: 'resources',
              },
            ],
            memories: [],
            skills: [],
            total: 1,
          },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          status: 'ok',
          result: {
            content: '新版团队信息：alice',
          },
        }),
      } as Response);
    vi.stubGlobal('fetch', fetchMock);

    const { getRelevantContext, writeContent } = await import('./kb-proxy.js');

    const first = await getRelevantContext('团队成员有哪些人', {
      targetUri: 'viking://resources/cnp-kb/',
      limit: 3,
    });
    expect(first).toContain('旧版团队信息：jimmy');

    await writeContent(
      'viking://resources/cnp-kb/team.md',
      '# team\n\n新版团队信息：alice',
      'replace',
    );

    const second = await getRelevantContext('团队成员有哪些人', {
      targetUri: 'viking://resources/cnp-kb/',
      limit: 3,
    });

    expect(second).toContain('新版团队信息：alice');
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it('getRelevantContext 应优先读取正文而不是沿用搜索摘要', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          status: 'ok',
          result: {
            resources: [
              {
                uri: 'viking://resources/cnp-kb/team.md',
                content: '旧摘要：jimmy',
                score: 0.91,
                category: 'resources',
              },
            ],
            memories: [],
            skills: [],
            total: 1,
          },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          status: 'ok',
          result: {
            content: '最新正文：alice',
          },
        }),
      } as Response);
    vi.stubGlobal('fetch', fetchMock);

    const { getRelevantContext } = await import('./kb-proxy.js');
    const result = await getRelevantContext('团队成员有哪些人', {
      targetUri: 'viking://resources/cnp-kb/',
      limit: 3,
    });

    expect(result).toContain('最新正文：alice');
    expect(result).not.toContain('旧摘要：jimmy');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('getRelevantContext 读取会话草稿时应优先提取关键结论段落', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          status: 'ok',
          result: {
            resources: [
              {
                uri: 'viking://resources/cnp-kb/team.md',
                content: '',
                score: 0.91,
                category: 'resources',
              },
            ],
            memories: [],
            skills: [],
            total: 1,
          },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          status: 'ok',
          result: {
            content: [
              '# 团队信息更新',
              '',
              '## 摘要',
              '容器云平台团队有3个人：wangzhixin、fujianli、liudi。',
              '',
              '## 关键结论',
              '- 最近新来一位成员 zhangzhende',
              '- 容器云平台团队现在有4个人：wangzhixin、fujianli、liudi、zhangzhende',
            ].join('\n'),
          },
        }),
      } as Response);
    vi.stubGlobal('fetch', fetchMock);

    const { getRelevantContext } = await import('./kb-proxy.js');
    const result = await getRelevantContext('容器云平台有哪些人', {
      targetUri: 'viking://resources/cnp-kb/',
      limit: 3,
    });

    expect(result).toContain('zhangzhende');
    expect(result).toContain('团队现在有4个人');
    expect(result).not.toContain('团队有3个人');
  });
});
