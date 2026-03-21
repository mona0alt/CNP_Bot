// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfirmBashCard } from './ConfirmBashCard';

describe('ConfirmBashCard', () => {
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

  it('显示目标主机', async () => {
    await act(async () => {
      root.render(
        <ConfirmBashCard
          request={{
            requestId: 'req-1',
            command: 'rm -rf /tmp/cnp-danger-test',
            reason: '递归强制删除文件',
            targetHost: '10.1.2.3',
          }}
          onRespond={() => {}}
        />,
      );
    });

    const text = container.textContent ?? '';
    expect(text).toContain('目标主机');
    expect(text).toContain('10.1.2.3');
  });

  it('目标主机缺失时显示兜底文案', async () => {
    await act(async () => {
      root.render(
        <ConfirmBashCard
          request={{
            requestId: 'req-2',
            command: 'git reset --hard',
            reason: '强制重置 Git 历史（可能丢失本地提交）',
          }}
          onRespond={() => {}}
        />,
      );
    });

    expect(container.textContent ?? '').toContain('未知目标主机');
  });
});
