// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { JumpServerSessionCard } from './JumpServerSessionCard';
import { ThemeProvider } from '@/contexts/ThemeContext';

describe('JumpServerSessionCard', () => {
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

  it('renders stage summary, target host and nested bash cards', async () => {
    await act(async () => {
      root.render(
        <ThemeProvider>
          <JumpServerSessionCard
            block={{
              type: 'jumpserver_session',
              id: 'jump-1',
              stage: 'target_connected',
              jumpserver_host: 'jumpserver.example.internal',
              target_host: '10.246.104.234',
              latest_output: 'Mar 19 kernel: test',
              executions: [
                {
                  id: 'exec-1',
                  command: 'journalctl -n 50',
                  status: 'completed',
                  output: 'Mar 19 kernel: test',
                },
              ],
            }}
          />
        </ThemeProvider>,
      );
    });

    const text = container.textContent ?? '';
    expect(text).toContain('JumpServer 远程会话');
    expect(text).toContain('已连接目标主机');
    expect(text).toContain('10.246.104.234');
    expect(text).toContain('journalctl -n 50');
    expect(text).toContain('Bash');
    expect(text).toContain('Result');
    expect(text).not.toContain('最近输出');
  });

  it('adapts jumpserver card styling in light mode', async () => {
    window.localStorage.setItem('theme', 'light');

    await act(async () => {
      root.render(
        <ThemeProvider>
          <JumpServerSessionCard
            block={{
              type: 'jumpserver_session',
              id: 'jump-1',
              stage: 'running_remote_command',
              jumpserver_host: 'jumpserver.example.internal',
              target_host: '10.246.104.234',
              executions: [
                {
                  id: 'exec-1',
                  command: 'journalctl -n 50',
                  status: 'running',
                },
              ],
            }}
          />
        </ThemeProvider>,
      );
    });

    const section = container.querySelector('section');
    expect(section?.className).toContain('bg-sky-50');
    expect(section?.className).toContain('text-slate-900');
    expect(container.textContent ?? '').toContain('Bash');
  });
});
