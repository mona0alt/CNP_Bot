// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ToolCallCard } from './ToolCallCard';
import { ThemeProvider } from '@/contexts/ThemeContext';

describe('ToolCallCard proportions', () => {
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

  it('uses compact but coordinated header and content sizing', async () => {
    await act(async () => {
      root.render(
        <ThemeProvider>
          <ToolCallCard
            toolName="Bash"
            input={{ command: 'pwd' }}
            status="executed"
            result="/workspace"
            defaultExpanded={true}
          />
        </ThemeProvider>,
      );
    });

    const card = container.firstElementChild as HTMLDivElement | null;
    expect(card?.className ?? '').toContain('rounded-lg');

    const header = card?.firstElementChild as HTMLDivElement | null;
    expect(header?.className ?? '').toContain('px-2');
    expect(header?.className ?? '').toContain('py-1.5');

    const title = header?.querySelector('.font-mono');
    expect(title?.className ?? '').toContain('text-[10.5px]');

    const expandedPre = card?.querySelector('pre');
    expect(expandedPre?.className ?? '').toContain('text-[10px]');
  });
});
