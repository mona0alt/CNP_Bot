import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('extractConversation', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('应兼容 OpenViking status/result 包装的 session_id 和提取结果', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        status: 'ok',
        result: {
          session_id: 'session-123',
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        status: 'ok',
        result: {
          accepted: true,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        status: 'ok',
        result: [
          { title: 'memory-1' },
        ],
      }))
      .mockResolvedValueOnce(jsonResponse({
        status: 'ok',
        result: {
          deleted: true,
        },
      }));
    vi.stubGlobal('fetch', fetchMock);

    const { extractConversation } = await import('./kb-proxy.js');
    const result = await extractConversation([
      { role: 'user', content: '这是一条足够长的测试消息，用于验证知识提取接口行为。' },
    ], { title: 'test' });

    expect(result).toEqual({
      ok: true,
      count: 1,
      items: [{ title: 'memory-1' }],
      partial: false,
      errors: undefined,
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('http://kb.example/api/v1/sessions/session-123/messages');
    expect(fetchMock.mock.calls[2]?.[0]).toBe('http://kb.example/api/v1/sessions/session-123/extract');
  });
});
