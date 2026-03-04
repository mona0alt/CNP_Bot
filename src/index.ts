import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

import {
  ASSISTANT_NAME,
  IDLE_TIMEOUT,
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
import { cleanupOrphans, ensureContainerRuntimeRunning } from './container-runtime.js';
import {
  getAllChats,
  getAllRegisteredGroups,
  getAllSessions,
  getAllTasks,
  getMessagesSince,
  getNewMessages,
  getRouterState,
  initDatabase,
  setRegisteredGroup,
  setRouterState,
  setSession,
  storeChatMetadata,
  storeMessage,
} from './db.js';
import { GroupQueue } from './group-queue.js';
import { resolveGroupFolderPath } from './group-folder.js';
import { startIpcWatcher } from './ipc.js';
import { findChannel, formatMessages, formatOutbound } from './router.js';
import { startSchedulerLoop } from './task-scheduler.js';
import { startServer } from './server.js';
import { Channel, NewMessage, RegisteredGroup } from './types.js';
import { logger } from './logger.js';

// Re-export for backwards compatibility during refactor
export { escapeXml, formatMessages } from './router.js';

let lastTimestamp = '';
let sessions: Record<string, string> = {};
let registeredGroups: Record<string, RegisteredGroup> = {};
let lastAgentTimestamp: Record<string, string> = {};
export const groupStats: Record<string, { usage?: { input_tokens: number, output_tokens: number } }> = {};
let messageLoopRunning = false;

let web: WebChannel;
const channels: Channel[] = [];
const queue = new GroupQueue();

function loadState(): void {
  lastTimestamp = getRouterState('last_timestamp') || '';
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
      logger.warn({ group: group.name, err }, 'Failed to ensure group folder exists');
    }
  }

  logger.info(
    { groupCount: Object.keys(registeredGroups).length },
    'State loaded',
  );
}

function saveState(): void {
  setRouterState('last_timestamp', lastTimestamp);
  setRouterState(
    'last_agent_timestamp',
    JSON.stringify(lastAgentTimestamp),
  );
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
export function _setRegisteredGroups(groups: Record<string, RegisteredGroup>): void {
  registeredGroups = groups;
}

/**
 * Process all pending messages for a group.
 * Called by the GroupQueue when it's this group's turn.
 */
async function processGroupMessages(chatJid: string): Promise<boolean> {
  console.log('DEBUG: processGroupMessages called for', chatJid);
  const group = registeredGroups[chatJid];
  if (!group) return true;

  const channel = findChannel(channels, chatJid);
  if (!channel) {
    console.log(`Warning: no channel owns JID ${chatJid}, skipping messages`);
    return true;
  }

  const isMainGroup = group.folder === MAIN_GROUP_FOLDER;

  const sinceTimestamp = lastAgentTimestamp[chatJid] || '';
  const missedMessages = getMessagesSince(chatJid, sinceTimestamp, ASSISTANT_NAME);

  if (missedMessages.length === 0) return true;

  // Only require trigger if the group is configured for it.
  // We explicitly exempt web:default to ensure web chat always works without trigger.
  const needsTrigger = chatJid !== 'web:default' && group.requiresTrigger !== false;

  if (needsTrigger) {
    const hasTrigger = missedMessages.some((m) =>
      TRIGGER_PATTERN.test(m.content.trim()),
    );
    if (!hasTrigger) return true;
  }

  const prompt = formatMessages(missedMessages);

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
      logger.debug({ group: group.name }, 'Idle timeout, closing container stdin');
      queue.closeStdin(chatJid);
    }, IDLE_TIMEOUT);
  };

  await channel.setTyping?.(chatJid, true);
  let hadError = false;
  let outputSentToUser = false;
  let pendingToolBlocks: Array<{ type: string; id?: string; name?: string; input?: any; status?: string; result?: any }> = [];

  const agentResult = await runAgent(group, prompt, chatJid, async (result) => {
    // Streaming output callback — called for each agent result
    if (result.streamEvent) {
      const event = result.streamEvent.event;
      if (event) {
        // Forward raw event to channel if supported (for rich UI)
        if (channel.streamEvent) {
          await channel.streamEvent(chatJid, event);
          resetIdleTimer();
        } else {
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
      }
    }

    if (result.usage) {
        groupStats[chatJid] = { ...groupStats[chatJid], usage: result.usage };
    }

    // Collect tool_use blocks from stream events to include in final message
    if (result.streamEvent) {
      const event = result.streamEvent.event;
      if (event) {
        if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
          pendingToolBlocks.push({
            type: 'tool_use',
            id: event.content_block.id,
            name: event.content_block.name,
            input: event.content_block.input,
            status: 'calling'
          });
        } else if (event.type === 'tool_result') {
          // Update existing tool block with result
          const toolIndex = pendingToolBlocks.findIndex(b => b.id === event.tool_use_id);
          if (toolIndex !== -1) {
            pendingToolBlocks[toolIndex] = {
              ...pendingToolBlocks[toolIndex],
              status: event.is_error ? 'error' : 'executed',
              result: Array.isArray(event.content)
                ? event.content.map((c: any) => c.text || JSON.stringify(c)).join('\n')
                : event.content
            };
          }
        }
      }
    }

    if (result.result) {
      const raw = typeof result.result === 'string' ? result.result : JSON.stringify(result.result);

      // Build final content: combine pending tool blocks with the result text
      let finalContent = raw;

      // If we have pending tool blocks, merge them with the result
      if (pendingToolBlocks.length > 0) {
        let textContent = raw;
        if (!raw.trim().startsWith('[')) {
          // Legacy text processing
          textContent = raw.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
        }

        // If result is a JSON array, merge tool blocks into it
        if (raw.trim().startsWith('[') && raw.trim().endsWith(']')) {
          try {
            const existingBlocks = JSON.parse(raw);
            if (Array.isArray(existingBlocks)) {
              // Prepend tool_use blocks at the beginning
              finalContent = JSON.stringify([...pendingToolBlocks, ...existingBlocks]);
            }
          } catch {
            // If parsing fails, create a new array with tool blocks + text
            finalContent = JSON.stringify([...pendingToolBlocks, { type: 'text', text: textContent }]);
          }
        } else {
          // Create array with tool blocks + text
          finalContent = JSON.stringify([...pendingToolBlocks, { type: 'text', text: textContent }]);
        }
      } else if (raw.trim().startsWith('[') && raw.trim().endsWith(']')) {
        // Already a JSON array, keep as-is
        finalContent = raw;
      } else {
        // Legacy text processing for plain text results
        finalContent = raw.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
      }

      logger.info({ group: group.name }, `Agent output: ${finalContent.slice(0, 200)}, toolBlocks: ${pendingToolBlocks.length}`);
      if (finalContent) {
        await channel.sendMessage(chatJid, finalContent);
        outputSentToUser = true;
      }
      // Clear pending tool blocks after sending
      pendingToolBlocks = [];
      // Only reset idle timer on actual results, not session-update markers (result: null)
      resetIdleTimer();
    }

    if (result.status === 'success') {
      queue.notifyIdle(chatJid);
    }

    if (result.status === 'error') {
      hadError = true;
    }
  });

  await channel.setTyping?.(chatJid, false);
  if (idleTimer) clearTimeout(idleTimer);

  if (agentResult.status === 'error' || hadError) {
    // If the process was interrupted by user, don't treat it as an error that needs retry.
    if (queue.isInterrupted(chatJid)) {
      logger.info({ group: group.name }, 'Agent execution interrupted by user, skipping cursor rollback');
      return true;
    }

    // If we already sent output to the user, don't roll back the cursor —
    // the user got their response and re-processing would send duplicates.
    if (outputSentToUser) {
      logger.warn({ group: group.name }, 'Agent error after output was sent, skipping cursor rollback to prevent duplicates');
      return true;
    }

    // Check for session invalidation (e.g. process exited with code 1, likely due to lost session state)
    // We treat "exited with code 1" as a sign that the local state (cwd/home) doesn't match the session ID.
    const errorMessage = agentResult.error || '';
    if (errorMessage.includes('exited with code 1')) {
        logger.warn({ group: group.name, error: errorMessage }, 'Detected possible session corruption/loss. Invalidating session and forcing full history reload.');
        
        // Clear session
        delete sessions[group.folder];
        setSession(group.folder, '');
        
        // Reset timestamp to re-fetch FULL history on next retry
        lastAgentTimestamp[chatJid] = '';
        saveState();
        
        // Return false to trigger retry (which will now use new session + full history)
        return false;
    }

    // Roll back cursor so retries can re-process these messages
    lastAgentTimestamp[chatJid] = previousCursor;
    saveState();
    logger.warn({ group: group.name }, 'Agent error, rolled back message cursor for retry');
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
  const sessionId = sessions[group.folder];

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
          sessions[group.folder] = output.newSessionId;
          setSession(group.folder, output.newSessionId);
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
      },
      (proc, containerName) => queue.registerProcess(chatJid, proc, containerName, group.folder),
      wrappedOnOutput,
    );

    if (output.newSessionId) {
      sessions[group.folder] = output.newSessionId;
      setSession(group.folder, output.newSessionId);
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

  logger.info(`NanoClaw running (trigger: @${ASSISTANT_NAME})`);

  while (true) {
    try {
      const jids = Object.keys(registeredGroups);
      const { messages, newTimestamp } = getNewMessages(
        jids,
        lastTimestamp,
        ASSISTANT_NAME,
      );

      if (messages.length > 0) {
        logger.info({ count: messages.length }, 'New messages');

        // Advance the "seen" cursor for all messages immediately
        lastTimestamp = newTimestamp;
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
            console.log(`Warning: no channel owns JID ${chatJid}, skipping messages`);
            continue;
          }

          // Only require trigger if the group is configured for it.
          // We explicitly exempt web:default to ensure web chat always works without trigger,
          // regardless of DB state (though it should be registered with requiresTrigger: false).
          const needsTrigger = chatJid !== 'web:default' && group.requiresTrigger !== false;

          // For non-main groups, only act on trigger messages.
          // Non-trigger messages accumulate in DB and get pulled as
          // context when a trigger eventually arrives.
          if (needsTrigger) {
            // Check if there is an active container for this group
            // If active, we pipe all messages (even without trigger)
            const isActive = queue.isGroupActive(chatJid);
            
            if (!isActive) {
              const hasTrigger = groupMessages.some((m) =>
                TRIGGER_PATTERN.test(m.content.trim()),
              );
              if (!hasTrigger) continue;
            }
          }

          // Pull all messages since lastAgentTimestamp so non-trigger
          // context that accumulated between triggers is included.
          const sinceTs = lastAgentTimestamp[chatJid] || '';
          const allPending = getMessagesSince(
            chatJid,
            sinceTs,
            ASSISTANT_NAME,
          );
          
          // If allPending is empty, it means we've already processed everything up to lastAgentTimestamp.
          // However, groupMessages contains the new messages that triggered this loop iteration.
          // We must ensure we don't re-process messages that are already covered by lastAgentTimestamp.
          // This happens if processGroupMessages updated lastAgentTimestamp concurrently.
          const messagesToSend =
            allPending.length > 0 
              ? allPending 
              : groupMessages.filter(m => m.timestamp > sinceTs);

          if (messagesToSend.length === 0) continue;

          const formatted = formatMessages(messagesToSend);

          if (queue.sendMessage(chatJid, formatted)) {
            logger.debug(
              { chatJid, count: messagesToSend.length },
              'Piped messages to active container',
            );
            lastAgentTimestamp[chatJid] =
              messagesToSend[messagesToSend.length - 1].timestamp;
            saveState();
            // Show typing indicator while the container processes the piped message
            channel.setTyping?.(chatJid, true)?.catch((err) =>
              logger.warn({ chatJid, err }, 'Failed to set typing indicator'),
            );
          } else {
            // No active container — enqueue for a new one
            queue.enqueueMessageCheck(chatJid);
          }
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
  loadState();

  if (!registeredGroups['web:default']) {
    registerGroup('web:default', {
      name: 'Web Chat',
      folder: MAIN_GROUP_FOLDER,
      trigger: `@${ASSISTANT_NAME}`,
      added_at: new Date().toISOString(),
      requiresTrigger: false,
    });
  }

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
    onChatMetadata: (chatJid: string, timestamp: string, name?: string, channel?: string, isGroup?: boolean) =>
      storeChatMetadata(chatJid, timestamp, name, channel, isGroup),
    registeredGroups: () => registeredGroups,
  };

  // Start web server
  const { broadcastToJid } = startServer({
    getGroupStats: (jid) => groupStats[jid],
    sendMessage: async (jid, rawText) => {
      const channel = findChannel(channels, jid);
      if (!channel) throw new Error(`No channel for JID: ${jid}`);
      const text = formatOutbound(rawText);
      if (text) await channel.sendMessage(jid, text);
    },
    onWebUserMessage: async (jid, text) => {
      // Auto-register new web chats so they can be processed by the agent
      if (jid.startsWith('web:') && !registeredGroups[jid]) {
        logger.info({ jid }, 'Auto-registering new web chat session');

        // Use a unique folder for new web chats to ensure session isolation
        // Only web:default shares the main folder
        const folder = jid === 'web:default' ? MAIN_GROUP_FOLDER : jid.replace(/:/g, '-');

        registerGroup(jid, {
          name: 'New Chat',
          folder,
          trigger: `@${ASSISTANT_NAME}`,
          added_at: new Date().toISOString(),
          requiresTrigger: false,
        });
      }

      const timestamp = new Date().toISOString();
      storeChatMetadata(jid, timestamp, jid === 'web:default' ? 'Web Chat' : jid, 'web', false);
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
  });

  // Create and connect channels
  web = new WebChannel({ broadcastToJid });
  channels.push(web);

  // Start subsystems (independently of connection handler)
  startSchedulerLoop({
    registeredGroups: () => registeredGroups,
    getSessions: () => sessions,
    queue,
    onProcess: (groupJid, proc, containerName, groupFolder) => queue.registerProcess(groupJid, proc, containerName, groupFolder),
    sendMessage: async (jid, rawText) => {
      const channel = findChannel(channels, jid);
      if (!channel) {
        console.log(`Warning: no channel owns JID ${jid}, cannot send message`);
        return;
      }
      const text = formatOutbound(rawText);
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
    writeGroupsSnapshot: (gf, im, ag, rj) => writeGroupsSnapshot(gf, im, ag, rj),
  });
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
  new URL(import.meta.url).pathname === new URL(`file://${process.argv[1]}`).pathname;

if (isDirectRun) {
  main().catch((err) => {
    logger.error({ err }, 'Failed to start NanoClaw');
    process.exit(1);
  });
}
