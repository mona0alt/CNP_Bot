import { describe, expect, it } from 'vitest';

import {
  createJumpServerStreamAggregator,
  type StreamToolEvent,
} from './jumpserver-stream-aggregator.js';

describe('JumpServerStreamAggregator', () => {
  it('creates a jumpserver_session block when connect.sh starts', () => {
    const aggregator = createJumpServerStreamAggregator();
    const event: StreamToolEvent = {
      type: 'tool_use',
      name: 'Bash',
      toolUseId: 'tool-connect-1',
      input: {
        command: 'bash /home/node/.claude/skills/jumpserver/scripts/connect.sh',
      },
    };

    const result = aggregator.consume(event);

    expect(result.hiddenOriginalEvent).toBe(true);
    expect(result.block?.type).toBe('jumpserver_session');
    expect(result.block?.stage).toBe('connecting_jumpserver');
    expect(result.block?.status).toBe('calling');
  });

  it('moves to jumpserver_ready when connect.sh returns the menu prompt', () => {
    const aggregator = createJumpServerStreamAggregator();

    aggregator.consume({
      type: 'tool_use',
      name: 'Bash',
      toolUseId: 'tool-connect-1',
      input: {
        command: 'bash /home/node/.claude/skills/jumpserver/scripts/connect.sh',
      },
    });

    const result = aggregator.consume({
      type: 'tool_result',
      toolUseId: 'tool-connect-1',
      content:
        "sshpass -p '***' ssh -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=60 ops@jumpserver.example.internal -p2222\nOpt> 输入目标主机",
      isError: false,
    });

    expect(result.hiddenOriginalEvent).toBe(true);
    expect(result.block?.stage).toBe('jumpserver_ready');
    expect(result.block?.jumpserver_host).toBe('jumpserver.example.internal');
    expect(result.block?.latest_output).toContain('Opt> 输入目标主机');
  });

  it('records target_host when send-keys sends an IP to jumpserver pane', () => {
    const aggregator = createJumpServerStreamAggregator();
    aggregator.consume({
      type: 'tool_use',
      name: 'Bash',
      toolUseId: 'tool-connect-1',
      input: { command: 'bash /home/node/.claude/skills/jumpserver/scripts/connect.sh' },
    });
    aggregator.consume({
      type: 'tool_result',
      toolUseId: 'tool-connect-1',
      content: 'Opt> 输入目标主机',
      isError: false,
    });

    const result = aggregator.consume({
      type: 'tool_use',
      name: 'Bash',
      toolUseId: 'tool-send-ip',
      input: {
        command: 'tmux -S /tmp/socket send-keys -t jumpserver:0.0 -- "10.246.104.234" Enter',
      },
    });

    expect(result.hiddenOriginalEvent).toBe(true);
    expect(result.block?.target_host).toBe('10.246.104.234');
    expect(result.block?.stage).toBe('sending_target');
  });

  it('records target_host when send-keys uses jumpserver target without double-dash', () => {
    const aggregator = createJumpServerStreamAggregator();
    aggregator.consume({
      type: 'tool_use',
      name: 'Bash',
      toolUseId: 'tool-connect-1',
      input: { command: 'bash /home/node/.claude/skills/jumpserver/scripts/connect.sh' },
    });
    aggregator.consume({
      type: 'tool_result',
      toolUseId: 'tool-connect-1',
      content: 'Opt> 输入目标主机',
      isError: false,
    });

    const result = aggregator.consume({
      type: 'tool_use',
      name: 'Bash',
      toolUseId: 'tool-send-ip-plain',
      input: {
        command: 'tmux -S /tmp/cnpbot-tmux-sockets/cnpbot.sock send-keys -t jumpserver "10.246.104.234" Enter',
      },
    });

    expect(result.hiddenOriginalEvent).toBe(true);
    expect(result.block?.target_host).toBe('10.246.104.234');
    expect(result.block?.stage).toBe('sending_target');
  });

  it('moves to target_connected when capture-pane shows a remote prompt', () => {
    const aggregator = createJumpServerStreamAggregator();
    aggregator.seed({
      type: 'jumpserver_session',
      id: 'jump-1',
      stage: 'sending_target',
      status: 'calling',
      target_host: '10.246.104.234',
      executions: [],
    });

    aggregator.consume({
      type: 'tool_use',
      name: 'Bash',
      toolUseId: 'tool-capture-connected',
      input: {
        command: 'tmux -S /tmp/socket capture-pane -p -J -t jumpserver:0.0 -S -200',
      },
    });

    const result = aggregator.consume({
      type: 'tool_result',
      toolUseId: 'tool-capture-connected',
      content: 'Welcome\n[user@host ~]$',
      isError: false,
    });

    expect(result.hiddenOriginalEvent).toBe(true);
    expect(result.block?.stage).toBe('target_connected');
    expect(result.block?.latest_output).toContain('[user@host ~]$');
  });

  it('appends a running execution when a real remote command is sent', () => {
    const aggregator = createJumpServerStreamAggregator();
    aggregator.seed({
      type: 'jumpserver_session',
      id: 'jump-1',
      stage: 'target_connected',
      status: 'calling',
      target_host: '10.246.104.234',
      executions: [],
    });

    const result = aggregator.consume({
      type: 'tool_use',
      name: 'Bash',
      toolUseId: 'tool-journalctl',
      input: {
        command: 'tmux -S /tmp/socket send-keys -t jumpserver:0.0 -- "journalctl -n 50" Enter',
      },
    });

    expect(result.hiddenOriginalEvent).toBe(true);
    expect(result.block?.stage).toBe('running_remote_command');
    expect(result.block?.executions).toHaveLength(1);
    expect(result.block?.executions?.[0]).toMatchObject({
      command: 'journalctl -n 50',
      status: 'running',
    });
  });

  it('still records a remote command when target_host is known but prompt recovery was skipped', () => {
    const aggregator = createJumpServerStreamAggregator();
    aggregator.seed({
      type: 'jumpserver_session',
      id: 'jump-1',
      stage: 'target_connecting',
      status: 'calling',
      target_host: '10.246.104.234',
      executions: [],
    });

    const result = aggregator.consume({
      type: 'tool_use',
      name: 'Bash',
      toolUseId: 'tool-dmesg',
      input: {
        command: 'tmux -S /tmp/socket send-keys -t jumpserver:0.0 -- "dmesg | tail -n 20" Enter',
      },
    });

    expect(result.hiddenOriginalEvent).toBe(true);
    expect(result.block?.stage).toBe('running_remote_command');
    expect(result.block?.executions).toHaveLength(1);
    expect(result.block?.executions?.[0]).toMatchObject({
      command: 'dmesg | tail -n 20',
      status: 'running',
    });
  });

  it('records a remote command when send-keys uses quoted payload without double-dash', () => {
    const aggregator = createJumpServerStreamAggregator();
    aggregator.seed({
      type: 'jumpserver_session',
      id: 'jump-1',
      stage: 'target_connected',
      status: 'calling',
      target_host: '10.246.104.234',
      executions: [],
    });

    const result = aggregator.consume({
      type: 'tool_use',
      name: 'Bash',
      toolUseId: 'tool-journalctl-plain',
      input: {
        command: 'tmux -S /tmp/cnpbot-tmux-sockets/cnpbot.sock send-keys -t jumpserver "journalctl -n 50" C-m',
      },
    });

    expect(result.hiddenOriginalEvent).toBe(true);
    expect(result.block?.stage).toBe('running_remote_command');
    expect(result.block?.executions?.[0]).toMatchObject({
      command: 'journalctl -n 50',
      status: 'running',
    });
  });

  it('updates latest_output and current execution output from capture-pane', () => {
    const aggregator = createJumpServerStreamAggregator();
    aggregator.seed({
      type: 'jumpserver_session',
      id: 'jump-1',
      stage: 'running_remote_command',
      status: 'calling',
      target_host: '10.246.104.234',
      executions: [{ id: 'exec-1', command: 'journalctl -n 50', status: 'running' }],
    });

    const result = aggregator.consume({
      type: 'tool_use',
      name: 'Bash',
      toolUseId: 'tool-capture-1',
      input: {
        command: 'tmux -S /tmp/socket capture-pane -p -J -t jumpserver:0.0 -S -200',
      },
    });

    const afterResult = aggregator.consume({
      type: 'tool_result',
      toolUseId: 'tool-capture-1',
      content: 'Mar 19 kernel: test\n[user@host ~]$',
      isError: false,
    });

    expect(result.hiddenOriginalEvent).toBe(true);
    expect(afterResult.block?.latest_output).toContain('kernel: test');
    expect(afterResult.block?.executions?.[0]?.output).toContain('kernel: test');
    expect(afterResult.block?.executions?.[0]?.status).toBe('completed');
    expect(afterResult.block?.stage).toBe('target_connected');
  });

  it('marks the session and current execution as cancelled', () => {
    const aggregator = createJumpServerStreamAggregator();
    aggregator.seed({
      type: 'jumpserver_session',
      id: 'jump-1',
      stage: 'running_remote_command',
      status: 'calling',
      executions: [{ id: 'exec-1', command: 'journalctl -n 50', status: 'running' }],
    });

    const result = aggregator.cancel();

    expect(result?.stage).toBe('cancelled');
    expect(result?.status).toBe('cancelled');
    expect(result?.executions?.[0]?.status).toBe('cancelled');
  });
});
