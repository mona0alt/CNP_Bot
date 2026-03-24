import { describe, expect, it, vi } from 'vitest';

import {
  isJumpServerDebugEnabled,
  logJumpServerExecutionSummary,
  logJumpServerStageDebug,
  logJumpServerToolDone,
  logJumpServerToolStart,
} from './jumpserver-diagnostic-logging.js';

describe('jumpserver diagnostic logging', () => {
  it('JUMPSERVER_DEBUG 未开启时不输出 node 诊断日志', () => {
    const logger = { debug: vi.fn() };

    logJumpServerToolStart(
      logger,
      { command: 'uname -a' },
      { JUMPSERVER_DEBUG: '0' },
    );

    expect(logger.debug).not.toHaveBeenCalled();
  });

  it('JUMPSERVER_DEBUG=1 时输出 tool start 和 done', () => {
    const logger = { debug: vi.fn() };

    logJumpServerToolStart(
      logger,
      { command: 'uname -a', targetHost: '10.245.17.1' },
      { JUMPSERVER_DEBUG: '1' },
    );
    logJumpServerToolDone(
      logger,
      { command: 'uname -a', elapsedMs: 1234, result: 'success' },
      { JUMPSERVER_DEBUG: '1' },
    );

    expect(logger.debug).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        phase: 'jumpserver_tool_start',
        command: 'uname -a',
        targetHost: '10.245.17.1',
      }),
      'JumpServer diagnostic',
    );
    expect(logger.debug).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        phase: 'jumpserver_tool_done',
        elapsedMs: 1234,
        result: 'success',
      }),
      'JumpServer diagnostic',
    );
  });

  it('完成 execution 时输出汇总耗时', () => {
    const logger = { debug: vi.fn() };

    logJumpServerExecutionSummary(
      logger,
      {
        executionId: 'jumpserver-exec-1',
        command: 'journalctl --no-pager -n 100',
        targetHost: '10.245.17.1',
        executionDurationMs: 189641,
        toolElapsedMs: 190200,
        status: 'completed',
      },
      { JUMPSERVER_DEBUG: '1' },
    );

    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: 'jumpserver_execution_summary',
        executionId: 'jumpserver-exec-1',
        executionDurationMs: 189641,
        toolElapsedMs: 190200,
      }),
      'JumpServer diagnostic',
    );
  });

  it('stage debug 使用统一 phase', () => {
    const logger = { debug: vi.fn() };

    logJumpServerStageDebug(
      logger,
      { previousStage: 'running_remote_command', stage: 'target_connected' },
      { JUMPSERVER_DEBUG: '1' },
    );

    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: 'jumpserver_stage',
        previousStage: 'running_remote_command',
        stage: 'target_connected',
      }),
      'JumpServer diagnostic',
    );
  });

  it('只在值为 1 时开启 jumpserver debug', () => {
    expect(isJumpServerDebugEnabled({ JUMPSERVER_DEBUG: '1' })).toBe(true);
    expect(isJumpServerDebugEnabled({ JUMPSERVER_DEBUG: 'true' })).toBe(false);
    expect(isJumpServerDebugEnabled({})).toBe(false);
  });
});
