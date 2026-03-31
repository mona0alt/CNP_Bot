// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthContext, type AuthContextType } from '../contexts/AuthContext';
import { StreamingMessagesProvider } from '../contexts/StreamingMessagesContext';
import { Chat } from './Chat';

vi.mock('@/components/Chat', () => ({
  ChatSidebar: ({
    chats,
    selectedJid,
    onSelectChat,
  }: {
    chats: Array<{ jid: string; name: string }>;
    selectedJid: string | null;
    onSelectChat: (jid: string) => void;
  }) => (
    <div data-testid="chat-sidebar">
      {chats.map((chat) => (
        <button
          key={chat.jid}
          data-testid={`select-${chat.jid}`}
          data-selected={selectedJid === chat.jid}
          onClick={() => onSelectChat(chat.jid)}
        >
          {chat.name}
        </button>
      ))}
    </div>
  ),
  MessageInput: () => <div data-testid="message-input">message-input</div>,
}));

vi.mock('@/components/Chat/MessageItem', () => ({
  MessageItem: ({ message }: { message: { id: string; content: string } }) => (
    <div data-testid="message-item" data-messageid={message.id}>
      {message.content}
    </div>
  ),
}));

vi.mock('@/components/StatusSidebar', () => ({
  StatusSidebar: ({
    status,
    open,
  }: {
    status: { model?: string } | null;
    open: boolean;
  }) => (
    <div data-testid="status-sidebar" data-open={open ? 'true' : 'false'}>
      {status?.model ?? 'missing'}
    </div>
  ),
}));

vi.mock('@/components/ConfirmDialog', () => ({
  ConfirmDialog: () => null,
}));

vi.mock('@/components/AskUserCard', () => ({
  AskUserCard: () => null,
}));

vi.mock('@/components/ConfirmBashCard', () => ({
  ConfirmBashCard: () => null,
}));

interface ChatSummary {
  jid: string;
  name: string;
  last_message_time: string;
  last_message: string;
  last_user_message: string;
  is_group: number;
}

class FakeWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.OPEN;
  url: string;
  private listeners = new Map<string, Set<(event?: unknown) => void>>();

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => this.emit('open'));
  }

  addEventListener(type: string, listener: (event?: unknown) => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: (event?: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  send(): void {}

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit('close', { code: 1000 });
  }

  private emit(type: string, event?: unknown): void {
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('Chat status drawer wiring', () => {
  let container: HTMLDivElement;
  let root: Root;
  let fetchMock: ReturnType<typeof vi.fn>;

  const chats: ChatSummary[] = [
    {
      jid: 'web:a',
      name: 'Session A',
      last_message_time: '2026-03-31T08:00:00.000Z',
      last_message: '',
      last_user_message: 'Session A',
      is_group: 0,
    },
    {
      jid: 'web:b',
      name: 'Session B',
      last_message_time: '2026-03-31T08:00:01.000Z',
      last_message: '',
      last_user_message: 'Session B',
      is_group: 0,
    },
  ];

  const statusByJid = {
    'web:a': {
      workingDirectory: '/tmp/status-a',
      model: 'claude-sonnet-4',
      usage: { input_tokens: 12, output_tokens: 8 },
      processReady: true,
      isActive: false,
    },
    'web:b': {
      workingDirectory: '/tmp/status-b',
      model: 'deepseek-r1',
      usage: { input_tokens: 22, output_tokens: 18 },
      processReady: false,
      isActive: true,
    },
  };

  const authValue: AuthContextType = {
    user: {
      id: 'u-1',
      username: 'tester',
      role: 'admin',
      display_name: 'Tester',
    },
    token: 'test-token',
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(async () => {}),
    changePassword: vi.fn(async () => {}),
  };

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);

    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith('/api/chats')) {
        return new Response(JSON.stringify(chats), { status: 200 });
      }

      if (url.endsWith('/api/slash-commands')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      if (url.includes('/api/groups/') && url.endsWith('/status')) {
        const jid = decodeURIComponent(url.split('/api/groups/')[1]!.split('/status')[0]!);
        return new Response(JSON.stringify(statusByJid[jid as keyof typeof statusByJid]), {
          status: 200,
        });
      }

      if (url.includes('/api/groups/') && url.includes('/messages?limit=200')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      throw new Error(`Unhandled fetch url: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);

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

  it('shows a status trigger button and opens the drawer with the current status', async () => {
    await act(async () => {
      root.render(
        <AuthContext.Provider value={authValue}>
          <StreamingMessagesProvider>
            <Chat />
          </StreamingMessagesProvider>
        </AuthContext.Provider>,
      );
    });

    await flush();
    await flush();

    const trigger = container.querySelector('button[aria-label="查看状态"]');
    expect(trigger).not.toBeNull();
    expect(trigger?.querySelector('span')?.className).toContain('bg-green-500');

    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const sidebar = container.querySelector('[data-testid="status-sidebar"]');
    expect(sidebar?.getAttribute('data-open')).toBe('true');
    expect(sidebar?.textContent).toContain('claude-sonnet-4');
  });

  it('auto-closes the drawer when switching sessions', async () => {
    await act(async () => {
      root.render(
        <AuthContext.Provider value={authValue}>
          <StreamingMessagesProvider>
            <Chat />
          </StreamingMessagesProvider>
        </AuthContext.Provider>,
      );
    });

    await flush();
    await flush();

    const trigger = container.querySelector('button[aria-label="查看状态"]');
    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.querySelector('[data-testid="status-sidebar"]')?.getAttribute('data-open')).toBe('true');

    const selectSecond = container.querySelector('[data-testid="select-web\\:b"]');
    await act(async () => {
      selectSecond?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flush();

    expect(container.querySelector('[data-testid="status-sidebar"]')?.getAttribute('data-open')).toBe('false');
    expect(container.querySelector('[data-testid="status-sidebar"]')?.textContent).toContain('deepseek-r1');
  });
});
