// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KnowledgeBase } from './KnowledgeBase';

const logoutMock = vi.fn(async () => {});

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    token: 'test-token',
    user: { id: 'u1', username: 'tester', role: 'admin', display_name: 'Tester' },
    logout: logoutMock,
  }),
}));

vi.mock('@/components/kb/KBExtractDialog', () => ({
  KBExtractDialog: () => null,
}));

vi.mock('@/components/ConfirmDialog', () => ({
  ConfirmDialog: () => null,
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

describe('KnowledgeBase layout proportions', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/kb/health')) {
        return createJsonResponse({ connected: true });
      }
      if (url.endsWith('/api/kb/tree')) {
        return createJsonResponse([
          {
            uri: 'viking://resources/cnp-kb/guide.md',
            name: 'guide.md',
            type: 'file',
          },
        ]);
      }
      if (url.includes('/api/kb/read?uri=')) {
        return createJsonResponse({ content: '# Guide\n\nKB content' });
      }
      if (url.includes('/api/kb/search')) {
        return createJsonResponse([]);
      }
      throw new Error(`Unhandled fetch url: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('aligns the top shell and workspace columns on the same spacing baseline', async () => {
    await act(async () => {
      root.render(<KnowledgeBase />);
    });
    await flush();

    const pageShell = container.firstElementChild as HTMLDivElement | null;
    expect(pageShell?.className ?? '').toContain('px-4');
    expect(pageShell?.className ?? '').toContain('py-4');

    // Semantic search input should be present in the toolbar
    const searchInput = container.querySelector('input[placeholder*="语义搜索"]');
    expect(searchInput).not.toBeNull();

    const workspace = Array.from(container.querySelectorAll('div')).find((node) =>
      (node.className ?? '').includes('lg:grid-cols-[280px_minmax(0,1fr)]'),
    );
    expect(workspace?.className ?? '').toContain('gap-4');

    const aside = container.querySelector('aside');
    expect(aside?.className ?? '').toContain('rounded-xl');
    expect(aside?.className ?? '').toContain('border');

    const treeHeading = Array.from(container.querySelectorAll('h2')).find(
      (node) => node.textContent?.trim() === '目录树',
    );
    expect(treeHeading?.className ?? '').toContain('text-[13px]');
  });
});
