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
  StatusSidebar: ({ open }: { open: boolean }) =>
    open ? <div data-testid="status-sidebar">status</div> : null,
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

interface MessageRecord {
  id: string;
  chat_jid: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_from_me: boolean;
  is_bot_message: boolean;
}

class FakeWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.OPEN;
  url: string;
  sentPayloads: string[] = [];
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

  send(payload: string): void {
    this.sentPayloads.push(payload);
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit('close', { code: 1000 });
  }

  emitMessage(payload: unknown): void {
    this.emit('message', { data: JSON.stringify(payload) });
  }

  private emit(type: string, event?: unknown): void {
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }
}

function getLatestSocketForJid(jid: string): FakeWebSocket {
  const encodedJid = encodeURIComponent(jid);
  const instance = [...FakeWebSocket.instances]
    .reverse()
    .find((socket) => socket.url.includes(`jid=${encodedJid}`));

  if (!instance) {
    throw new Error(`No websocket found for jid: ${jid}`);
  }

  return instance;
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('Chat 页面集成 - 会话切换时流式消息恢复', () => {
  let container: HTMLDivElement;
  let root: Root;
  let fetchMock: ReturnType<typeof vi.fn>;
  let createChatCalls: number;
  let currentChats: ChatSummary[];

  const chats: ChatSummary[] = [
    {
      jid: 'web:a',
      name: 'Session A',
      last_message_time: '2026-03-18T08:00:00.000Z',
      last_message: '',
      last_user_message: 'Session A',
      is_group: 0,
    },
    {
      jid: 'web:b',
      name: 'Session B',
      last_message_time: '2026-03-18T08:00:01.000Z',
      last_message: '',
      last_user_message: 'Session B',
      is_group: 0,
    },
  ];

  const persistedMessages = new Map<string, MessageRecord[]>([
    ['web:a', []],
    ['web:b', []],
  ]);

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
    createChatCalls = 0;
    currentChats = [...chats];

    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (url.endsWith('/api/chats')) {
        if (method === 'POST') {
          createChatCalls += 1;
          const createdChat = {
            jid: 'web:created-by-test',
            name: 'Created By Test',
            last_message_time: '2026-03-18T08:00:02.000Z',
            last_message: '',
            last_user_message: '',
            is_group: 0,
          };
          currentChats = [createdChat];
          return new Response(
            JSON.stringify(createdChat),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify(currentChats), { status: 200 });
      }

      if (url.endsWith('/api/slash-commands')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      if (url.includes('/api/groups/') && url.endsWith('/status')) {
        return new Response(JSON.stringify({ isActive: false }), { status: 200 });
      }

      if (url.includes('/api/groups/') && url.includes('/messages?limit=200')) {
        const jid = decodeURIComponent(
          url.split('/api/groups/')[1]!.split('/messages')[0]!,
        );
        return new Response(
          JSON.stringify(persistedMessages.get(jid) ?? []),
          { status: 200 },
        );
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

  it('已有会话时进入页面不会自动创建新会话', async () => {
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

    expect(createChatCalls).toBe(0);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/chats'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
        }),
      }),
    );

    const selectA = container.querySelector(
      '[data-testid="select-web\\:a"]',
    ) as HTMLButtonElement | null;
    expect(selectA).not.toBeNull();
    expect(selectA?.getAttribute('data-selected')).toBe('true');
  });

  it('没有任何会话时，只自动创建一次 session', async () => {
    currentChats = [];

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

    expect(createChatCalls).toBe(1);

    const created = container.querySelector(
      '[data-testid="select-web\\:created-by-test"]',
    ) as HTMLButtonElement | null;
    expect(created).not.toBeNull();
    expect(created?.getAttribute('data-selected')).toBe('true');

    const postCalls = fetchMock.mock.calls.filter(([input, init]) => {
      const url = String(input);
      const method = (init as RequestInit | undefined)?.method ?? 'GET';
      return url.endsWith('/api/chats') && method === 'POST';
    });
    expect(postCalls).toHaveLength(1);
  });

  it('切换 A -> B -> A 后，继续流式更新仍写回同一张消息卡片', async () => {
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

    const selectA = container.querySelector(
      '[data-testid="select-web\\:a"]',
    ) as HTMLButtonElement | null;
    expect(selectA).not.toBeNull();

    await act(async () => {
      selectA!.click();
    });
    await flush();

    const firstSocketForA = getLatestSocketForJid('web:a');

    await act(async () => {
      firstSocketForA.emitMessage({
        type: 'stream_event',
        chat_jid: 'web:a',
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: {
            type: 'tool_use',
            id: 'tool-1',
            name: 'Bash',
            input: {},
          },
        },
      });
    });
    await flush();

    let messageItems = container.querySelectorAll('[data-testid="message-item"]');
    expect(messageItems).toHaveLength(1);
    expect(messageItems[0]?.textContent).toContain('tool-1');

    const selectB = container.querySelector(
      '[data-testid="select-web\\:b"]',
    ) as HTMLButtonElement | null;
    expect(selectB).not.toBeNull();

    await act(async () => {
      selectB!.click();
    });
    await flush();

    await act(async () => {
      selectA!.click();
    });
    await flush();

    messageItems = container.querySelectorAll('[data-testid="message-item"]');
    expect(messageItems).toHaveLength(1);
    expect(messageItems[0]?.textContent).toContain('tool-1');

    const secondSocketForA = getLatestSocketForJid('web:a');
    expect(secondSocketForA).not.toBe(firstSocketForA);

    await act(async () => {
      secondSocketForA.emitMessage({
        type: 'stream_event',
        chat_jid: 'web:a',
        event: {
          type: 'content_block_start',
          index: 1,
          content_block: {
            type: 'tool_use',
            id: 'tool-2',
            name: 'Skill',
            input: {},
          },
        },
      });
    });
    await flush();

    messageItems = container.querySelectorAll('[data-testid="message-item"]');
    expect(messageItems).toHaveLength(1);
    expect(messageItems[0]?.textContent).toContain('tool-1');
    expect(messageItems[0]?.textContent).toContain('tool-2');
  });

  it('切换多次页面 + tool_result + 最终message后，仍只保留一张卡片并合并最终文本', async () => {
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

    const selectA = container.querySelector(
      '[data-testid="select-web\\:a"]',
    ) as HTMLButtonElement | null;
    const selectB = container.querySelector(
      '[data-testid="select-web\\:b"]',
    ) as HTMLButtonElement | null;

    expect(selectA).not.toBeNull();
    expect(selectB).not.toBeNull();

    await act(async () => {
      selectA!.click();
    });
    await flush();

    const socketA1 = getLatestSocketForJid('web:a');

    await act(async () => {
      socketA1.emitMessage({
        type: 'stream_event',
        chat_jid: 'web:a',
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: {
            type: 'tool_use',
            id: 'tool-merge-1',
            name: 'Bash',
            input: {},
          },
        },
      });
    });
    await flush();

    await act(async () => {
      selectB!.click();
    });
    await flush();

    await act(async () => {
      selectA!.click();
    });
    await flush();

    const socketA2 = getLatestSocketForJid('web:a');
    expect(socketA2).not.toBe(socketA1);

    await act(async () => {
      socketA2.emitMessage({
        type: 'stream_event',
        chat_jid: 'web:a',
        event: {
          type: 'tool_result',
          tool_use_id: 'tool-merge-1',
          content: 'partial-output',
        },
      });
    });
    await flush();

    let messageItems = container.querySelectorAll('[data-testid="message-item"]');
    expect(messageItems).toHaveLength(1);
    expect(messageItems[0]?.textContent).toContain('tool-merge-1');
    expect(messageItems[0]?.textContent).toContain('partial-output');

    await act(async () => {
      selectB!.click();
    });
    await flush();

    await act(async () => {
      selectA!.click();
    });
    await flush();

    const socketA3 = getLatestSocketForJid('web:a');

    await act(async () => {
      socketA3.emitMessage({
        type: 'message',
        data: {
          id: 'final-a-1',
          chat_jid: 'web:a',
          sender_name: 'CNP-Bot',
          content: '最终文本回复',
          timestamp: '2099-03-18T08:00:50.000Z',
          is_from_me: false,
          is_bot_message: true,
        },
      });
    });
    await flush();

    messageItems = container.querySelectorAll('[data-testid="message-item"]');
    expect(messageItems).toHaveLength(1);

    const mergedText = messageItems[0]?.textContent ?? '';
    expect(mergedText).toContain('tool-merge-1');
    expect(mergedText).toContain('partial-output');
    expect(mergedText).toContain('最终文本回复');

    expect(messageItems[0]?.getAttribute('data-messageid')).toBe('final-a-1');

    persistedMessages.set('web:a', [
      {
        id: 'final-a-1',
        chat_jid: 'web:a',
        sender_name: 'CNP-Bot',
        content: '最终文本回复',
        timestamp: '2099-03-18T08:00:50.000Z',
        is_from_me: false,
        is_bot_message: true,
      },
    ]);

    await act(async () => {
      selectB!.click();
    });
    await flush();

    await act(async () => {
      selectA!.click();
    });
    await flush();

    messageItems = container.querySelectorAll('[data-testid="message-item"]');
    expect(messageItems).toHaveLength(1);
    expect(messageItems[0]?.getAttribute('data-messageid')).toBe('final-a-1');
    expect(messageItems[0]?.textContent ?? '').toContain('最终文本回复');
  });

  it('JumpServer 专用流式事件会复用同一条消息并在最终消息中保留聚合块', async () => {
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

    const selectA = container.querySelector(
      '[data-testid="select-web\\:a"]',
    ) as HTMLButtonElement | null;
    expect(selectA).not.toBeNull();

    await act(async () => {
      selectA!.click();
    });
    await flush();

    const socketA = getLatestSocketForJid('web:a');

    await act(async () => {
      socketA.emitMessage({
        type: 'stream_event',
        chat_jid: 'web:a',
        event: {
          type: 'jumpserver_session',
          block: {
            type: 'jumpserver_session',
            id: 'jump-1',
            stage: 'jumpserver_ready',
            status: 'calling',
            latest_output: 'Opt> 输入目标主机',
            executions: [],
          },
        },
      });
    });
    await flush();

    await act(async () => {
      socketA.emitMessage({
        type: 'stream_event',
        chat_jid: 'web:a',
        event: {
          type: 'jumpserver_session',
          block: {
            type: 'jumpserver_session',
            id: 'jump-1',
            stage: 'running_remote_command',
            target_host: '10.246.104.234',
            latest_output: 'Mar 19 kernel: test',
            executions: [
              {
                id: 'exec-1',
                command: 'journalctl -n 50',
                status: 'running',
              },
            ],
          },
        },
      });
    });
    await flush();

    let messageItems = container.querySelectorAll('[data-testid="message-item"]');
    const jumpStreamItems = Array.from(messageItems).filter((item) =>
      (item.textContent ?? '').includes('jump-1'),
    );
    expect(jumpStreamItems).toHaveLength(1);
    const streamText = jumpStreamItems[0]?.textContent ?? '';
    expect(streamText).toContain('jumpserver_session');
    expect(streamText).toContain('10.246.104.234');
    expect(streamText).toContain('journalctl -n 50');
    expect(streamText).toContain('Mar 19 kernel: test');

    await act(async () => {
      socketA.emitMessage({
        type: 'message',
        data: {
          id: 'final-jump-1',
          chat_jid: 'web:a',
          sender_name: 'CNP-Bot',
          content: JSON.stringify([
            {
              type: 'jumpserver_session',
              id: 'jump-1',
              stage: 'completed',
              target_host: '10.246.104.234',
              executions: [
                {
                  id: 'exec-1',
                  command: 'journalctl -n 50',
                  status: 'completed',
                },
              ],
            },
            { type: 'text', text: '最终文本回复' },
          ]),
          timestamp: '2099-03-18T08:01:50.000Z',
          is_from_me: false,
          is_bot_message: true,
        },
      });
    });
    await flush();

    messageItems = container.querySelectorAll('[data-testid="message-item"]');
    const mergedItems = Array.from(messageItems).filter((item) =>
      (item.textContent ?? '').includes('final-jump-1') ||
      (item.textContent ?? '').includes('jump-1'),
    );
    expect(mergedItems).toHaveLength(1);
    const mergedText = mergedItems[0]?.textContent ?? '';
    expect(mergedText).toContain('jumpserver_session');
    expect(mergedText).toContain('journalctl -n 50');
    expect(mergedText).toContain('"stage":"completed"');
    expect(mergedText).toContain('"status":"completed"');
    expect(mergedText).not.toContain('"stage":"running_remote_command"');
    expect(mergedText).not.toContain('"status":"running"');
    expect(mergedText).toContain('最终文本回复');
    expect(mergedItems[0]?.getAttribute('data-messageid')).toBe('final-jump-1');
  });

  it('最终消息里的 thinking 与 jumpserver 完成态 block 不应被旧 stream 非文本块覆盖', async () => {
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

    const selectA = container.querySelector(
      '[data-testid="select-web\\:a"]',
    ) as HTMLButtonElement | null;
    expect(selectA).not.toBeNull();

    await act(async () => {
      selectA!.click();
    });
    await flush();

    const socketA = getLatestSocketForJid('web:a');

    await act(async () => {
      socketA.emitMessage({
        type: 'stream_event',
        chat_jid: 'web:a',
        event: {
          type: 'jumpserver_session',
          block: {
            type: 'jumpserver_session',
            id: 'jump-2',
            stage: 'running_remote_command',
            status: 'calling',
            target_host: '10.246.104.235',
            executions: [
              {
                id: 'exec-2',
                command: 'hostname',
                status: 'running',
              },
            ],
          },
        },
      });
    });
    await flush();

    await act(async () => {
      socketA.emitMessage({
        type: 'message',
        data: {
          id: 'final-jump-2',
          chat_jid: 'web:a',
          sender_name: 'CNP-Bot',
          content: JSON.stringify([
            {
              type: 'jumpserver_session',
              id: 'jump-2',
              stage: 'completed',
              status: 'executed',
              target_host: '10.246.104.235',
              executions: [
                {
                  id: 'exec-2',
                  command: 'hostname',
                  status: 'completed',
                },
              ],
            },
            {
              type: 'thinking',
              text: '先确认远端命令已经执行完成。',
            },
            {
              type: 'text',
              text: '主机名已经拿到。',
            },
          ]),
          timestamp: '2099-03-18T08:02:00.000Z',
          is_from_me: false,
          is_bot_message: true,
        },
      });
    });
    await flush();

    const messageItems = container.querySelectorAll('[data-testid="message-item"]');
    const mergedItems = Array.from(messageItems).filter((item) =>
      (item.textContent ?? '').includes('final-jump-2') ||
      (item.textContent ?? '').includes('jump-2'),
    );
    expect(mergedItems).toHaveLength(1);
    const mergedText = mergedItems[0]?.textContent ?? '';
    expect(mergedText).toContain('"stage":"completed"');
    expect(mergedText).toContain('"status":"executed"');
    expect(mergedText).toContain('"type":"thinking"');
    expect(mergedText).toContain('先确认远端命令已经执行完成。');
    expect(mergedText).toContain('主机名已经拿到。');
    expect(mergedText).not.toContain('"stage":"running_remote_command"');
    expect(mergedText).not.toContain('"status":"running"');
    expect(mergedItems[0]?.getAttribute('data-messageid')).toBe('final-jump-2');
  });

  it('最终消息里的 jumpserver block 若缺少 executions，应回退复用 stream 中已有的执行记录', async () => {
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

    const selectA = container.querySelector(
      '[data-testid="select-web\\:a"]',
    ) as HTMLButtonElement | null;
    expect(selectA).not.toBeNull();

    await act(async () => {
      selectA!.click();
    });
    await flush();

    const socketA = getLatestSocketForJid('web:a');

    await act(async () => {
      socketA.emitMessage({
        type: 'stream_event',
        chat_jid: 'web:a',
        event: {
          type: 'jumpserver_session',
          block: {
            type: 'jumpserver_session',
            id: 'jump-3',
            stage: 'running_remote_command',
            status: 'calling',
            target_host: '10.246.104.236',
            executions: [
              {
                id: 'exec-3',
                command: 'journalctl -n 50',
                status: 'running',
              },
            ],
          },
        },
      });
    });
    await flush();

    await act(async () => {
      socketA.emitMessage({
        type: 'message',
        data: {
          id: 'final-jump-3',
          chat_jid: 'web:a',
          sender_name: 'CNP-Bot',
          content: JSON.stringify([
            {
              type: 'jumpserver_session',
              id: 'jump-3',
              stage: 'completed',
              status: 'executed',
              target_host: '10.246.104.236',
              executions: [],
            },
            {
              type: 'text',
              text: '日志已经查看完毕。',
            },
          ]),
          timestamp: '2099-03-18T08:03:00.000Z',
          is_from_me: false,
          is_bot_message: true,
        },
      });
    });
    await flush();

    const messageItems = container.querySelectorAll('[data-testid="message-item"]');
    const mergedItems = Array.from(messageItems).filter((item) =>
      (item.textContent ?? '').includes('final-jump-3') ||
      (item.textContent ?? '').includes('jump-3'),
    );
    expect(mergedItems).toHaveLength(1);
    const mergedText = mergedItems[0]?.textContent ?? '';
    expect(mergedText).toContain('"stage":"completed"');
    expect(mergedText).toContain('"status":"executed"');
    expect(mergedText).toContain('journalctl -n 50');
    expect(mergedText).not.toContain('"executions":[]');
    expect(mergedItems[0]?.getAttribute('data-messageid')).toBe('final-jump-3');
  });

  it('最终消息若没有 thinking block，应保留 stream 阶段已有的 thinking 卡片', async () => {
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

    const selectA = container.querySelector(
      '[data-testid="select-web\\:a"]',
    ) as HTMLButtonElement | null;
    expect(selectA).not.toBeNull();

    await act(async () => {
      selectA!.click();
    });
    await flush();

    const socketA = getLatestSocketForJid('web:a');

    await act(async () => {
      socketA.emitMessage({
        type: 'stream_event',
        chat_jid: 'web:a',
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: {
            type: 'thinking',
            text: '',
          },
        },
      });
      socketA.emitMessage({
        type: 'stream_event',
        chat_jid: 'web:a',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: {
            type: 'thinking_delta',
            thinking: '先分析日志来源。',
          },
        },
      });
      socketA.emitMessage({
        type: 'stream_event',
        chat_jid: 'web:a',
        event: {
          type: 'jumpserver_session',
          block: {
            type: 'jumpserver_session',
            id: 'jump-4',
            stage: 'running_remote_command',
            status: 'calling',
            target_host: '10.246.104.237',
            executions: [
              {
                id: 'exec-4',
                command: 'dmesg | tail',
                status: 'running',
              },
            ],
          },
        },
      });
    });
    await flush();

    await act(async () => {
      socketA.emitMessage({
        type: 'message',
        data: {
          id: 'final-jump-4',
          chat_jid: 'web:a',
          sender_name: 'CNP-Bot',
          content: JSON.stringify([
            {
              type: 'jumpserver_session',
              id: 'jump-4',
              stage: 'completed',
              status: 'executed',
              target_host: '10.246.104.237',
              executions: [],
            },
            {
              type: 'text',
              text: '日志已获取。',
            },
          ]),
          timestamp: '2099-03-18T08:04:00.000Z',
          is_from_me: false,
          is_bot_message: true,
        },
      });
    });
    await flush();

    const messageItems = container.querySelectorAll('[data-testid="message-item"]');
    const mergedItems = Array.from(messageItems).filter((item) =>
      (item.textContent ?? '').includes('final-jump-4') ||
      (item.textContent ?? '').includes('jump-4'),
    );
    expect(mergedItems).toHaveLength(1);
    const mergedText = mergedItems[0]?.textContent ?? '';
    expect(mergedText).toContain('"type":"thinking"');
    expect(mergedText).toContain('先分析日志来源。');
    expect(mergedText).toContain('"stage":"completed"');
    expect(mergedText).toContain('日志已获取。');
  });
});
