import { describe, expect, it } from 'vitest';

import {
  createJumpServerStreamAggregator,
  extractConnectAndEnterTargetIp,
  extractRunRemoteCommand,
  extractRunRemoteTargetIp,
  isConnectAndEnterTargetCommand,
  isRunRemoteCommandCall,
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
    expect(result.block?.id).toBe('jumpserver-session-1');
    expect(result.block?.stage).toBe('connecting_jumpserver');
    expect(result.block?.status).toBe('calling');
  });

  it('starts a fresh jumpserver card when connect.sh is called again', () => {
    const aggregator = createJumpServerStreamAggregator();

    aggregator.seed({
      type: 'jumpserver_session',
      id: 'jumpserver-session-9',
      stage: 'target_connected',
      status: 'calling',
      target_host: '10.246.104.45',
      latest_output: 'old output',
      executions: [{ id: 'jumpserver-exec-1', command: 'uname -a', status: 'completed' }],
    });

    const result = aggregator.consume({
      type: 'tool_use',
      name: 'Bash',
      toolUseId: 'tool-connect-2',
      input: {
        command: 'bash /home/node/.claude/skills/jumpserver/scripts/connect.sh',
      },
    });

    expect(result.hiddenOriginalEvent).toBe(true);
    expect(result.block?.id).not.toBe('jumpserver-session-9');
    expect(result.block?.stage).toBe('connecting_jumpserver');
    expect(result.block?.target_host).toBeUndefined();
    expect(result.block?.latest_output).toBeUndefined();
    expect(result.block?.executions).toEqual([]);
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

  it('does not overwrite an ip target_host with q from pager quit', () => {
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
      toolUseId: 'tool-send-q',
      input: {
        command: 'tmux -S /tmp/cnpbot-tmux-sockets/cnpbot.sock send-keys -t jumpserver "q" C-m',
      },
    });

    expect(result.hiddenOriginalEvent).toBe(true);
    expect(result.block?.target_host).toBe('10.246.104.234');
    expect(result.block?.executions ?? []).toHaveLength(0);
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

  it('completes previous running execution before appending the next remote command', () => {
    const aggregator = createJumpServerStreamAggregator();
    aggregator.seed({
      type: 'jumpserver_session',
      id: 'jump-1',
      stage: 'running_remote_command',
      status: 'calling',
      target_host: '10.246.104.234',
      executions: [
        {
          id: 'exec-1',
          command: 'journalctl -n 50',
          status: 'running',
        },
      ],
    });

    const result = aggregator.consume({
      type: 'tool_use',
      name: 'Bash',
      toolUseId: 'tool-next-command',
      input: {
        command: 'tmux -S /tmp/cnpbot-tmux-sockets/cnpbot.sock send-keys -t jumpserver "dmesg | tail -n 20" C-m',
      },
    });

    expect(result.hiddenOriginalEvent).toBe(true);
    expect(result.block?.executions).toHaveLength(2);
    expect(result.block?.executions?.[0]?.status).toBe('completed');
    expect(result.block?.executions?.[1]).toMatchObject({
      command: 'dmesg | tail -n 20',
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

  // ── connect-and-enter-target.sh tests ──

  it('detects connect-and-enter-target.sh command', () => {
    expect(isConnectAndEnterTargetCommand(
      'bash /home/node/.claude/skills/jumpserver/scripts/connect-and-enter-target.sh 10.246.104.45',
    )).toBe(true);
    expect(isConnectAndEnterTargetCommand(
      '/home/node/.claude/skills/jumpserver/scripts/connect-and-enter-target.sh 10.1.2.3',
    )).toBe(true);
    expect(isConnectAndEnterTargetCommand('connect.sh')).toBe(false);
  });

  it('extracts target IP from connect-and-enter-target.sh', () => {
    expect(extractConnectAndEnterTargetIp(
      'bash /path/connect-and-enter-target.sh 10.246.104.45',
    )).toBe('10.246.104.45');
    expect(extractConnectAndEnterTargetIp(
      'bash /path/connect-and-enter-target.sh "10.246.104.45"',
    )).toBe('10.246.104.45');
  });

  it('creates block with target_host when connect-and-enter-target.sh is called', () => {
    const aggregator = createJumpServerStreamAggregator();
    const result = aggregator.consume({
      type: 'tool_use',
      name: 'Bash',
      toolUseId: 'tool-cet-1',
      input: {
        command: 'bash /home/node/.claude/skills/jumpserver/scripts/connect-and-enter-target.sh 10.246.104.45',
      },
    });

    expect(result.hiddenOriginalEvent).toBe(true);
    expect(result.block?.id).toBe('jumpserver-session-1');
    expect(result.block?.stage).toBe('connecting_jumpserver');
    expect(result.block?.target_host).toBe('10.246.104.45');
  });

  it('creates a new jumpserver card when switching to another target host', () => {
    const aggregator = createJumpServerStreamAggregator();
    aggregator.seed({
      type: 'jumpserver_session',
      id: 'jumpserver-session-4',
      stage: 'target_connected',
      status: 'calling',
      target_host: '10.246.104.45',
      latest_output: 'old host output',
      executions: [
        {
          id: 'jumpserver-exec-1',
          command: 'journalctl --no-pager -n 50',
          status: 'completed',
          output: 'old host log',
        },
      ],
    });

    const result = aggregator.consume({
      type: 'tool_use',
      name: 'Bash',
      toolUseId: 'tool-cet-2',
      input: {
        command: 'bash /home/node/.claude/skills/jumpserver/scripts/connect-and-enter-target.sh 10.245.17.1',
      },
    });

    expect(result.hiddenOriginalEvent).toBe(true);
    expect(result.block?.id).not.toBe('jumpserver-session-4');
    expect(result.block?.stage).toBe('connecting_jumpserver');
    expect(result.block?.target_host).toBe('10.245.17.1');
    expect(result.block?.latest_output).toBeUndefined();
    expect(result.block?.executions).toEqual([]);
  });

  it('moves to target_connected when connect-and-enter-target.sh returns with prompt', () => {
    const aggregator = createJumpServerStreamAggregator();
    aggregator.consume({
      type: 'tool_use',
      name: 'Bash',
      toolUseId: 'tool-cet-1',
      input: {
        command: 'bash /home/node/.claude/skills/jumpserver/scripts/connect-and-enter-target.sh 10.246.104.45',
      },
    });

    const result = aggregator.consume({
      type: 'tool_result',
      toolUseId: 'tool-cet-1',
      content: 'Last login: Mon Mar 20\n[root@myhost ~]#',
      isError: false,
    });

    expect(result.block?.stage).toBe('target_connected');
    expect(result.block?.latest_output).toContain('[root@myhost ~]#');
  });

  // ── run-remote-command.sh tests ──

  it('detects run-remote-command.sh command', () => {
    expect(isRunRemoteCommandCall(
      'bash /home/node/.claude/skills/jumpserver/scripts/run-remote-command.sh "uname -a"',
    )).toBe(true);
    expect(isRunRemoteCommandCall('run-remote-command.sh')).toBe(false);
  });

  it('extracts remote command from run-remote-command.sh', () => {
    expect(extractRunRemoteCommand(
      'bash /path/run-remote-command.sh "journalctl --no-pager -n 50"',
    )).toBe('journalctl --no-pager -n 50');
    expect(extractRunRemoteCommand(
      "bash /path/run-remote-command.sh 'df -h'",
    )).toBe('df -h');
    expect(extractRunRemoteCommand(
      'bash /path/run-remote-command.sh export\\ SYSTEMD_PAGER=cat\\ PAGER=cat\\ \\&\\&\\ journalctl\\ --no-pager\\ -n\\ 100 300',
    )).toBe('export SYSTEMD_PAGER=cat PAGER=cat && journalctl --no-pager -n 100');
  });

  it('extracts target ip from run-remote-command.sh', () => {
    expect(extractRunRemoteTargetIp(
      'bash /path/run-remote-command.sh "journalctl --no-pager -n 50" 60 10.246.104.45',
    )).toBe('10.246.104.45');
    expect(extractRunRemoteTargetIp(
      'bash /path/run-remote-command.sh export\\ SYSTEMD_PAGER=cat\\ PAGER=cat\\ \\&\\&\\ journalctl\\ --no-pager\\ -n\\ 100 300 10.245.16.39',
    )).toBe('10.245.16.39');
  });

  it('creates execution entry when run-remote-command.sh is called', () => {
    const aggregator = createJumpServerStreamAggregator();
    aggregator.seed({
      type: 'jumpserver_session',
      id: 'jump-1',
      stage: 'target_connected',
      status: 'calling',
      target_host: '10.246.104.45',
      executions: [],
    });

    const result = aggregator.consume({
      type: 'tool_use',
      name: 'Bash',
      toolUseId: 'tool-rrc-1',
      input: {
        command: 'bash /home/node/.claude/skills/jumpserver/scripts/run-remote-command.sh "uname -a"',
      },
    });

    expect(result.hiddenOriginalEvent).toBe(true);
    expect(result.block?.stage).toBe('running_remote_command');
    expect(result.block?.executions).toHaveLength(1);
    expect(result.block?.executions?.[0]).toMatchObject({
      command: 'uname -a',
      status: 'running',
    });
  });

  it('creates execution entry when run-remote-command.sh uses escaped spaces', () => {
    const aggregator = createJumpServerStreamAggregator();
    aggregator.seed({
      type: 'jumpserver_session',
      id: 'jump-1',
      stage: 'target_connected',
      status: 'calling',
      target_host: '10.246.104.45',
      executions: [],
    });

    const result = aggregator.consume({
      type: 'tool_use',
      name: 'Bash',
      toolUseId: 'tool-rrc-escaped',
      input: {
        command:
          'bash /home/node/.claude/skills/jumpserver/scripts/run-remote-command.sh export\\ SYSTEMD_PAGER=cat\\ PAGER=cat\\ \\&\\&\\ journalctl\\ --no-pager\\ -n\\ 100 300',
      },
    });

    expect(result.hiddenOriginalEvent).toBe(true);
    expect(result.block?.stage).toBe('running_remote_command');
    expect(result.block?.executions).toHaveLength(1);
    expect(result.block?.executions?.[0]).toMatchObject({
      command: 'export SYSTEMD_PAGER=cat PAGER=cat && journalctl --no-pager -n 100',
      status: 'running',
    });
  });

  it('completes execution and returns to target_connected when run-remote-command.sh finishes', () => {
    const aggregator = createJumpServerStreamAggregator();
    aggregator.seed({
      type: 'jumpserver_session',
      id: 'jump-1',
      stage: 'target_connected',
      status: 'calling',
      target_host: '10.246.104.45',
      executions: [],
    });

    aggregator.consume({
      type: 'tool_use',
      name: 'Bash',
      toolUseId: 'tool-rrc-1',
      input: {
        command: 'bash /home/node/.claude/skills/jumpserver/scripts/run-remote-command.sh "uname -a"',
      },
    });

    const result = aggregator.consume({
      type: 'tool_result',
      toolUseId: 'tool-rrc-1',
      content: 'Linux myhost 5.15.0 #1 SMP x86_64 GNU/Linux\n[root@myhost ~]#',
      isError: false,
    });

    expect(result.block?.stage).toBe('target_connected');
    expect(result.block?.executions).toHaveLength(1);
    expect(result.block?.executions?.[0]?.status).toBe('completed');
    expect(result.block?.executions?.[0]?.output).toContain('Linux myhost');
  });

  it('completes previous execution when a new run-remote-command.sh is called', () => {
    const aggregator = createJumpServerStreamAggregator();
    aggregator.seed({
      type: 'jumpserver_session',
      id: 'jump-1',
      stage: 'running_remote_command',
      status: 'calling',
      target_host: '10.246.104.45',
      executions: [{ id: 'exec-1', command: 'uname -a', status: 'running' }],
    });

    const result = aggregator.consume({
      type: 'tool_use',
      name: 'Bash',
      toolUseId: 'tool-rrc-2',
      input: {
        command: 'bash /home/node/.claude/skills/jumpserver/scripts/run-remote-command.sh "df -h"',
      },
    });

    expect(result.block?.executions).toHaveLength(2);
    expect(result.block?.executions?.[0]?.status).toBe('completed');
    expect(result.block?.executions?.[1]).toMatchObject({
      command: 'df -h',
      status: 'running',
    });
  });

  it('starts a fresh round after reset so previous executions do not leak', () => {
    const aggregator = createJumpServerStreamAggregator();
    aggregator.seed({
      type: 'jumpserver_session',
      id: 'jump-1',
      stage: 'completed',
      status: 'executed',
      target_host: '10.246.104.45',
      executions: [
        { id: 'jumpserver-exec-1', command: 'uname -a', status: 'completed' },
        { id: 'jumpserver-exec-2', command: 'df -h', status: 'completed' },
      ],
    });

    aggregator.reset();

    const result = aggregator.consume({
      type: 'tool_use',
      name: 'Bash',
      toolUseId: 'tool-rrc-next-round',
      input: {
        command:
          'bash /home/node/.claude/skills/jumpserver/scripts/run-remote-command.sh "hostname -I" 60 10.245.16.39',
      },
    });

    expect(result.hiddenOriginalEvent).toBe(true);
    expect(result.block?.id).not.toBe('jump-1');
    expect(result.block?.target_host).toBe('10.245.16.39');
    expect(result.block?.executions).toEqual([
      expect.objectContaining({
        id: 'jumpserver-exec-1',
        command: 'hostname -I',
        status: 'running',
      }),
    ]);
  });

  it('recreates a jumpserver card after reset when a new round resumes with direct tmux commands', () => {
    const aggregator = createJumpServerStreamAggregator();
    aggregator.seed({
      type: 'jumpserver_session',
      id: 'jump-1',
      stage: 'completed',
      status: 'executed',
      target_host: '10.255.37.227',
      executions: [
        { id: 'jumpserver-exec-1', command: 'iostat -dxm 1', status: 'completed' },
      ],
    });

    aggregator.reset();

    const toolUseResult = aggregator.consume({
      type: 'tool_use',
      name: 'Bash',
      toolUseId: 'tool-direct-tmux-1',
      input: {
        command:
          'tmux -S /tmp/cnpbot-tmux-sockets/cnpbot.sock send-keys -t jumpserver:0.0 "ss -tnp | grep \':2379\' | wc -l" Enter',
      },
    });

    expect(toolUseResult.hiddenOriginalEvent).toBe(true);
    expect(toolUseResult.block?.type).toBe('jumpserver_session');
    expect(toolUseResult.block?.id).not.toBe('jump-1');
    expect(toolUseResult.block?.stage).toBe('running_remote_command');
    expect(toolUseResult.block?.executions).toEqual([
      expect.objectContaining({
        id: 'jumpserver-exec-1',
        command: "ss -tnp | grep ':2379' | wc -l",
        status: 'running',
      }),
    ]);

    aggregator.consume({
      type: 'tool_use',
      name: 'Bash',
      toolUseId: 'tool-direct-tmux-capture-1',
      input: {
        command:
          'tmux -S /tmp/cnpbot-tmux-sockets/cnpbot.sock capture-pane -p -J -t jumpserver:0.0 -S -200',
      },
    });

    const captureResult = aggregator.consume({
      type: 'tool_result',
      toolUseId: 'tool-direct-tmux-capture-1',
      content: '693\n[root@bd-cnp-uat01-37-227 ~]#',
      isError: false,
    });

    expect(captureResult.hiddenOriginalEvent).toBe(true);
    expect(captureResult.block?.stage).toBe('target_connected');
    expect(captureResult.block?.executions?.[0]).toMatchObject({
      command: "ss -tnp | grep ':2379' | wc -l",
      status: 'completed',
      output: '693\n[root@bd-cnp-uat01-37-227 ~]#',
    });
  });

  it('reuses the same jumpserver card id when a direct tmux round later falls back to connect.sh', () => {
    const aggregator = createJumpServerStreamAggregator();

    const directTmuxResult = aggregator.consume({
      type: 'tool_use',
      name: 'Bash',
      toolUseId: 'tool-direct-tmux-before-connect',
      input: {
        command:
          'tmux -S /tmp/cnpbot-tmux-sockets/cnpbot.sock capture-pane -p -J -t jumpserver:0.0 -S -200',
      },
    });

    expect(directTmuxResult.hiddenOriginalEvent).toBe(true);
    expect(directTmuxResult.block?.type).toBe('jumpserver_session');

    const firstBlockId = directTmuxResult.block?.id;
    expect(firstBlockId).toBeTruthy();

    aggregator.consume({
      type: 'tool_result',
      toolUseId: 'tool-direct-tmux-before-connect',
      content: 'Opt> 请输入资产 IP',
      isError: false,
    });

    const connectResult = aggregator.consume({
      type: 'tool_use',
      name: 'Bash',
      toolUseId: 'tool-connect-after-direct-tmux',
      input: {
        command:
          'bash /home/node/.claude/skills/jumpserver/scripts/connect.sh',
      },
    });

    expect(connectResult.hiddenOriginalEvent).toBe(true);
    expect(connectResult.block?.id).toBe(firstBlockId);
    expect(connectResult.block?.stage).toBe('connecting_jumpserver');
    expect(connectResult.block?.executions).toEqual([]);
  });
});
