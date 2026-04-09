// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KBExtractDialog } from './KBExtractDialog';

const logoutMock = vi.fn(async () => {});

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    token: 'test-token',
    logout: logoutMock,
  }),
}));

function createJsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status });
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('KBExtractDialog', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('提取草稿后应进入审核态并允许保存到知识库', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.endsWith('/api/chats')) {
        return createJsonResponse([{ jid: 'group-1', name: '运维群' }]);
      }
      if (url.includes('/api/groups/group-1/messages?limit=5')) {
        return createJsonResponse([
          {
            id: 'm1',
            sender_name: 'Alice',
            timestamp: '2026-04-08T10:00:00.000Z',
            content: '生产环境数据库连接持续超时，应用大量报错。',
          },
        ]);
      }
      if (url.endsWith('/api/kb/extract-draft') && method === 'POST') {
        return createJsonResponse({
          draftTitle: '数据库连接超时排查',
          suggestedUri: 'viking://resources/cnp-kb/数据库连接超时排查.md',
          content: '# 数据库连接超时排查\n\n## 摘要\n连接池配置过小导致超时。',
          source: {
            chatJid: 'group-1',
            chatName: '运维群',
            messageCount: 2,
            generatedAt: '2026-04-08T10:00:00.000Z',
          },
          warnings: [],
        });
      }
      if (url.endsWith('/api/kb/save-draft') && method === 'POST') {
        return createJsonResponse({
          success: true,
          uri: 'viking://resources/cnp-kb/数据库连接超时排查.md',
        });
      }
      throw new Error(`Unhandled fetch url: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await act(async () => {
      root.render(<KBExtractDialog open onClose={() => {}} chatJid="group-1" />);
    });
    await flush();

    const extractButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('提取草稿'),
    );
    expect(extractButton).not.toBeNull();
    await act(async () => {
      extractButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();

    expect(container.textContent ?? '').toContain('审核知识草稿');
    expect(container.textContent ?? '').toContain('viking://resources/cnp-kb/数据库连接超时排查.md');

    const textarea = container.querySelector('textarea');
    expect(textarea).not.toBeNull();
    await act(async () => {
      textarea!.value = '# 数据库连接超时排查\n\n## 摘要\n已人工确认。';
      textarea!.dispatchEvent(new Event('input', { bubbles: true }));
      textarea!.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();

    const saveButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('保存到知识库'),
    );
    expect(saveButton).not.toBeNull();
    await act(async () => {
      saveButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();

    const saveCall = fetchMock.mock.calls.find(
      ([input, init]) => String(input).endsWith('/api/kb/save-draft') && init?.method === 'POST',
    );
    expect(saveCall).toBeTruthy();
  });
});
