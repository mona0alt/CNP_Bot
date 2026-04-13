// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ThoughtProcess } from './ThoughtProcess';
import { ThemeProvider } from '@/contexts/ThemeContext';

describe('ThoughtProcess proportions', () => {
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

  it('keeps thinking card typography slightly lighter than regular message body', async () => {
    await act(async () => {
      root.render(
        <ThemeProvider>
          <ThoughtProcess
            content="先检查日志\n再确认远端状态"
            isComplete={true}
          />
        </ThemeProvider>,
      );
    });

    const header = container.querySelector('.cursor-pointer');
    expect(header?.className ?? '').toContain('px-2');
    expect(header?.className ?? '').toContain('py-1.5');

    const title = Array.from(container.querySelectorAll('span')).find(
      (node) => node.textContent === 'Thinking',
    );
    expect(title?.className ?? '').toContain('text-[10px]');

    const content = Array.from(container.querySelectorAll('div')).find(
      (node) =>
        node.textContent?.includes('先检查日志') &&
        (node.className ?? '').includes('text-[10px]'),
    );
    expect(content?.className ?? '').toContain('text-[10px]');
  });
});
