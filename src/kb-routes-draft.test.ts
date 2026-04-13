import { EventEmitter } from 'events';

import express from 'express';
import httpMocks from 'node-mocks-http';
import jwt from 'jsonwebtoken';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const getMessagesSinceAllMock = vi.fn();
vi.mock('./db.js', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('./db.js');
  return {
    ...actual,
    getMessagesSinceAll: getMessagesSinceAllMock,
  };
});

const buildKnowledgeDraftMock = vi.fn();
const saveKnowledgeDraftMock = vi.fn();
const searchMock = vi.fn();
vi.mock('./kb-proxy.js', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('./kb-proxy.js');
  return {
    ...actual,
    buildKnowledgeDraft: buildKnowledgeDraftMock,
    saveKnowledgeDraft: saveKnowledgeDraftMock,
    search: searchMock,
  };
});

async function invokeApp(
  app: express.Express,
  options: {
    method: string;
    url: string;
    token: string;
    body?: unknown;
  },
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${options.token}`,
  };
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
  }

  const req = httpMocks.createRequest({
    method: options.method,
    url: options.url,
    headers,
    body: options.body,
  });
  const res = httpMocks.createResponse({ eventEmitter: EventEmitter });

  await new Promise<void>((resolve, reject) => {
    res.on('end', resolve);
    app.handle(req, res, reject);
  });

  return {
    status: res.statusCode,
    body: res._isJSON() ? res._getJSONData() : res._getData(),
  };
}

describe('kb draft routes', () => {
  const token = jwt.sign(
    { userId: 'user-1', username: 'user-1', role: 'admin' },
    'test-secret-do-not-use-in-production',
    { expiresIn: '1h' },
  );

  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('POST /api/kb/extract-draft 应返回草稿内容', async () => {
    getMessagesSinceAllMock.mockReturnValue([
      { is_from_me: false, content: '生产环境数据库连接持续超时，应用大量报错。' },
      { is_from_me: true, content: '最终确认是连接池配置过小，扩容后恢复。' },
    ]);
    buildKnowledgeDraftMock.mockResolvedValue({
      draftTitle: '数据库连接超时排查',
      suggestedUri: 'viking://resources/cnp-kb/数据库连接超时排查.md',
      content: '# 数据库连接超时排查',
      source: {
        chatJid: 'group-1',
        chatName: '运维群',
        messageCount: 2,
        generatedAt: '2026-04-08T10:00:00.000Z',
      },
      warnings: [],
    });

    const { default: kbRouter } = await import('./kb-routes.js');
    const app = express();
    app.use(express.json());
    app.use('/api/kb', kbRouter);

    const res = await invokeApp(app, {
      method: 'POST',
      url: '/api/kb/extract-draft',
      token,
      body: {
        chatJid: 'group-1',
        title: '数据库连接超时排查',
      },
    });

    expect(res.status).toBe(200);
    expect(res.body.draftTitle).toBe('数据库连接超时排查');
    expect(res.body).not.toEqual({});
    expect(buildKnowledgeDraftMock).toHaveBeenCalledTimes(1);
  });

  it('POST /api/kb/save-draft 在目标文件存在时应返回 409', async () => {
    saveKnowledgeDraftMock.mockRejectedValue(Object.assign(
      new Error('目标文件已存在'),
      { code: 'KB_FILE_EXISTS' },
    ));

    const { default: kbRouter } = await import('./kb-routes.js');
    const app = express();
    app.use(express.json());
    app.use('/api/kb', kbRouter);

    const res = await invokeApp(app, {
      method: 'POST',
      url: '/api/kb/save-draft',
      token,
      body: {
        uri: 'viking://resources/cnp-kb/数据库连接超时排查.md',
        content: '# 数据库连接超时排查',
      },
    });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: '目标文件已存在',
      code: 'KB_FILE_EXISTS',
    });
  });

  it('POST /api/kb/search 应透传当前登录用户身份给 KB 代理', async () => {
    searchMock.mockResolvedValue([]);

    const { default: kbRouter } = await import('./kb-routes.js');
    const app = express();
    app.use(express.json());
    app.use('/api/kb', kbRouter);

    const res = await invokeApp(app, {
      method: 'POST',
      url: '/api/kb/search',
      token,
      body: {
        query: '数据库连接超时',
        limit: 5,
      },
    });

    expect(res.status).toBe(200);
    expect(searchMock).toHaveBeenCalledWith('数据库连接超时', {
      limit: 5,
      targetUri: undefined,
      identity: {
        accountId: 'default',
        userId: 'user-1',
      },
    });
  });
});
