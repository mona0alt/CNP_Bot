import { describe, it, expect, vi } from 'vitest';
import { processChartMessageIpc } from './ipc.js';
import type { IpcDeps } from './ipc.js';
import { RegisteredGroup } from './types.js';

const MAIN_GROUP: RegisteredGroup = {
  name: 'Main', folder: 'main', trigger: 'always',
  added_at: '2024-01-01T00:00:00.000Z',
};
const OTHER_GROUP: RegisteredGroup = {
  name: 'Other', folder: 'other-group', trigger: '@Bot',
  added_at: '2024-01-01T00:00:00.000Z',
};

const CHART_BLOCK = {
  type: 'prometheus_chart',
  title: 'CPU 使用率',
  unit: '%',
  timeRange: '1h',
  datasource: 'portal',
  series: [{ instance: '10.0.0.1', data: [[1710000000, 67.3]] }],
};

function makeDeps(groups: Record<string, RegisteredGroup>): IpcDeps & { sent: string[] } {
  const sent: string[] = [];
  return {
    sent,
    sendMessage: vi.fn(async (_jid: string, text: string) => { sent.push(text); }),
    registeredGroups: () => groups,
    registerGroup: vi.fn(),
    syncGroupMetadata: vi.fn(),
    getAvailableGroups: vi.fn(() => []),
    writeGroupsSnapshot: vi.fn(),
  };
}

describe('processChartMessageIpc', () => {
  it('sends chart message when authorized (main group)', async () => {
    const deps = makeDeps({ 'other@g.us': OTHER_GROUP });
    await processChartMessageIpc(
      { type: 'chart_message', chatJid: 'other@g.us', chart: CHART_BLOCK },
      'main', true, deps,
    );
    expect(deps.sendMessage).toHaveBeenCalledOnce();
    const sent = JSON.parse(vi.mocked(deps.sendMessage).mock.calls[0][1]);
    expect(sent).toEqual([CHART_BLOCK]);
  });

  it('sends chart message when group owns the chatJid', async () => {
    const deps = makeDeps({ 'other@g.us': OTHER_GROUP });
    await processChartMessageIpc(
      { type: 'chart_message', chatJid: 'other@g.us', chart: CHART_BLOCK },
      'other-group', false, deps,
    );
    expect(deps.sendMessage).toHaveBeenCalledOnce();
  });

  it('blocks unauthorized cross-group chart message', async () => {
    const deps = makeDeps({ 'other@g.us': OTHER_GROUP });
    await processChartMessageIpc(
      { type: 'chart_message', chatJid: 'other@g.us', chart: CHART_BLOCK },
      'evil-group', false, deps,
    );
    expect(deps.sendMessage).not.toHaveBeenCalled();
  });

  it('does nothing when chart field is missing', async () => {
    const deps = makeDeps({ 'other@g.us': OTHER_GROUP });
    await processChartMessageIpc(
      { type: 'chart_message', chatJid: 'other@g.us', chart: undefined as any },
      'main', true, deps,
    );
    expect(deps.sendMessage).not.toHaveBeenCalled();
  });

  it('does nothing when chatJid field is missing', async () => {
    const deps = makeDeps({ 'other@g.us': OTHER_GROUP });
    await processChartMessageIpc(
      { type: 'chart_message', chatJid: undefined, chart: CHART_BLOCK },
      'main', true, deps,
    );
    expect(deps.sendMessage).not.toHaveBeenCalled();
  });
});
