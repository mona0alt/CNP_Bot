import { describe, expect, it } from 'vitest';

import { adaptDeepAgentToolEvent } from './deepagent-stream-event-adapter.js';
import { createJumpServerStreamAggregator } from './jumpserver-stream-aggregator.js';

describe('adaptDeepAgentToolEvent', () => {
  it('将 deepagent 的 Bash content_block_start 转成可被 JumpServer 聚合器识别的 tool_use', () => {
    const aggregator = createJumpServerStreamAggregator();

    const toolEvent = adaptDeepAgentToolEvent({
      type: 'content_block_start',
      index: 2,
      content_block: {
        type: 'tool_use',
        id: 'deep-tool-1',
        name: 'Bash',
        input: {
          command:
            'bash /home/node/.claude/skills/jumpserver/scripts/run-remote-command.sh "journalctl --no-pager -n 150" 60 10.245.17.1',
        },
      },
    });

    expect(toolEvent).toEqual({
      type: 'tool_use',
      name: 'Bash',
      toolUseId: 'deep-tool-1',
      input: {
        command:
          'bash /home/node/.claude/skills/jumpserver/scripts/run-remote-command.sh "journalctl --no-pager -n 150" 60 10.245.17.1',
      },
    });

    const result = aggregator.consume(toolEvent!);
    expect(result.hiddenOriginalEvent).toBe(true);
    expect(result.block?.type).toBe('jumpserver_session');
    expect(result.block?.stage).toBe('running_remote_command');
    expect(result.block?.target_host).toBe('10.245.17.1');
    expect(result.block?.executions?.[0]?.command).toBe('journalctl --no-pager -n 150');
  });

  it('将 deepagent 的 tool_result 转成聚合器可消费的 tool_result', () => {
    const toolEvent = adaptDeepAgentToolEvent({
      type: 'tool_result',
      tool_use_id: 'deep-tool-1',
      content: 'log line 1\nlog line 2',
      is_error: false,
    });

    expect(toolEvent).toEqual({
      type: 'tool_result',
      toolUseId: 'deep-tool-1',
      content: 'log line 1\nlog line 2',
      isError: false,
    });
  });
});
