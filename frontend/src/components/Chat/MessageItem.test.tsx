// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageItem } from './MessageItem';
import { ThemeProvider } from '@/contexts/ThemeContext';

describe('MessageItem', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      media: '(prefers-color-scheme: dark)',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    window.localStorage.clear();
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
  });

  it('同一条消息里多个 thinking block 只展示一张 thinking 卡片', async () => {
    await act(async () => {
      root.render(
        <ThemeProvider>
          <MessageItem
            message={{
              id: 'stream-1',
              chat_jid: 'web:test',
              sender_name: 'CNP_Bot',
              content: JSON.stringify([
                { type: 'thinking', text: '先检查 JumpServer 连接。' },
                { type: 'thinking', text: '再确认远端命令输出。' },
                { type: 'text', text: '最终回复内容。' },
              ]),
              timestamp: '2026-03-25T10:00:00.000Z',
              is_from_me: false,
              is_bot_message: true,
            }}
          />
        </ThemeProvider>,
      );
    });

    const text = container.textContent ?? '';
    const thinkingCount = [...text.matchAll(/Thinking/g)].length;

    expect(thinkingCount).toBe(1);
    expect(text).toContain('最终回复内容。');

    const thinkingHeader = Array.from(container.querySelectorAll('span')).find(
      (node) => node.textContent === 'Thinking',
    )?.closest('div');
    expect(thinkingHeader).not.toBeNull();

    await act(async () => {
      (thinkingHeader as HTMLDivElement).click();
    });

    const expandedText = container.textContent ?? '';
    expect(expandedText).toContain('先检查 JumpServer 连接。');
    expect(expandedText).toContain('再确认远端命令输出。');
  });
});
