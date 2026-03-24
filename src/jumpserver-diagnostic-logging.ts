import { logger as baseLogger } from './logger.js';

type DebugLogger = Pick<typeof baseLogger, 'debug'>;
type DebugEnv = NodeJS.ProcessEnv | Record<string, string | undefined>;

function emitDebug(
  logger: DebugLogger,
  phase: string,
  payload: Record<string, unknown>,
  env: DebugEnv = process.env,
) {
  if (!isJumpServerDebugEnabled(env)) return;
  logger.debug({ phase, ...payload }, 'JumpServer diagnostic');
}

export function isJumpServerDebugEnabled(env: DebugEnv = process.env): boolean {
  return env.JUMPSERVER_DEBUG === '1';
}

export function logJumpServerToolStart(
  logger: DebugLogger,
  payload: Record<string, unknown>,
  env: DebugEnv = process.env,
) {
  emitDebug(logger, 'jumpserver_tool_start', payload, env);
}

export function logJumpServerToolDone(
  logger: DebugLogger,
  payload: Record<string, unknown>,
  env: DebugEnv = process.env,
) {
  emitDebug(logger, 'jumpserver_tool_done', payload, env);
}

export function logJumpServerStageDebug(
  logger: DebugLogger,
  payload: Record<string, unknown>,
  env: DebugEnv = process.env,
) {
  emitDebug(logger, 'jumpserver_stage', payload, env);
}

export function logJumpServerExecutionSummary(
  logger: DebugLogger,
  payload: Record<string, unknown>,
  env: DebugEnv = process.env,
) {
  emitDebug(logger, 'jumpserver_execution_summary', payload, env);
}
