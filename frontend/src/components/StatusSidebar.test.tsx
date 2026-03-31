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
            status={sampleStatus}
            open={false}
            onClose={vi.fn()}
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
            status={sampleStatus}
            open={true}
            onClose={onClose}
          />
        </div>,
      );
    });

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the close button right-aligned even when status is null', async () => {
    await act(async () => {
      root.render(
        <div className="relative h-96">
          <StatusSidebar
            status={null}
            open={true}
            onClose={vi.fn()}
          />
        </div>,
      );
    });

    const closeButton = container.querySelector('button[aria-label="关闭状态面板"]');
    expect(closeButton?.className).toContain('ml-auto');
  });

  it('does not put auto-margin on the status badge when status exists', async () => {
    await act(async () => {
      root.render(
        <div className="relative h-96">
          <StatusSidebar
            status={sampleStatus}
            open={true}
            onClose={vi.fn()}
          />
        </div>,
      );
    });

    const statusBadge = container.querySelector('.text-xs.rounded-full');
    expect(statusBadge?.className).not.toContain('ml-auto');
  });
});
