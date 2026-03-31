// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StatusSidebar } from './StatusSidebar';

const sampleStatus = {
  workingDirectory: '/tmp/project',
  model: 'claude-sonnet-4',
  usage: {
    input_tokens: 1200,
    output_tokens: 300,
    model_usage: {
      'claude-sonnet-4': {
        cacheReadInputTokens: 100,
        cacheCreationInputTokens: 50,
        contextWindow: 200000,
        costUSD: 0.0012,
      },
    },
    cost_usd: 0.0012,
  },
  processReady: true,
  isActive: false,
};

describe('StatusSidebar drawer', () => {
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

  it('renders a hidden overlay drawer shell when closed', async () => {
    await act(async () => {
      root.render(
        <div className="relative h-96">
          <StatusSidebar
            {...({
              status: sampleStatus,
              open: false,
              onClose: vi.fn(),
            } as never)}
          />
        </div>,
      );
    });

    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.className).toContain('translate-x-full');

    const backdrop = dialog?.previousElementSibling as HTMLDivElement | null;
    expect(backdrop?.className).toContain('pointer-events-none');
  });

  it('closes on Escape when open', async () => {
    const onClose = vi.fn();

    await act(async () => {
      root.render(
        <div className="relative h-96">
          <StatusSidebar
            {...({
              status: sampleStatus,
              open: true,
              onClose,
            } as never)}
          />
        </div>,
      );
    });

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
