import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import bcrypt from 'bcrypt';

import {
  ASSISTANT_NAME,
  DEFAULT_AGENT_TYPE,
  IDLE_TIMEOUT,
  KB_INJECT_LIMIT,
  MAIN_GROUP_FOLDER,
  POLL_INTERVAL,
  TRIGGER_PATTERN,
  MAX_CONCURRENT_CONTAINERS,
  USE_LOCAL_AGENT,
} from './config.js';
import { WebChannel } from './channels/web.js';
import {
  ContainerOutput,
  runContainerAgent,
  writeGroupsSnapshot,
  writeTasksSnapshot,
} from './container-runner.js';
import {
  cleanupOrphans,
  ensureContainerRuntimeRunning,
} from './container-runtime.js';
import {
  getAllChats,
  getAllRegisteredGroups,
  getAllSessions,
  getAllTasks,
  getMessagesSince,
  getNewMessages,
  getRouterState,
  getSessionSkillSyncState,
  getUserByUsername,
  initDatabase,
  deleteSessionSkillData,
  deleteSession,
  setRegisteredGroup,
  setRouterState,
  setSession,
  storeChatMetadata,
  storeMessage,
  createUser,
  deleteChat,
  deleteRegisteredGroup,
  deleteTasksForChatJid,
  type MessageCursor,
  type SessionInfo,
} from './db.js';
import {
  deleteChatSkillsDir,
  syncChatSkills,
} from './chat-skills-sync.js';
import { GroupQueue } from './group-queue.js';
import { resolveGroupFolderPath } from './group-folder.js';
import {
  loadPendingInteractiveRequests,
  startAskConfirmWatcher,
  startKbSearchWatcher,
  startIpcWatcher,
  type IpcAskRequest,
  type IpcKbSearchRequest,
  type IpcConfirmRequest,
  writeAskResponse,
  writeKbSearchResponse,
  writeConfirmResponse,
} from './ipc.js';
import {
  findChannel,
  formatMessages,
  formatOutboundForJid,
} from './router.js';
import { startSchedulerLoop } from './task-scheduler.js';
import { startServer } from './server.js';
import { Channel, NewMessage, RegisteredGroup } from './types.js';
import { logger } from './logger.js';
import {
  createJumpServerStreamAggregator,
  extractConnectAndEnterTargetIp,
  extractRunRemoteCommand,
  extractRunRemoteTargetIp,
  isConnectAndEnterTargetCommand,
  isJumpServerConnectCommand,
  isRunRemoteCommandCall,
  type JumpServerBlock,
  type JumpServerExecution,
} from './jumpserver-stream-aggregator.js';
import {
  mergeThinkingBlocksIntoFinalBlocks,
  type ThinkingContentBlock,
} from './final-content.js';
import { adaptDeepAgentToolEvent } from './deepagent-stream-event-adapter.js';
import {
  logJumpServerExecutionSummary,
  logJumpServerStageDebug,
  logJumpServerToolDone,
  logJumpServerToolStart,
} from './jumpserver-diagnostic-logging.js';
import {
  executeSlashCommand,
  isSlashCommand,
  updateSdkCommands,
} from './slash-commands.js';
import {
  getRelevantContext,
  isKbConfigured,
  readContent,
  search,
} from './kb-proxy.js';

// Re-export for backwards compatibility during refactor
export { escapeXml, formatMessages } from './router.js';

// --- Default admin user ---

async function ensureDefaultAdmin(): Promise<void> {
  const existingAdmin = getUserByUsername('admin');
  if (existingAdmin) {
    logger.debug('Admin user already exists');
    return;
  }

  const passwordHash = await bcrypt.hash('admin123', 10);
  createUser({
    id: randomUUID(),
    username: 'admin',
    password_hash: passwordHash,
    role: 'admin',
    display_name: 'Administrator',
  });
  logger.info(
    'Created default admin user (username: admin, password: admin123)',
  );
}

let lastCursor: MessageCursor = { timestamp: '', rowid: 0 };
let sessions: Record<string, SessionInfo> = {};
let registeredGroups: Record<string, RegisteredGroup> = {};
let lastAgentTimestamp: Record<string, string> = {};
export const groupStats: Record<
  string,
  {
    usage?: {
      input_tokens: number;
      output_tokens: number;
      context_window?: number;
      model_usage?: Record<string, import('./container-runner.js').ModelUsageEntry>;
      cost_usd?: number;
    };
  }
> = {};
let messageLoopRunning = false;
const pendingAskByJid = new Map<string, Map<string, IpcAskRequest>>();
const pendingConfirmByJid = new Map<string, Map<string, IpcConfirmRequest>>();

let web: WebChannel;
const channels: Channel[] = [];
const queue = new GroupQueue();

function getWebChatFolder(jid: string): string {
  return jid.replace(/:/g, '-');
}

function upsertPendingAsk(jid: string, req: IpcAskRequest): void {
  let byRequestId = pendingAskByJid.get(jid);
  if (!byRequestId) {
    byRequestId = new Map();
    pendingAskByJid.set(jid, byRequestId);
  }
  byRequestId.set(req.requestId, req);
}

function removePendingAsk(jid: string, requestId: string): void {
  const byRequestId = pendingAskByJid.get(jid);
  if (!byRequestId) return;
  byRequestId.delete(requestId);
  if (byRequestId.size === 0) {
    pendingAskByJid.delete(jid);
  }
}

function upsertPendingConfirm(jid: string, req: IpcConfirmRequest): void {
  let byRequestId = pendingConfirmByJid.get(jid);
  if (!byRequestId) {
    byRequestId = new Map();
    pendingConfirmByJid.set(jid, byRequestId);
  }
  byRequestId.set(req.requestId, req);
}

function removePendingConfirm(jid: string, requestId: string): void {
  const byRequestId = pendingConfirmByJid.get(jid);
  if (!byRequestId) return;
  byRequestId.delete(requestId);
  if (byRequestId.size === 0) {
    pendingConfirmByJid.delete(jid);
  }
}

function loadState(): void {
  const rawTs = getRouterState('last_timestamp') || '';
  try {
    const parsed = JSON.parse(rawTs) as unknown;
    if (
      parsed &&
      typeof parsed === 'object' &&
      'timestamp' in parsed &&
      'rowid' in parsed &&
      typeof (parsed as MessageCursor).timestamp === 'string' &&
      typeof (parsed as MessageCursor).rowid === 'number'
    ) {
      lastCursor = parsed as MessageCursor;
    } else {
      lastCursor = { timestamp: rawTs, rowid: 0 };
    }
  } catch {
    lastCursor = { timestamp: rawTs, rowid: 0 };
  }
  const agentTs = getRouterState('last_agent_timestamp');
  try {
    lastAgentTimestamp = agentTs ? JSON.parse(agentTs) : {};
  } catch {
    logger.warn('Corrupted last_agent_timestamp in DB, resetting');
    lastAgentTimestamp = {};
  }
  sessions = getAllSessions();
  registeredGroups = getAllRegisteredGroups();

  // Ensure group folders exist for all loaded groups (critical for Docker persistence)
  for (const group of Object.values(registeredGroups)) {
    try {
      const groupDir = resolveGroupFolderPath(group.folder);
      fs.mkdirSync(path.join(groupDir, 'logs'), { recursive: true });
    } catch (err) {
      logger.warn(
        { group: group.name, err },
        'Failed to ensure group folder exists',
      );
    }
  }

  logger.info(
    { groupCount: Object.keys(registeredGroups).length },
    'State loaded',
  );
}

function saveState(): void {
  setRouterState('last_timestamp', JSON.stringify(lastCursor));
  setRouterState('last_agent_timestamp', JSON.stringify(lastAgentTimestamp));
}

function registerGroup(jid: string, group: RegisteredGroup): void {
  let groupDir: string;
  try {
    groupDir = resolveGroupFolderPath(group.folder);
  } catch (err) {
    logger.warn(
      { jid, folder: group.folder, err },
      'Rejecting group registration with invalid folder',
    );
    return;
  }

  registeredGroups[jid] = group;
  setRegisteredGroup(jid, group);

  // Create group folder
  fs.mkdirSync(path.join(groupDir, 'logs'), { recursive: true });

  logger.info(
    { jid, name: group.name, folder: group.folder },
    'Group registered',
  );
}

function cleanupLegacyDefaultWebChat(): void {
  const jid = 'web:default';
  const group = registeredGroups[jid];
  const folder = group?.folder;

  if (!group) return;

  logger.info(
    { jid, folder },
    'Removing legacy default web chat so all web chats use the same UUID session model',
  );

  if (folder) {
    delete sessions[folder];
    deleteSession(folder);
  }

  delete lastAgentTimestamp[jid];
  delete registeredGroups[jid];
  deleteRegisteredGroup(jid);
  deleteTasksForChatJid(jid);
  deleteChat(jid);

  if (folder && folder !== MAIN_GROUP_FOLDER) {
    const groupDir = resolveGroupFolderPath(folder);
    try {
      fs.rmSync(groupDir, { recursive: true, force: true });
    } catch (err) {
      logger.warn({ jid, folder, groupDir, err }, 'Failed to delete legacy default web chat group folder');
    }
  }
}

/**
 * Get available groups list for the agent.
 * Returns groups ordered by most recent activity.
 */
export function getAvailableGroups(): import('./container-runner.js').AvailableGroup[] {
  const chats = getAllChats();
  const registeredJids = new Set(Object.keys(registeredGroups));

  return chats
    .filter((c) => c.jid !== '__group_sync__' && c.is_group)
    .map((c) => ({
      jid: c.jid,
      name: c.name,
      lastActivity: c.last_message_time,
      isRegistered: registeredJids.has(c.jid),
    }));
}

/** @internal - exported for testing */
export function _setRegisteredGroups(
  groups: Record<string, RegisteredGroup>,
): void {
  registeredGroups = groups;
}

/**
 * Process all pending messages for a group.
 * Called by the GroupQueue when it's this group's turn.
 */
async function processGroupMessages(chatJid: string): Promise<boolean> {
  logger.debug({ chatJid }, 'processGroupMessages called');
  const group = registeredGroups[chatJid];
  if (!group) return true;

  const channel = findChannel(channels, chatJid);
  if (!channel) {
    logger.warn({ chatJid }, 'No channel owns JID, skipping messages');
    return true;
  }

  const isMainGroup = group.folder === MAIN_GROUP_FOLDER;

  const sinceTimestamp = lastAgentTimestamp[chatJid] || '';
  const missedMessages = getMessagesSince(
    chatJid,
    sinceTimestamp,
    ASSISTANT_NAME,
  );

  if (missedMessages.length === 0) return true;

  if (chatJid.startsWith('web:')) {
    const syncState = getSessionSkillSyncState(chatJid);
    if (!syncState || syncState.status === 'pending') {
      const syncResult = await syncChatSkills({ chatJid });
      if (syncResult.status === 'failed') {
        logger.warn(
          { chatJid, error: syncResult.errorMessage },
          'Failed to sync pending chat skills before processing messages',
        );
      }
    }
  }

  // Only require trigger if the group is configured for it.
  const needsTrigger = group.requiresTrigger !== false;

  if (needsTrigger) {
    const hasTrigger = missedMessages.some((m) =>
      TRIGGER_PATTERN.test(m.content.trim()),
    );
    if (!hasTrigger) return true;
  }

  const prompt = formatMessages(missedMessages);
  let enrichedPrompt = prompt;
  if (isKbConfigured()) {
    const kbContext = await getRelevantContext(prompt, { limit: KB_INJECT_LIMIT });
    if (kbContext) {
      enrichedPrompt = `${prompt}\n\n${kbContext}`;
    }
  }

  // Check if the last user message is a slash command
  const lastUserMessage = missedMessages.filter((m) => !m.is_bot_message).pop();

  if (lastUserMessage && isSlashCommand(lastUserMessage.content)) {
    const result = await executeSlashCommand(
      lastUserMessage.content.trim(),
      chatJid,
      group.folder,
    );

    if (result) {
      // Built-in command was executed, send result to user and skip agent
      await channel.sendMessage?.(chatJid, result.message);
      return true;
    }
    // If result is null, it's a custom command - let it pass through to the agent
  }

  // Advance cursor so the piping path in startMessageLoop won't re-fetch
  // these messages. Save the old cursor so we can roll back on error.
  const previousCursor = lastAgentTimestamp[chatJid] || '';
  lastAgentTimestamp[chatJid] =
    missedMessages[missedMessages.length - 1].timestamp;
  saveState();

  logger.info(
    { group: group.name, messageCount: missedMessages.length },
    'Processing messages',
  );

  // Track idle timer for closing stdin when agent is idle
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      logger.debug(
        { group: group.name },
        'Idle timeout, closing container stdin',
      );
      queue.closeStdin(chatJid);
    }, IDLE_TIMEOUT);
  };

  await channel.setTyping?.(chatJid, true);
  let hadError = false;
  let outputSentToUser = false;

  // Track tool_use blocks from stream events so they can be persisted with the final message.
  // The frontend merges these in-memory, but the DB only stores the final text result.
  // By accumulating here, we ensure tool cards survive session switches / page reloads.
  const pendingStreamTools = new Map<
    number,
    { id: string; name: string; inputJson: string; bufferedEvents: unknown[] }
  >();
  const completedStreamTools: Array<{
    type: 'tool_use';
    id: string;
    name: string;
    input: unknown;
    status: 'calling' | 'executed' | 'error';
    result?: string | object;
  }> = [];
  const normalizeToolResultContent = (content: unknown): string | object | undefined => {
    if (content === null || content === undefined) return undefined;
    if (Array.isArray(content)) {
      return content
        .map((item) => {
          if (typeof item === 'string') return item;
          if (
            typeof item === 'object' &&
            item !== null &&
            'text' in item &&
            typeof (item as { text?: unknown }).text === 'string'
          ) {
            return (item as { text: string }).text;
          }
          return JSON.stringify(item);
        })
        .join('\n');
    }
    if (typeof content === 'object') return content as object;
    return String(content);
  };
  const updateCompletedToolResult = (
    toolUseId: string | undefined,
    status: 'executed' | 'error',
    resultContent: unknown,
  ): void => {
    if (!toolUseId) return;
    const tool = completedStreamTools.find((item) => item.id === toolUseId);
    if (!tool) return;
    tool.status = status;
    tool.result = normalizeToolResultContent(resultContent);
  };
  const jumpServerAggregator = createJumpServerStreamAggregator();
  let latestJumpServerBlock: JumpServerBlock | null = null;
  const latestThinkingBlocks: ThinkingContentBlock[] = [];
  const thinkingIndexMap = new Map<number, number>();
  const jumpServerToolMeta = new Map<
    string,
    { startedAt: number; command?: string; targetHost?: string; kind: string }
  >();
  const executionMap = (block: JumpServerBlock | null | undefined) =>
    new Map((block?.executions ?? []).map((execution) => [execution.id, execution]));
  const durationMs = (
    startedAt?: string,
    finishedAt?: string,
  ): number | undefined => {
    if (!startedAt || !finishedAt) return undefined;
    const started = Date.parse(startedAt);
    const finished = Date.parse(finishedAt);
    if (Number.isNaN(started) || Number.isNaN(finished)) return undefined;
    return finished - started;
  };
  const logJumpServerDelta = (
    previous: JumpServerBlock | null,
    next: JumpServerBlock,
    context?: { toolUseId?: string; toolElapsedMs?: number },
  ) => {
    if (!previous || previous.stage !== next.stage) {
      logger.info(
        {
          group: group.name,
          chatJid,
          stage: next.stage,
          targetHost: next.target_host,
          executionCount: next.executions?.length ?? 0,
        },
        'JumpServer stage updated',
      );
      logJumpServerStageDebug(logger, {
        group: group.name,
        chatJid,
        previousStage: previous?.stage,
        stage: next.stage,
        targetHost: next.target_host,
        executionCount: next.executions?.length ?? 0,
      });
    }

    const prevExecutions = executionMap(previous);
    for (const execution of next.executions ?? []) {
      const prevExecution = prevExecutions.get(execution.id);
      if (!prevExecution) {
        logger.info(
          {
            group: group.name,
            chatJid,
            executionId: execution.id,
            command: execution.command,
            targetHost: next.target_host,
          },
          'JumpServer remote command started',
        );
        continue;
      }

      if (prevExecution.status !== execution.status) {
        const executionDurationMs = durationMs(
          execution.started_at ?? prevExecution.started_at,
          execution.finished_at ?? prevExecution.finished_at,
        );
        logger.info(
          {
            group: group.name,
            chatJid,
            executionId: execution.id,
            command: execution.command,
            status: execution.status,
            durationMs: executionDurationMs,
          },
          'JumpServer remote command status updated',
        );
        if (execution.status !== 'running') {
          logJumpServerExecutionSummary(logger, {
            group: group.name,
            chatJid,
            executionId: execution.id,
            command: execution.command,
            targetHost: next.target_host,
            status: execution.status,
            executionDurationMs,
            toolUseId: context?.toolUseId,
            toolElapsedMs: context?.toolElapsedMs,
          });
        }
      } else if (
        prevExecution.output !== execution.output &&
        execution.status === 'running'
      ) {
        logger.info(
          {
            group: group.name,
            chatJid,
            executionId: execution.id,
            command: execution.command,
            outputPreview: execution.output?.slice(0, 160),
          },
          'JumpServer remote command output updated',
        );
      }
    }
  };
  const emitJumpServerBlock = async (
    block: JumpServerBlock | undefined,
    context?: { toolUseId?: string; toolElapsedMs?: number },
  ) => {
    if (!block) return;
    logJumpServerDelta(latestJumpServerBlock, block, context);
    latestJumpServerBlock = block;
    if (channel.streamEvent) {
      await channel.streamEvent(chatJid, {
        type: 'jumpserver_session',
        block,
      });
      resetIdleTimer();
    }
  };
  const finalizeJumpServerBlock = (
    state: 'completed' | 'cancelled' | 'error',
    errorMessage?: string,
  ): JumpServerBlock | null => {
    if (!latestJumpServerBlock && !jumpServerAggregator.getBlock()) {
      return null;
    }

    const nextBlock =
      state === 'completed'
        ? jumpServerAggregator.complete()
        : state === 'cancelled'
          ? jumpServerAggregator.cancel()
          : jumpServerAggregator.fail(errorMessage);

    latestJumpServerBlock = nextBlock ?? latestJumpServerBlock;
    return latestJumpServerBlock;
  };
  const resetJumpServerTurnState = () => {
    latestJumpServerBlock = null;
    jumpServerAggregator.reset();
  };
  const resetThinkingTurnState = () => {
    latestThinkingBlocks.length = 0;
    thinkingIndexMap.clear();
  };
  const appendThinkingBlock = (
    index: number,
    type: 'thinking' | 'redacted_thinking',
    text: string,
  ) => {
    const existingIndex = thinkingIndexMap.get(index);
    if (existingIndex === undefined) {
      thinkingIndexMap.set(index, latestThinkingBlocks.length);
      latestThinkingBlocks.push({ type, text });
      return;
    }

    const existing = latestThinkingBlocks[existingIndex];
    if (!existing) return;
    latestThinkingBlocks[existingIndex] = {
      ...existing,
      type,
      text: (existing.text || '') + text,
    };
  };
  const consumeThinkingStreamEvent = (event: {
    type?: string;
    index?: number;
    content_block?: { type?: string; text?: string };
    delta?: { type?: string; thinking?: string };
  }) => {
    if (
      event.type === 'content_block_start' &&
      event.index !== undefined &&
      (event.content_block?.type === 'thinking' ||
        event.content_block?.type === 'redacted_thinking')
    ) {
      const type = event.content_block.type;
      appendThinkingBlock(
        event.index,
        type,
        event.content_block.text ||
          (type === 'redacted_thinking' ? 'Thinking process is redacted.' : ''),
      );
      return;
    }

    if (
      event.type === 'content_block_delta' &&
      event.index !== undefined &&
      event.delta?.type === 'thinking_delta'
    ) {
      appendThinkingBlock(
        event.index,
        'thinking',
        event.delta.thinking || '',
      );
    }
  };
  const buildFinalContent = (rawText?: string | null): string => {
    const finalizedJumpServerBlock = latestJumpServerBlock ?? jumpServerAggregator.getBlock();
    const cleanText = rawText
      ? formatOutboundForJid(chatJid, rawText)
      : '';
    const mergeWithThinking = (blocks: unknown[]) =>
      mergeThinkingBlocksIntoFinalBlocks(blocks, latestThinkingBlocks);

    if (finalizedJumpServerBlock) {
      latestJumpServerBlock = finalizedJumpServerBlock;
      const blocks: unknown[] = [finalizedJumpServerBlock];
      if (cleanText) blocks.push({ type: 'text', text: cleanText });
      completedStreamTools.length = 0;
      return JSON.stringify(mergeWithThinking(blocks));
    }

    for (const tool of completedStreamTools) {
      if (tool.status === 'calling') {
        tool.status = 'executed';
      }
    }
    if (completedStreamTools.length > 0) {
      const blocks: unknown[] = [...completedStreamTools];
      if (cleanText) blocks.push({ type: 'text', text: cleanText });
      completedStreamTools.length = 0;
      return JSON.stringify(mergeWithThinking(blocks));
    }

    if (latestThinkingBlocks.length > 0) {
      const blocks: unknown[] = [...latestThinkingBlocks];
      if (cleanText) blocks.push({ type: 'text', text: cleanText });
      return JSON.stringify(blocks);
    }

    return cleanText;
  };
  const sendFinalContentIfNeeded = async (rawText?: string | null) => {
    const finalContent = buildFinalContent(rawText);
    if (!finalContent) return;

    logger.info(
      { group: group.name },
      `Agent output: ${finalContent.slice(0, 200)}`,
    );
    await channel.sendMessage(chatJid, finalContent);
    outputSentToUser = true;
    resetJumpServerTurnState();
    resetThinkingTurnState();
  };

  // Resolve agentType in the callback closure so stream event handling can branch on it.
  const agentType = sessions[group.folder]?.agentType ?? DEFAULT_AGENT_TYPE;

  const agentResult = await runAgent(group, enrichedPrompt, chatJid, async (result) => {
    // Streaming output callback — called for each agent result
    if (result.streamEvent) {
      const event = result.streamEvent.event;
      if (event) {
        consumeThinkingStreamEvent(event);
        // Deep Agent emits its own event format (text_delta, tool_use_start, tool_use_end).
        // Forward directly without Anthropic-specific processing.
        if (agentType === 'deepagent') {
          const deepAgentToolEvent = adaptDeepAgentToolEvent(event);
          let shouldForwardRawEvent = true;

          if (deepAgentToolEvent?.type === 'tool_use') {
            const commandText = deepAgentToolEvent.input?.command;
            const isJumpServerToolUse =
              deepAgentToolEvent.name === 'Bash' &&
              !!commandText &&
              (
                isRunRemoteCommandCall(commandText) ||
                isConnectAndEnterTargetCommand(commandText) ||
                isJumpServerConnectCommand(commandText)
              );

            if (deepAgentToolEvent.toolUseId && isJumpServerToolUse) {
              const targetHost = isRunRemoteCommandCall(commandText)
                ? extractRunRemoteTargetIp(commandText)
                : isConnectAndEnterTargetCommand(commandText)
                  ? extractConnectAndEnterTargetIp(commandText)
                  : undefined;

              jumpServerToolMeta.set(deepAgentToolEvent.toolUseId, {
                startedAt: Date.now(),
                command: isRunRemoteCommandCall(commandText)
                  ? extractRunRemoteCommand(commandText) ?? commandText
                  : commandText,
                targetHost,
                kind: isRunRemoteCommandCall(commandText)
                  ? 'run_remote'
                  : isConnectAndEnterTargetCommand(commandText)
                    ? 'connect_and_enter'
                    : 'connect',
              });

              logJumpServerToolStart(logger, {
                group: group.name,
                chatJid,
                toolUseId: deepAgentToolEvent.toolUseId,
                toolName: deepAgentToolEvent.name,
                command: jumpServerToolMeta.get(deepAgentToolEvent.toolUseId)?.command,
                targetHost,
                kind: jumpServerToolMeta.get(deepAgentToolEvent.toolUseId)?.kind,
              });
            }
          }

          if (deepAgentToolEvent) {
            const toolMeta = deepAgentToolEvent.toolUseId
              ? jumpServerToolMeta.get(deepAgentToolEvent.toolUseId)
              : undefined;
            const toolElapsedMs = toolMeta
              ? Date.now() - toolMeta.startedAt
              : undefined;
            const jumpServerResult = jumpServerAggregator.consume(deepAgentToolEvent);

            if (jumpServerResult.block) {
              await emitJumpServerBlock(jumpServerResult.block, {
                toolUseId: deepAgentToolEvent.toolUseId,
                toolElapsedMs,
              });
            }

            if (jumpServerResult.hiddenOriginalEvent) {
              shouldForwardRawEvent = false;
            }

            if (toolMeta && deepAgentToolEvent.type === 'tool_result') {
              logJumpServerToolDone(logger, {
                group: group.name,
                chatJid,
                toolUseId: deepAgentToolEvent.toolUseId,
                command: toolMeta.command,
                targetHost: toolMeta.targetHost,
                kind: toolMeta.kind,
                elapsedMs: toolElapsedMs,
                result: deepAgentToolEvent.isError ? 'error' : 'success',
              });
              if (deepAgentToolEvent.toolUseId) {
                jumpServerToolMeta.delete(deepAgentToolEvent.toolUseId);
              }
            }
          }

          if (shouldForwardRawEvent && channel.streamEvent) {
            await channel.streamEvent(chatJid, event);
            resetIdleTimer();
          }
        } else {
        // --- Anthropic / Claude event processing ---
        let shouldForwardRawEvent = true;

        if (
          event.type === 'content_block_start' &&
          event.content_block?.type === 'tool_use'
        ) {
          pendingStreamTools.set(event.index, {
            id: event.content_block.id,
            name: event.content_block.name,
            inputJson: '',
            bufferedEvents: [event],
          });
          shouldForwardRawEvent = false;
        } else if (
          event.type === 'content_block_delta' &&
          event.delta?.type === 'input_json_delta'
        ) {
          const pending = pendingStreamTools.get(event.index);
          if (pending) {
            pending.inputJson += event.delta.partial_json ?? '';
            pending.bufferedEvents.push(event);
            shouldForwardRawEvent = false;
          }
        } else if (event.type === 'content_block_stop') {
          const pending = pendingStreamTools.get(event.index);
          if (pending) {
            let input: unknown = {};
            try { input = JSON.parse(pending.inputJson); } catch { /* use empty */ }
            const command =
              typeof input === 'object' && input !== null && 'command' in input
                ? (input as { command?: unknown }).command
                : undefined;
            const commandText =
              typeof command === 'string' ? command : undefined;
            const isJumpServerToolUse =
              pending.name === 'Bash' &&
              !!commandText &&
              (
                isRunRemoteCommandCall(commandText) ||
                isConnectAndEnterTargetCommand(commandText) ||
                isJumpServerConnectCommand(commandText)
              );
            if (pending.id && isJumpServerToolUse) {
              const targetHost = isRunRemoteCommandCall(commandText)
                ? extractRunRemoteTargetIp(commandText)
                : isConnectAndEnterTargetCommand(commandText)
                  ? extractConnectAndEnterTargetIp(commandText)
                  : undefined;
              jumpServerToolMeta.set(pending.id, {
                startedAt: Date.now(),
                command: isRunRemoteCommandCall(commandText)
                  ? extractRunRemoteCommand(commandText) ?? commandText
                  : commandText,
                targetHost,
                kind: isRunRemoteCommandCall(commandText)
                  ? 'run_remote'
                  : isConnectAndEnterTargetCommand(commandText)
                    ? 'connect_and_enter'
                    : 'connect',
              });
              logJumpServerToolStart(logger, {
                group: group.name,
                chatJid,
                toolUseId: pending.id,
                toolName: pending.name,
                command: jumpServerToolMeta.get(pending.id)?.command,
                targetHost,
                kind: jumpServerToolMeta.get(pending.id)?.kind,
              });
            }
            const jumpServerResult = jumpServerAggregator.consume({
              type: 'tool_use',
              name: pending.name,
              toolUseId: pending.id,
              input:
                typeof input === 'object' && input !== null
                  ? (input as { command?: string })
                  : { command: String(input) },
            });
            if (jumpServerResult.block) {
              await emitJumpServerBlock(jumpServerResult.block);
            }
            if (jumpServerResult.hiddenOriginalEvent) {
              shouldForwardRawEvent = false;
            } else {
              completedStreamTools.push({
                type: 'tool_use' as const,
                id: pending.id,
                name: pending.name,
                input,
                status: 'calling' as const,
              });
              if (channel.streamEvent) {
                for (const bufferedEvent of pending.bufferedEvents) {
                  await channel.streamEvent(chatJid, bufferedEvent);
                }
                await channel.streamEvent(chatJid, event);
                resetIdleTimer();
              }
            }
            pendingStreamTools.delete(event.index);
            shouldForwardRawEvent = false;
          }
        } else if (event.type === 'tool_result') {
          const toolMeta = event.tool_use_id
            ? jumpServerToolMeta.get(event.tool_use_id)
            : undefined;
          const toolElapsedMs = toolMeta
            ? Date.now() - toolMeta.startedAt
            : undefined;
          const jumpServerResult = jumpServerAggregator.consume({
            type: 'tool_result',
            toolUseId: event.tool_use_id,
            content: event.content,
            isError: event.is_error,
          });
          if (jumpServerResult.block) {
            await emitJumpServerBlock(jumpServerResult.block, {
              toolUseId: event.tool_use_id,
              toolElapsedMs,
            });
          }
          if (jumpServerResult.hiddenOriginalEvent) {
            shouldForwardRawEvent = false;
          }
          if (toolMeta) {
            logJumpServerToolDone(logger, {
              group: group.name,
              chatJid,
              toolUseId: event.tool_use_id,
              command: toolMeta.command,
              targetHost: toolMeta.targetHost,
              kind: toolMeta.kind,
              elapsedMs: toolElapsedMs,
              result: event.is_error ? 'error' : 'success',
            });
            if (event.tool_use_id) {
              jumpServerToolMeta.delete(event.tool_use_id);
            }
          }
          updateCompletedToolResult(
            event.tool_use_id,
            event.is_error ? 'error' : 'executed',
            event.content,
          );
        } else if (
          event.type === 'content_block_start' &&
          event.content_block?.type !== 'tool_use'
        ) {
          for (const tool of completedStreamTools) {
            if (tool.status === 'calling') {
              tool.status = 'executed';
            }
          }
        }

        // Forward raw event to channel if supported (for rich UI)
        if (shouldForwardRawEvent && channel.streamEvent) {
          await channel.streamEvent(chatJid, event);
          resetIdleTimer();
        } else if (shouldForwardRawEvent) {
          // Keep legacy text streaming for compatibility (only if streamEvent not supported)
          if (
            event.type === 'content_block_delta' &&
            event.delta &&
            event.delta.type === 'text_delta'
          ) {
            const chunk = event.delta.text;
            await channel.streamMessage?.(chatJid, chunk);
            resetIdleTimer();
          }
        }
        } // end of else (Anthropic / Claude event processing)
      }
    }

    if (result.usage) {
      groupStats[chatJid] = { ...groupStats[chatJid], usage: result.usage };
    }

    if (result.result) {
      const raw =
        typeof result.result === 'string'
          ? result.result
          : JSON.stringify(result.result);

      let finalContent: string;
      const isAlreadyArray = raw.trim().startsWith('[') && raw.trim().endsWith(']');
      if (isAlreadyArray) {
        const parsedBlocks = JSON.parse(raw) as unknown[];
        const blocksWithThinking = mergeThinkingBlocksIntoFinalBlocks(
          parsedBlocks,
          latestThinkingBlocks,
        );
        if (latestJumpServerBlock) {
          finalizeJumpServerBlock('completed');
          const filteredBlocks = blocksWithThinking.filter((block) => {
            if (!block || typeof block !== 'object') return true;
            const blockType = (block as { type?: unknown }).type;
            if (blockType === 'jumpserver_session') return false;
            if (blockType !== 'tool_use') return true;
            const input = (block as { input?: { command?: unknown } }).input;
            const command =
              input && typeof input === 'object' && 'command' in input
                ? String(input.command ?? '')
                : '';
            return !/jumpserver\/scripts\/(?:connect|connect-and-enter-target|run-remote-command)\.sh|tmux[\s\S]*(?:send-keys|capture-pane)/.test(
              command,
            );
          });
          finalContent = JSON.stringify([latestJumpServerBlock, ...filteredBlocks]);
        } else {
          // Container already serialized blocks (including any tool_use blocks)
          finalContent = JSON.stringify(blocksWithThinking);
        }
        completedStreamTools.length = 0;
      } else {
        if (latestJumpServerBlock) {
          finalizeJumpServerBlock('completed');
        }
        finalContent = buildFinalContent(raw);
      }

      logger.info({ group: group.name }, `Agent output: ${finalContent.slice(0, 200)}`);
      if (finalContent) {
        await channel.sendMessage(chatJid, finalContent);
        outputSentToUser = true;
        resetJumpServerTurnState();
        resetThinkingTurnState();
      }
      // A non-null result means the current query has completed and the agent
      // is about to transition into idle-waiting for the next IPC message.
      // Mark it idle immediately so web status/buttons don't remain stuck on
      // "generating" if the later session-update marker is missed or delayed.
      queue.notifyIdle(chatJid);
      await channel.setTyping?.(chatJid, false);
      // Only reset idle timer on actual results, not session-update markers (result: null)
      resetIdleTimer();
    }

    if (
      result.status === 'success' &&
      result.result === null &&
      !!result.newSessionId &&
      !result.streamEvent &&
      !result.slashCommands
    ) {
      queue.notifyIdle(chatJid);
    }

    if (result.status === 'error') {
      hadError = true;
      finalizeJumpServerBlock('error', result.error);
    }
  });

  await channel.setTyping?.(chatJid, false);
  if (idleTimer) clearTimeout(idleTimer);

  if (!outputSentToUser && (latestJumpServerBlock || jumpServerAggregator.getBlock())) {
    if (queue.isInterrupted(chatJid)) {
      finalizeJumpServerBlock('cancelled');
    } else if (agentResult.status === 'error' || hadError) {
      finalizeJumpServerBlock('error', agentResult.error);
    } else {
      finalizeJumpServerBlock('completed');
    }
    await sendFinalContentIfNeeded(null);
  }

  if (agentResult.status === 'error' || hadError) {
    // If the process was interrupted by user, don't treat it as an error that needs retry.
    if (queue.isInterrupted(chatJid)) {
      logger.info(
        { group: group.name },
        'Agent execution interrupted by user, skipping cursor rollback',
      );
      return true;
    }

    // If we already sent output to the user, don't roll back the cursor —
    // the user got their response and re-processing would send duplicates.
    if (outputSentToUser) {
      logger.warn(
        { group: group.name },
        'Agent error after output was sent, skipping cursor rollback to prevent duplicates',
      );
      return true;
    }

    // Check for session invalidation (e.g. process exited with code 1, likely due to lost session state)
    // We treat "exited with code 1" as a sign that the local state (cwd/home) doesn't match the session ID.
    const errorMessage = agentResult.error || '';
    if (errorMessage.includes('exited with code 1')) {
      logger.warn(
        { group: group.name, error: errorMessage },
        'Detected possible session corruption/loss. Invalidating session and forcing full history reload.',
      );

      // Clear session but preserve agent type
      const previousAgentType = sessions[group.folder]?.agentType ?? DEFAULT_AGENT_TYPE;
      delete sessions[group.folder];
      setSession(group.folder, '', previousAgentType);

      // Reset timestamp to re-fetch FULL history on next retry
      lastAgentTimestamp[chatJid] = '';
      saveState();

      // Return false to trigger retry (which will now use new session + full history)
      return false;
    }

    // Roll back cursor so retries can re-process these messages
    lastAgentTimestamp[chatJid] = previousCursor;
    saveState();
    logger.warn(
      { group: group.name },
      'Agent error, rolled back message cursor for retry',
    );
    return false;
  }

  return true;
}

async function runAgent(
  group: RegisteredGroup,
  prompt: string,
  chatJid: string,
  onOutput?: (output: ContainerOutput) => Promise<void>,
): Promise<{ status: 'success' | 'error'; error?: string }> {
  const isMain = group.folder === MAIN_GROUP_FOLDER;
  const session = sessions[group.folder];
  const sessionId = session?.sessionId;
  const agentType = session?.agentType ?? DEFAULT_AGENT_TYPE;

  // Update tasks snapshot for container to read (filtered by group)
  const tasks = getAllTasks();
  writeTasksSnapshot(
    group.folder,
    isMain,
    tasks.map((t) => ({
      id: t.id,
      groupFolder: t.group_folder,
      prompt: t.prompt,
      schedule_type: t.schedule_type,
      schedule_value: t.schedule_value,
      status: t.status,
      next_run: t.next_run,
    })),
  );

  // Update available groups snapshot (main group only can see all groups)
  const availableGroups = getAvailableGroups();
  writeGroupsSnapshot(
    group.folder,
    isMain,
    availableGroups,
    new Set(Object.keys(registeredGroups)),
  );

  // Wrap onOutput to track session ID from streamed results
  const wrappedOnOutput = onOutput
    ? async (output: ContainerOutput) => {
        if (output.newSessionId) {
          sessions[group.folder] = { sessionId: output.newSessionId, agentType };
          setSession(group.folder, output.newSessionId, agentType);
        }
        // Update slash commands cache when received from SDK
        if (output.slashCommands && output.slashCommands.length > 0) {
          updateSdkCommands(output.slashCommands);
        }
        await onOutput(output);
      }
    : undefined;

  try {
    const output = await runContainerAgent(
      group,
      {
        prompt,
        sessionId,
        groupFolder: group.folder,
        chatJid,
        isMain,
        assistantName: ASSISTANT_NAME,
        agentType,
      },
      (proc, containerName) =>
        queue.registerProcess(chatJid, proc, containerName, group.folder),
      wrappedOnOutput,
    );

    if (output.newSessionId) {
      sessions[group.folder] = { sessionId: output.newSessionId, agentType };
      setSession(group.folder, output.newSessionId, agentType);
    }

    if (output.status === 'error') {
      logger.error(
        { group: group.name, error: output.error },
        'Container agent error',
      );
      return { status: 'error', error: output.error };
    }

    return { status: 'success' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ group: group.name, err }, 'Agent error');
    return { status: 'error', error: msg };
  }
}

async function startMessageLoop(): Promise<void> {
  if (messageLoopRunning) {
    logger.debug('Message loop already running, skipping duplicate start');
    return;
  }
  messageLoopRunning = true;

  logger.info(`CNP-Bot running (trigger: @${ASSISTANT_NAME})`);

  while (true) {
    try {
      const jids = Object.keys(registeredGroups);
      const { messages, newTimestamp, newRowid } = getNewMessages(
        jids,
        lastCursor,
        ASSISTANT_NAME,
      );

      if (messages.length > 0) {
        logger.info({ count: messages.length }, 'New messages');

        // Advance the "seen" cursor for all messages immediately
        lastCursor = { timestamp: newTimestamp, rowid: newRowid };
        saveState();

        // Deduplicate by group
        const messagesByGroup = new Map<string, NewMessage[]>();
        for (const msg of messages) {
          const existing = messagesByGroup.get(msg.chat_jid);
          if (existing) {
            existing.push(msg);
          } else {
            messagesByGroup.set(msg.chat_jid, [msg]);
          }
        }

        for (const [chatJid, groupMessages] of messagesByGroup) {
          const group = registeredGroups[chatJid];
          if (!group) continue;

          const channel = findChannel(channels, chatJid);
          if (!channel) {
            logger.warn({ chatJid }, 'No channel owns JID, skipping messages');
            continue;
          }

          // Only require trigger if the group is configured for it.
          const needsTrigger = group.requiresTrigger !== false;

          // Check active state once and reuse below to avoid duplicate isGroupActive calls.
          const isActive = queue.isGroupActive(chatJid);

          // For non-main groups, only act on trigger messages.
          // Non-trigger messages accumulate in DB and get pulled as
          // context when a trigger eventually arrives.
          if (needsTrigger && !isActive) {
            const hasTrigger = groupMessages.some((m) =>
              TRIGGER_PATTERN.test(m.content.trim()),
            );
            if (!hasTrigger) continue;
          }

          if (isActive) {
            // Active container: fetch messages and pipe them in immediately.
            // This is the only path that needs getMessagesSince — processGroupMessages
            // is NOT called here, so there is no duplicate query.
            const sinceTs = lastAgentTimestamp[chatJid] || '';
            const allPending = getMessagesSince(chatJid, sinceTs, ASSISTANT_NAME);

            // If allPending is empty, fall back to the new messages that triggered
            // this loop iteration (guards against cursor being advanced concurrently).
            const messagesToSend =
              allPending.length > 0
                ? allPending
                : groupMessages.filter((m) => m.timestamp > sinceTs);

            if (messagesToSend.length === 0) continue;

            if (queue.sendMessage(chatJid, formatMessages(messagesToSend))) {
              logger.debug(
                { chatJid, count: messagesToSend.length },
                'Piped messages to active container',
              );
              lastAgentTimestamp[chatJid] =
                messagesToSend[messagesToSend.length - 1].timestamp;
              saveState();
              // Show typing indicator while the container processes the piped message
              channel
                .setTyping?.(chatJid, true)
                ?.catch((err) =>
                  logger.warn({ chatJid, err }, 'Failed to set typing indicator'),
                );
              continue;
            }
            // sendMessage returned false: container became inactive between the
            // isActive check and the write — fall through to enqueue.
          }

          // No active container — enqueue for a new one.
          // processGroupMessages will run getMessagesSince itself, so we skip
          // the query here to avoid doing it twice.
          queue.enqueueMessageCheck(chatJid);
        }
      }
    } catch (err) {
      logger.error({ err }, 'Error in message loop');
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
  }
}

/**
 * Startup recovery: check for unprocessed messages in registered groups.
 * Handles crash between advancing lastTimestamp and processing messages.
 */
function recoverPendingMessages(): void {
  for (const [chatJid, group] of Object.entries(registeredGroups)) {
    const sinceTimestamp = lastAgentTimestamp[chatJid] || '';
    const pending = getMessagesSince(chatJid, sinceTimestamp, ASSISTANT_NAME);
    if (pending.length > 0) {
      logger.info(
        { group: group.name, pendingCount: pending.length },
        'Recovery: found unprocessed messages',
      );
      queue.enqueueMessageCheck(chatJid);
    }
  }
}

function ensureContainerSystemRunning(): void {
  if (USE_LOCAL_AGENT) {
    logger.info('Running in local agent mode (no container runtime required)');
    return;
  }
  ensureContainerRuntimeRunning();
  cleanupOrphans();
}

async function main(): Promise<void> {
  ensureContainerSystemRunning();
  initDatabase();
  logger.info('Database initialized');

  // Ensure default admin user exists
  await ensureDefaultAdmin();

  loadState();
  cleanupLegacyDefaultWebChat();

  // Graceful shutdown handlers
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received');
    await queue.shutdown(10000);
    for (const ch of channels) await ch.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Channel callbacks (shared by all channels)
  const channelOpts = {
    onMessage: (_chatJid: string, msg: NewMessage) => storeMessage(msg),
    onChatMetadata: (
      chatJid: string,
      timestamp: string,
      name?: string,
      channel?: string,
      isGroup?: boolean,
    ) => storeChatMetadata(chatJid, timestamp, name, channel, isGroup),
    registeredGroups: () => registeredGroups,
  };

  // Start web server
  const syncActiveChatSkills = async (
    jid: string,
  ): Promise<{
    status: 'pending' | 'synced' | 'failed';
    errorMessage?: string;
  }> => {
    if (!jid.startsWith('web:')) {
      return { status: 'pending' };
    }
    if (!queue.isGroupBusy(jid)) {
      return { status: 'pending' };
    }

    return syncChatSkills({ chatJid: jid });
  };

  const { broadcastToJid } = startServer({
    getGroupStats: (jid) => groupStats[jid],
    sendMessage: async (jid, rawText) => {
      const channel = findChannel(channels, jid);
      if (!channel) throw new Error(`No channel for JID: ${jid}`);
      const text = formatOutboundForJid(jid, rawText);
      if (text) await channel.sendMessage(jid, text);
    },
    onWebUserMessage: async (jid, text, userId) => {
      // Auto-register new web chats so they can be processed by the agent
      if (jid.startsWith('web:') && !registeredGroups[jid]) {
        logger.info({ jid }, 'Auto-registering new web chat session');
        const folder = getWebChatFolder(jid);

        registerGroup(jid, {
          name: 'New Chat',
          folder,
          trigger: `@${ASSISTANT_NAME}`,
          added_at: new Date().toISOString(),
          requiresTrigger: false,
        });
      }

      const timestamp = new Date().toISOString();
      storeChatMetadata(
        jid,
        timestamp,
        jid,
        'web',
        false,
        userId,
      );
      const msg: NewMessage = {
        id: randomUUID(),
        chat_jid: jid,
        sender: 'web-user',
        sender_name: 'You',
        content: text,
        timestamp,
        is_from_me: true,
        is_bot_message: false,
      };
      storeMessage(msg);

      // If a container is already active for this jid, pipe the message in
      // immediately instead of waiting up to POLL_INTERVAL for the message loop.
      if (queue.isGroupActive(jid)) {
        const sinceTs = lastAgentTimestamp[jid] || '';
        const pending = getMessagesSince(jid, sinceTs, ASSISTANT_NAME);
        if (pending.length > 0) {
          const formatted = formatMessages(pending);
          if (queue.sendMessage(jid, formatted)) {
            lastAgentTimestamp[jid] = pending[pending.length - 1].timestamp;
            saveState();
            const ch = findChannel(channels, jid);
            ch?.setTyping?.(jid, true)?.catch((e) =>
              logger.warn({ jid, e }, 'Failed to set typing indicator'),
            );
            return {
              id: msg.id,
              chat_jid: msg.chat_jid,
              sender: msg.sender,
              sender_name: msg.sender_name,
              content: msg.content,
              timestamp: msg.timestamp,
              is_from_me: true,
              is_bot_message: false,
            };
          }
        }
      }

      queue.enqueueMessageCheck(jid);
      return {
        id: msg.id,
        chat_jid: msg.chat_jid,
        sender: msg.sender,
        sender_name: msg.sender_name,
        content: msg.content,
        timestamp: msg.timestamp,
        is_from_me: true,
        is_bot_message: false,
      };
    },
    onStopGeneration: (jid) => {
      logger.info({ jid }, 'Received stop request');
      queue.stopGroup(jid);
    },
    onCreateChat: (jid, _userId, agentType) => {
      if (!jid.startsWith('web:') || registeredGroups[jid]) return;
      logger.info({ jid }, 'Pre-registering new web chat session');
      const folder = getWebChatFolder(jid);
      registerGroup(jid, {
        name: 'New Chat',
        folder,
        trigger: `@${ASSISTANT_NAME}`,
        added_at: new Date().toISOString(),
        requiresTrigger: false,
      });
      sessions[folder] = { sessionId: '', agentType };
      setSession(folder, '', agentType);
    },
    onChatSkillsUpdated: syncActiveChatSkills,
    isGroupActive: (jid) => queue.isGroupBusy(jid),
    getGroupFolder: (jid) => registeredGroups[jid]?.folder,
    getPendingInteractive: (jid) => ({
      asks: Array.from(pendingAskByJid.get(jid)?.values() || []).map((req) => ({
        requestId: req.requestId,
        question: req.question,
      })),
      confirms: Array.from(pendingConfirmByJid.get(jid)?.values() || []).map(
        (req) => ({
          requestId: req.requestId,
          command: req.command,
          reason: req.reason,
          targetHost: req.targetHost,
        }),
      ),
    }),
    onAskUserResponse: (groupFolder, requestId, answer) => {
      const jid = Object.keys(registeredGroups).find(
        (k) => registeredGroups[k]?.folder === groupFolder,
      );
      const ok = writeAskResponse(groupFolder, requestId, answer);
      if (ok && jid) {
        removePendingAsk(jid, requestId);
      }
      return ok;
    },
    onConfirmBashResponse: (groupFolder, requestId, approved) => {
      const jid = Object.keys(registeredGroups).find(
        (k) => registeredGroups[k]?.folder === groupFolder,
      );
      const pending = jid ? pendingConfirmByJid.get(jid)?.get(requestId) : undefined;
      const ok = writeConfirmResponse(
        groupFolder,
        requestId,
        approved,
        pending?.command,
        pending?.reason,
      );
      if (ok && jid) {
        removePendingConfirm(jid, requestId);
      }
      return ok;
    },
    onDeleteChat: (jid) => {
      logger.info({ jid }, 'Deleting chat, stopping container process');
      queue.stopGroup(jid);
      // Write _close sentinel to gracefully stop the container
      queue.closeStdin(jid);
      const group = registeredGroups[jid];
      let folder = group?.folder;
      if (!folder && jid.startsWith('web:')) {
        folder = getWebChatFolder(jid);
      }
      if (folder) {
        delete sessions[folder];
        deleteSession(folder);
      }
      deleteSessionSkillData(jid);
      deleteChatSkillsDir(jid);
      pendingAskByJid.delete(jid);
      pendingConfirmByJid.delete(jid);
      delete lastAgentTimestamp[jid];

      // Clean up isolated web chat group folder and orphaned data
      if (
        jid.startsWith('web:') &&
        folder &&
        folder !== MAIN_GROUP_FOLDER
      ) {
        const groupDir = resolveGroupFolderPath(folder);
        try {
          fs.rmSync(groupDir, { recursive: true, force: true });
          logger.info({ jid, folder, groupDir }, 'Deleted web chat group folder');
        } catch (err) {
          logger.warn({ jid, folder, groupDir, err }, 'Failed to delete web chat group folder');
        }

        // Clean up orphaned scheduled tasks and their run logs
        deleteTasksForChatJid(jid);

        // Remove from registered_groups table and in-memory map
        delete registeredGroups[jid];
        deleteRegisteredGroup(jid);

        logger.info({ jid, folder }, 'Web chat fully cleaned up');
      }

      saveState();
    },
  });

  // Create and connect channels
  web = new WebChannel({ broadcastToJid });
  channels.push(web);

  // Start subsystems (independently of connection handler)
  startSchedulerLoop({
    registeredGroups: () => registeredGroups,
    getSessions: () => sessions,
    queue,
    onProcess: (groupJid, proc, containerName, groupFolder) =>
      queue.registerProcess(groupJid, proc, containerName, groupFolder),
    sendMessage: async (jid, rawText) => {
      const channel = findChannel(channels, jid);
      if (!channel) {
        logger.warn({ jid }, 'No channel owns JID, cannot send message');
        return;
      }
      const text = formatOutboundForJid(jid, rawText);
      if (text) await channel.sendMessage(jid, text);
    },
  });
  startIpcWatcher({
    sendMessage: (jid, text) => {
      const channel = findChannel(channels, jid);
      if (!channel) throw new Error(`No channel for JID: ${jid}`);
      return channel.sendMessage(jid, text);
    },
    registeredGroups: () => registeredGroups,
    registerGroup,
    syncGroupMetadata: () => Promise.resolve(),
    getAvailableGroups,
    writeGroupsSnapshot: (gf, im, ag, rj) =>
      writeGroupsSnapshot(gf, im, ag, rj),
  });
  startAskConfirmWatcher(
    () => registeredGroups,
    (groupFolder, req) => {
      const jid = Object.keys(registeredGroups).find(
        (k) => registeredGroups[k]?.folder === groupFolder,
      );
      if (jid) {
        upsertPendingAsk(jid, req);
        broadcastToJid(jid, {
          type: 'ask_user',
          chat_jid: jid,
          requestId: req.requestId,
          question: req.question,
        });
      }
    },
    (groupFolder, req) => {
      const jid = Object.keys(registeredGroups).find(
        (k) => registeredGroups[k]?.folder === groupFolder,
      );
      if (jid) {
        upsertPendingConfirm(jid, req);
        broadcastToJid(jid, {
          type: 'confirm_bash',
          chat_jid: jid,
          requestId: req.requestId,
          command: req.command,
          reason: req.reason,
          targetHost: req.targetHost,
        });
      }
    },
  );
  if (isKbConfigured()) {
    startKbSearchWatcher(
      () => registeredGroups,
      async (groupFolder, req: IpcKbSearchRequest) => {
        try {
          const results = await search(req.query, {
            limit: req.limit,
            targetUri: req.targetUri,
          });
          const enriched = await Promise.all(
            results.map(async (item) => {
              let content = item.abstract ?? '';
              try {
                content = await readContent(item.uri);
              } catch {
                // fall back to abstract if full content read fails
              }
              return {
                uri: item.uri,
                content,
                abstract: item.abstract,
                category: item.category,
                score: item.score ?? 0,
              };
            }),
          );
          writeKbSearchResponse(groupFolder, req.requestId, { results: enriched });
        } catch (err) {
          writeKbSearchResponse(groupFolder, req.requestId, {
            results: [],
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    );
  }
  // Reload any confirm/ask requests that arrived while the host was offline
  loadPendingInteractiveRequests(
    () => registeredGroups,
    (groupFolder, req) => {
      const jid = Object.keys(registeredGroups).find(
        (k) => registeredGroups[k]?.folder === groupFolder,
      );
      if (jid) upsertPendingAsk(jid, req);
    },
    (groupFolder, req) => {
      const jid = Object.keys(registeredGroups).find(
        (k) => registeredGroups[k]?.folder === groupFolder,
      );
      if (jid) upsertPendingConfirm(jid, req);
    },
  );

  queue.setProcessMessagesFn(processGroupMessages);
  recoverPendingMessages();
  startMessageLoop().catch((err) => {
    logger.fatal({ err }, 'Message loop crashed unexpectedly');
    process.exit(1);
  });
}

// Guard: only run when executed directly, not when imported by tests
const isDirectRun =
  process.argv[1] &&
  new URL(import.meta.url).pathname ===
    new URL(`file://${process.argv[1]}`).pathname;

if (isDirectRun) {
  main().catch((err) => {
    logger.error({ err }, 'Failed to start CNP-Bot');
    process.exit(1);
  });
}
