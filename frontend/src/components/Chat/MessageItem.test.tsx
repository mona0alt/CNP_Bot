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

    const thinkingLabel = Array.from(container.querySelectorAll('span')).find(
      (node) => node.textContent === 'Thinking',
    );
    const thinkingHeader = thinkingLabel?.closest('div');
    const thinkingRoot = thinkingHeader?.parentElement?.parentElement;
    expect(thinkingHeader).not.toBeNull();
    expect(thinkingRoot).not.toBeNull();

    await act(async () => {
      (thinkingHeader as HTMLDivElement).click();
    });

    const expandedText = container.textContent ?? '';
    expect(expandedText).toContain('先检查 JumpServer 连接。');
    expect(expandedText).toContain('再确认远端命令输出。');
  });

  it('流式中的 thinking block 应默认展开显示实时内容', async () => {
    await act(async () => {
      root.render(
        <ThemeProvider>
          <MessageItem
            message={{
              id: 'stream-live-thinking',
              chat_jid: 'web:test',
              sender_name: 'CNP_Bot',
              content: JSON.stringify([
                { type: 'thinking', text: '正在实时思考', isComplete: false },
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
    expect(text).toContain('Thinking');
    expect(text).toContain('正在实时思考');
    expect(text).toContain('Generating...');
  });

  it('严格按标签识别 think，并保持 JumpServer 与本地 Bash 各自归属', async () => {
    await act(async () => {
      root.render(
        <ThemeProvider>
          <MessageItem
            message={{
              id: 'stream-2',
              chat_jid: 'web:test',
              sender_name: 'CNP_Bot',
              content: JSON.stringify([
                { type: 'text', text: '<think>第一行思考</think>\n第二行正文' },
                {
                  type: 'tool_use',
                  id: 'tool-1',
                  name: 'Shell',
                  input: { command: 'pwd' },
                  status: 'executed',
                  result: '/workspace',
                },
                {
                  type: 'jumpserver_session',
                  id: 'jump-1',
                  stage: 'completed',
                  target_host: '10.246.104.234',
                  executions: [
                    {
                      id: 'exec-1',
                      command: 'uname -a',
                      status: 'completed',
                      output: 'Linux remote-host',
                    },
                  ],
                },
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
    expect(text).toContain('Thinking');
    expect(text).toContain('第二行正文');
    expect(text).toContain('Shell');
    expect(text).toContain('JumpServer 远程会话');

    const thinkingLabel = Array.from(container.querySelectorAll('span')).find(
      (node) => node.textContent === 'Thinking',
    );
    const thinkingHeader = thinkingLabel?.closest('div');
    const thinkingRoot = thinkingHeader?.parentElement?.parentElement;
    expect(thinkingHeader).not.toBeNull();
    expect(thinkingRoot).not.toBeNull();

    await act(async () => {
      (thinkingHeader as HTMLDivElement).click();
    });

    const expandedText = container.textContent ?? '';
    expect(expandedText).toContain('第一行思考');
    expect(expandedText).toContain('第二行正文');

    expect(thinkingRoot?.textContent ?? '').toContain('第一行思考');
    expect(thinkingRoot?.textContent ?? '').not.toContain('第二行正文');

    const jumpserverSection = container.querySelector('section');
    expect(jumpserverSection?.textContent ?? '').toContain('JumpServer 远程会话');
    expect(jumpserverSection?.textContent ?? '').toContain('uname -a');
    expect(jumpserverSection?.textContent ?? '').not.toContain('Linux remote-host');
    expect(jumpserverSection?.textContent ?? '').not.toContain('第二行正文');
  });

  it('同一条消息中被拆开的 thinking 片段，也只展示一张 think 卡片', async () => {
    await act(async () => {
      root.render(
        <ThemeProvider>
          <MessageItem
            message={{
              id: 'stream-3',
              chat_jid: 'web:test',
              sender_name: 'CNP_Bot',
              content: JSON.stringify([
                { type: 'thinking', text: '前置思考' },
                {
                  type: 'jumpserver_session',
                  id: 'jump-2',
                  stage: 'completed',
                  target_host: '10.246.104.235',
                  executions: [
                    {
                      id: 'exec-2',
                      command: 'hostname',
                      status: 'completed',
                      output: 'remote-host',
                    },
                  ],
                },
                { type: 'thinking', text: '后置思考' },
              ]),
              timestamp: '2026-03-25T10:00:00.000Z',
              is_from_me: false,
              is_bot_message: true,
            }}
          />
        </ThemeProvider>,
      );
    });

    const thinkingHeaders = Array.from(container.querySelectorAll('span')).filter(
      (node) => node.textContent === 'Thinking',
    );
    expect(thinkingHeaders).toHaveLength(1);
    expect(container.textContent ?? '').toContain('JumpServer 远程会话');

    await act(async () => {
      const header = thinkingHeaders[0]?.closest('div');
      (header as HTMLDivElement).click();
    });

    const fullText = container.textContent ?? '';
    expect(fullText.indexOf('前置思考')).toBeGreaterThan(-1);
    expect(fullText).toContain('后置思考');
    expect(fullText).toContain('JumpServer 远程会话');
  });

  it('不擅自重排正文与 JumpServer 卡片，按消息原始顺序展示', async () => {
    await act(async () => {
      root.render(
        <ThemeProvider>
          <MessageItem
            message={{
              id: 'stream-4',
              chat_jid: 'web:test',
              sender_name: 'CNP_Bot',
              content: JSON.stringify([
                { type: 'text', text: '这是模型输出正文。' },
                {
                  type: 'jumpserver_session',
                  id: 'jump-3',
                  stage: 'completed',
                  target_host: '10.246.104.236',
                  executions: [
                    {
                      id: 'exec-3',
                      command: 'uptime',
                      status: 'completed',
                      output: 'up 10 days',
                    },
                  ],
                },
              ]),
              timestamp: '2026-03-25T10:00:00.000Z',
              is_from_me: false,
              is_bot_message: true,
            }}
          />
        </ThemeProvider>,
      );
    });

    const fullText = container.textContent ?? '';
    expect(fullText).toContain('JumpServer 远程会话');
    expect(fullText).toContain('这是模型输出正文。');
    expect(fullText.indexOf('这是模型输出正文。')).toBeLessThan(fullText.indexOf('JumpServer 远程会话'));
  });

  it('保留 think、正文与 JumpServer 的原始相对顺序，不把正文统一挪到最后', async () => {
    await act(async () => {
      root.render(
        <ThemeProvider>
          <MessageItem
            message={{
              id: 'stream-5',
              chat_jid: 'web:test',
              sender_name: 'CNP_Bot',
              content: JSON.stringify([
                {
                  type: 'text',
                  text: '<think>第一行思考\n第二行思考</think>\n正文第一段',
                },
                {
                  type: 'jumpserver_session',
                  id: 'jump-5',
                  stage: 'completed',
                  target_host: '10.246.104.237',
                  executions: [
                    {
                      id: 'exec-5',
                      command: 'df -h',
                      status: 'completed',
                      output: '/dev/root 46%',
                    },
                  ],
                },
                { type: 'text', text: '正文第二段' },
              ]),
              timestamp: '2026-03-25T10:00:00.000Z',
              is_from_me: false,
              is_bot_message: true,
            }}
          />
        </ThemeProvider>,
      );
    });

    const thinkingLabel = Array.from(container.querySelectorAll('span')).find(
      (node) => node.textContent === 'Thinking',
    );
    const thinkingHeader = thinkingLabel?.closest('div');
    const thinkingRoot = thinkingHeader?.parentElement?.parentElement;
    expect(thinkingRoot).not.toBeNull();

    await act(async () => {
      (thinkingHeader as HTMLDivElement).click();
    });

    const fullText = container.textContent ?? '';
    expect(fullText.indexOf('第一行思考')).toBeGreaterThan(-1);
    expect(fullText.indexOf('第二行思考')).toBeGreaterThan(fullText.indexOf('第一行思考'));
    expect(fullText.indexOf('正文第一段')).toBeGreaterThan(fullText.indexOf('第二行思考'));
    expect(fullText.indexOf('JumpServer 远程会话')).toBeGreaterThan(fullText.indexOf('正文第一段'));
    expect(fullText.indexOf('正文第二段')).toBeGreaterThan(fullText.indexOf('JumpServer 远程会话'));

    expect(thinkingRoot?.textContent ?? '').toContain('第一行思考');
    expect(thinkingRoot?.textContent ?? '').toContain('第二行思考');
  });
});
