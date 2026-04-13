// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatSidebar } from './ChatSidebar';

describe('ChatSidebar proportions', () => {
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
  });

  it('uses a wider sidebar and clearer session hierarchy in expanded mode', async () => {
    await act(async () => {
      root.render(
        <ChatSidebar
          chats={[
            {
              jid: 'web:a',
              name: 'Session A',
              last_message_time: '2026-04-01T10:00:00.000Z',
              last_message: '这是最近一条消息预览，用于检查层级。',
              last_user_message: '排查知识库同步失败',
              is_group: 0,
            },
          ]}
          selectedJid="web:a"
          onSelectChat={vi.fn()}
          onCreateChat={vi.fn()}
          onDeleteChat={vi.fn()}
          collapsed={false}
          onToggleCollapsed={vi.fn()}
        />,
      );
    });

    const sidebar = container.firstElementChild as HTMLDivElement | null;
    expect(sidebar?.className ?? '').toContain('w-56');

    const heading = container.querySelector('h2');
    expect(heading?.className ?? '').toContain('text-[14px]');

    const createButton = Array.from(container.querySelectorAll('button')).find(
      (node) => node.textContent?.includes('新建'),
    );
    expect(createButton?.className ?? '').toContain('h-8');

    const title = Array.from(container.querySelectorAll('div')).find(
      (node) =>
        node.textContent === '排查知识库同步失败' &&
        (node.className ?? '').includes('text-[13px]'),
    );
    expect(title?.className ?? '').toContain('text-[13px]');

    const preview = Array.from(container.querySelectorAll('div')).find(
      (node) =>
        node.textContent?.includes('这是最近一条消息预览') &&
        (node.className ?? '').includes('text-[11px]'),
    );
    expect(preview?.className ?? '').toContain('text-[11px]');
  });
});
