import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

import { ASSISTANT_NAME, DATA_DIR, STORE_DIR } from './config.js';
import type { AgentType } from './config.js';
import { isValidGroupFolder } from './group-folder.js';
import { logger } from './logger.js';
import {
  NewMessage,
  RegisteredGroup,
  ScheduledTask,
  SessionSkillSyncState,
  SessionSkillSyncStatus,
  TaskRunLog,
} from './types.js';

let db: Database.Database;

function createSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS chats (
      jid TEXT PRIMARY KEY,
      name TEXT,
      last_message_time TEXT,
      channel TEXT,
      is_group INTEGER DEFAULT 0,
      user_id TEXT,
      agent_type TEXT DEFAULT 'deepagent'
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT,
      chat_jid TEXT,
      sender TEXT,
      sender_name TEXT,
      content TEXT,
      timestamp TEXT,
      is_from_me INTEGER,
      is_bot_message INTEGER DEFAULT 0,
      PRIMARY KEY (id, chat_jid),
      FOREIGN KEY (chat_jid) REFERENCES chats(jid)
    );
    CREATE INDEX IF NOT EXISTS idx_timestamp ON messages(timestamp);
    CREATE INDEX IF NOT EXISTS idx_messages_compound ON messages(chat_jid, timestamp);

    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      group_folder TEXT NOT NULL,
      chat_jid TEXT NOT NULL,
      prompt TEXT NOT NULL,
      schedule_type TEXT NOT NULL,
      schedule_value TEXT NOT NULL,
      next_run TEXT,
      last_run TEXT,
      last_result TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_next_run ON scheduled_tasks(next_run);
    CREATE INDEX IF NOT EXISTS idx_status ON scheduled_tasks(status);

    CREATE TABLE IF NOT EXISTS task_run_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      run_at TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      status TEXT NOT NULL,
      result TEXT,
      error TEXT,
      FOREIGN KEY (task_id) REFERENCES scheduled_tasks(id)
    );
    CREATE INDEX IF NOT EXISTS idx_task_run_logs ON task_run_logs(task_id, run_at);

    CREATE TABLE IF NOT EXISTS router_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      group_folder TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      agent_type TEXT NOT NULL DEFAULT 'deepagent'
    );
    CREATE TABLE IF NOT EXISTS session_skill_bindings (
      chat_jid TEXT NOT NULL,
      skill_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (chat_jid, skill_name)
    );
    CREATE TABLE IF NOT EXISTS session_skill_sync_state (
      chat_jid TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      last_synced_at TEXT,
      error_message TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS registered_groups (
      jid TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      folder TEXT NOT NULL UNIQUE,
      trigger_pattern TEXT NOT NULL,
      added_at TEXT NOT NULL,
      container_config TEXT,
      requires_trigger INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'user',
      display_name TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_login TEXT
    );

    CREATE TABLE IF NOT EXISTS command_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_folder TEXT NOT NULL,
      command TEXT NOT NULL,
      reason TEXT,
      approved INTEGER NOT NULL,
      timestamp TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_group ON command_audit_log(group_folder, timestamp);
  `);

  // Add context_mode column if it doesn't exist (migration for existing DBs)
  try {
    database.exec(
      `ALTER TABLE scheduled_tasks ADD COLUMN context_mode TEXT DEFAULT 'isolated'`,
    );
  } catch {
    /* column already exists */
  }

  // Add is_bot_message column if it doesn't exist (migration for existing DBs)
  try {
    database.exec(
      `ALTER TABLE messages ADD COLUMN is_bot_message INTEGER DEFAULT 0`,
    );
    // Backfill: mark existing bot messages that used the content prefix pattern
    database
      .prepare(`UPDATE messages SET is_bot_message = 1 WHERE content LIKE ?`)
      .run(`${ASSISTANT_NAME}:%`);
  } catch {
    /* column already exists */
  }

  // Add channel and is_group columns if they don't exist (migration for existing DBs)
  try {
    database.exec(`ALTER TABLE chats ADD COLUMN channel TEXT`);
    database.exec(`ALTER TABLE chats ADD COLUMN is_group INTEGER DEFAULT 0`);
    // Backfill from JID patterns
    database.exec(
      `UPDATE chats SET channel = 'discord', is_group = 1 WHERE jid LIKE 'dc:%'`,
    );
    database.exec(
      `UPDATE chats SET channel = 'telegram', is_group = 1 WHERE jid LIKE 'tg:%'`,
    );
  } catch {
    /* columns already exist */
  }

  try {
    database.exec(`ALTER TABLE chats ADD COLUMN user_id TEXT`);
  } catch {
    /* column already exists */
  }

  database.exec(
    `CREATE INDEX IF NOT EXISTS idx_chats_user_id ON chats(user_id)`,
  );

  // Add agent_type column to sessions (migration for existing DBs)
  try {
    database.exec(`ALTER TABLE sessions ADD COLUMN agent_type TEXT NOT NULL DEFAULT 'deepagent'`);
  } catch {
    /* column already exists */
  }

  // Add agent_type column to chats (migration for existing DBs)
  try {
    database.exec(`ALTER TABLE chats ADD COLUMN agent_type TEXT DEFAULT 'deepagent'`);
  } catch {
    /* column already exists */
  }
}

export function initDatabase(): void {
  const dbPath = path.join(STORE_DIR, 'messages.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  db = new Database(dbPath);
  createSchema(db);

  // Migrate from JSON files if they exist
  migrateJsonState();
}

/** @internal - for tests only. Creates a fresh in-memory database. */
export function _initTestDatabase(): void {
  db = new Database(':memory:');
  createSchema(db);
}

/**
 * Store chat metadata only (no message content).
 * Used for all chats to enable group discovery without storing sensitive content.
 */
export function storeChatMetadata(
  chatJid: string,
  timestamp: string,
  name?: string,
  channel?: string,
  isGroup?: boolean,
  userId?: string,
  agentType?: AgentType,
): void {
  const ch = channel ?? null;
  const group = isGroup === undefined ? null : isGroup ? 1 : 0;
  const ownerId = userId ?? null;
  const at = agentType ?? null;

  if (name) {
    // Update with name, preserving existing timestamp if newer
    db.prepare(
      `
      INSERT INTO chats (jid, name, last_message_time, channel, is_group, user_id, agent_type) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(jid) DO UPDATE SET
        name = excluded.name,
        last_message_time = MAX(last_message_time, excluded.last_message_time),
        channel = COALESCE(excluded.channel, channel),
        is_group = COALESCE(excluded.is_group, is_group),
        user_id = COALESCE(excluded.user_id, user_id),
        agent_type = COALESCE(excluded.agent_type, agent_type)
    `,
    ).run(chatJid, name, timestamp, ch, group, ownerId, at);
  } else {
    // Update timestamp only, preserve existing name if any
    db.prepare(
      `
      INSERT INTO chats (jid, name, last_message_time, channel, is_group, user_id, agent_type) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(jid) DO UPDATE SET
        last_message_time = MAX(last_message_time, excluded.last_message_time),
        channel = COALESCE(excluded.channel, channel),
        is_group = COALESCE(excluded.is_group, is_group),
        user_id = COALESCE(excluded.user_id, user_id),
        agent_type = COALESCE(excluded.agent_type, agent_type)
    `,
    ).run(chatJid, chatJid, timestamp, ch, group, ownerId, at);
  }
}

/**
 * Update chat name without changing timestamp for existing chats.
 * New chats get the current time as their initial timestamp.
 * Used during group metadata sync.
 */
export function updateChatName(chatJid: string, name: string): void {
  db.prepare(
    `
    INSERT INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)
    ON CONFLICT(jid) DO UPDATE SET name = excluded.name
  `,
  ).run(chatJid, name, new Date().toISOString());
}

export interface ChatInfo {
  jid: string;
  name: string;
  last_message_time: string;
  last_message: string;
  last_user_message: string;
  channel: string;
  is_group: number;
  agent_type: string | null;
}

function queryChats(whereClause?: string, params: unknown[] = []): ChatInfo[] {
  const where = whereClause ? `WHERE ${whereClause}` : '';
  return db
    .prepare(
      `
    SELECT
      c.jid,
      c.name,
      c.last_message_time,
      c.channel,
      c.is_group,
      c.agent_type,
      (
        SELECT SUBSTR(m.content, 1, 100)
        FROM messages m
        WHERE m.chat_jid = c.jid
        ORDER BY m.timestamp DESC
        LIMIT 1
      ) AS last_message,
      (
        SELECT SUBSTR(m.content, 1, 50)
        FROM messages m
        WHERE m.chat_jid = c.jid AND m.is_bot_message = 0
        ORDER BY m.timestamp DESC
        LIMIT 1
      ) AS last_user_message
    FROM chats c
    ${where}
    ORDER BY c.last_message_time DESC
  `,
    )
    .all(...params) as ChatInfo[];
}

/**
 * Get all known chats, ordered by most recent activity.
 */
export function getAllChats(): ChatInfo[] {
  return queryChats();
}

export function getChatsForUser(userId: string): ChatInfo[] {
  return queryChats('c.user_id = ?', [userId]);
}

export function getChatsByRole(
  userId: string,
  role: 'admin' | 'user',
): ChatInfo[] {
  if (role === 'admin') {
    return getAllChats();
  }
  return getChatsForUser(userId);
}

export function canAccessChat(
  chatJid: string,
  userId: string,
  role: 'admin' | 'user',
): boolean {
  const row =
    role === 'admin'
      ? db.prepare('SELECT 1 FROM chats WHERE jid = ?').get(chatJid)
      : db
          .prepare('SELECT 1 FROM chats WHERE jid = ? AND user_id = ?')
          .get(chatJid, userId);
  return Boolean(row);
}

/**
 * Delete a chat and all its messages.
 */
export function deleteChat(jid: string): void {
  db.transaction(() => {
    db.prepare('DELETE FROM messages WHERE chat_jid = ?').run(jid);
    db.prepare('DELETE FROM chats WHERE jid = ?').run(jid);
  })();
}

/**
 * Clear all messages for a chat (keep the chat entry).
 */
export function clearMessages(chatJid: string): void {
  db.prepare('DELETE FROM messages WHERE chat_jid = ?').run(chatJid);
}

export function deleteChatByRole(
  jid: string,
  userId: string,
  role: 'admin' | 'user',
): boolean {
  if (!canAccessChat(jid, userId, role)) {
    return false;
  }
  deleteChat(jid);
  return true;
}

/**
 * Get timestamp of last group metadata sync.
 */
export function getLastGroupSync(): string | null {
  // Store sync time in a special chat entry
  const row = db
    .prepare(`SELECT last_message_time FROM chats WHERE jid = '__group_sync__'`)
    .get() as { last_message_time: string } | undefined;
  return row?.last_message_time || null;
}

/**
 * Record that group metadata was synced.
 */
export function setLastGroupSync(): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR REPLACE INTO chats (jid, name, last_message_time, user_id) VALUES ('__group_sync__', '__group_sync__', ?, NULL)`,
  ).run(now);
}

/**
 * Store a message with full content.
 * Only call this for registered groups where message history is needed.
 */
export function storeMessage(msg: NewMessage): void {
  db.prepare(
    `INSERT OR REPLACE INTO messages (id, chat_jid, sender, sender_name, content, timestamp, is_from_me, is_bot_message) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    msg.id,
    msg.chat_jid,
    msg.sender,
    msg.sender_name,
    msg.content,
    msg.timestamp,
    msg.is_from_me ? 1 : 0,
    msg.is_bot_message ? 1 : 0,
  );
}

/**
 * Store a message directly (for Web channel and other channels).
 */
export function storeMessageDirect(msg: {
  id: string;
  chat_jid: string;
  sender: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_from_me: boolean;
  is_bot_message?: boolean;
}): void {
  db.prepare(
    `INSERT OR REPLACE INTO messages (id, chat_jid, sender, sender_name, content, timestamp, is_from_me, is_bot_message) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    msg.id,
    msg.chat_jid,
    msg.sender,
    msg.sender_name,
    msg.content,
    msg.timestamp,
    msg.is_from_me ? 1 : 0,
    msg.is_bot_message ? 1 : 0,
  );
}

/** Compound cursor for time-ordered message polling. rowid=0 means "no rowid yet". */
export interface MessageCursor {
  timestamp: string;
  rowid: number;
}

export function getNewMessages(
  jids: string[],
  cursor: string | MessageCursor,
  botPrefix: string,
): { messages: NewMessage[]; newTimestamp: string; newRowid: number } {
  const ts = typeof cursor === 'string' ? cursor : cursor.timestamp;
  const rid = typeof cursor === 'string' ? 0 : cursor.rowid;

  if (jids.length === 0) return { messages: [], newTimestamp: ts, newRowid: rid };

  const placeholders = jids.map(() => '?').join(',');
  // Filter bot messages using both the is_bot_message flag AND the content
  // prefix as a backstop for messages written before the migration ran.
  // Use (timestamp, rowid) compound cursor to avoid missing messages that share
  // the same millisecond timestamp as the last-seen message.
  const rows = (
    rid > 0
      ? db
          .prepare(
            `SELECT rowid, id, chat_jid, sender, sender_name, content, timestamp
             FROM messages
             WHERE (timestamp > ? OR (timestamp = ? AND rowid > ?))
               AND chat_jid IN (${placeholders})
               AND is_bot_message = 0 AND content NOT LIKE ?
               AND content != '' AND content IS NOT NULL
             ORDER BY timestamp ASC, rowid ASC`,
          )
          .all(ts, ts, rid, ...jids, `${botPrefix}:%`)
      : db
          .prepare(
            `SELECT rowid, id, chat_jid, sender, sender_name, content, timestamp
             FROM messages
             WHERE timestamp > ? AND chat_jid IN (${placeholders})
               AND is_bot_message = 0 AND content NOT LIKE ?
               AND content != '' AND content IS NOT NULL
             ORDER BY timestamp ASC, rowid ASC`,
          )
          .all(ts, ...jids, `${botPrefix}:%`)
  ) as (NewMessage & { rowid: number })[];

  let newTimestamp = ts;
  let newRowid = rid;
  for (const row of rows) {
    if (
      row.timestamp > newTimestamp ||
      (row.timestamp === newTimestamp && row.rowid > newRowid)
    ) {
      newTimestamp = row.timestamp;
      newRowid = row.rowid;
    }
  }

  return { messages: rows, newTimestamp, newRowid };
}

export function getMessagesSince(
  chatJid: string,
  cursor: string | MessageCursor,
  botPrefix: string,
): NewMessage[] {
  const ts = typeof cursor === 'string' ? cursor : cursor.timestamp;
  const rid = typeof cursor === 'string' ? 0 : cursor.rowid;

  // Filter bot messages using both the is_bot_message flag AND the content
  // prefix as a backstop for messages written before the migration ran.
  return (
    rid > 0
      ? db
          .prepare(
            `SELECT rowid, id, chat_jid, sender, sender_name, content, timestamp
             FROM messages
             WHERE chat_jid = ? AND (timestamp > ? OR (timestamp = ? AND rowid > ?))
               AND is_bot_message = 0 AND content NOT LIKE ?
               AND content != '' AND content IS NOT NULL
             ORDER BY timestamp ASC, rowid ASC`,
          )
          .all(chatJid, ts, ts, rid, `${botPrefix}:%`)
      : db
          .prepare(
            `SELECT rowid, id, chat_jid, sender, sender_name, content, timestamp
             FROM messages
             WHERE chat_jid = ? AND timestamp > ?
               AND is_bot_message = 0 AND content NOT LIKE ?
               AND content != '' AND content IS NOT NULL
             ORDER BY timestamp ASC, rowid ASC`,
          )
          .all(chatJid, ts, `${botPrefix}:%`)
  ) as NewMessage[];
}

export function getMessagesSinceAll(
  chatJid: string,
  sinceTimestamp: string,
  limit: number = 200,
): NewMessage[] {
  return db
    .prepare(
      `
    SELECT id, chat_jid, sender, sender_name, content, timestamp, is_from_me, is_bot_message
    FROM messages
    WHERE chat_jid = ? AND timestamp > ?
    ORDER BY timestamp
    LIMIT ?
  `,
    )
    .all(chatJid, sinceTimestamp, limit) as NewMessage[];
}

export function getRecentMessages(
  chatJid: string,
  limit: number = 50,
): NewMessage[] {
  return db
    .prepare(
      `
    SELECT id, chat_jid, sender, sender_name, content, timestamp, is_from_me, is_bot_message
    FROM messages
    WHERE chat_jid = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `,
    )
    .all(chatJid, limit)
    .reverse() as NewMessage[];
}

export function createTask(
  task: Omit<ScheduledTask, 'last_run' | 'last_result'>,
): void {
  db.prepare(
    `
    INSERT INTO scheduled_tasks (id, group_folder, chat_jid, prompt, schedule_type, schedule_value, context_mode, next_run, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    task.id,
    task.group_folder,
    task.chat_jid,
    task.prompt,
    task.schedule_type,
    task.schedule_value,
    task.context_mode || 'isolated',
    task.next_run,
    task.status,
    task.created_at,
  );
}

export function getTaskById(id: string): ScheduledTask | undefined {
  return db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id) as
    | ScheduledTask
    | undefined;
}

export function getTasksForGroup(groupFolder: string): ScheduledTask[] {
  return db
    .prepare(
      'SELECT * FROM scheduled_tasks WHERE group_folder = ? ORDER BY created_at DESC',
    )
    .all(groupFolder) as ScheduledTask[];
}

export function getAllTasks(): ScheduledTask[] {
  return db
    .prepare('SELECT * FROM scheduled_tasks ORDER BY created_at DESC')
    .all() as ScheduledTask[];
}

export function updateTask(
  id: string,
  updates: Partial<
    Pick<
      ScheduledTask,
      'prompt' | 'schedule_type' | 'schedule_value' | 'next_run' | 'status'
    >
  >,
): void {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.prompt !== undefined) {
    fields.push('prompt = ?');
    values.push(updates.prompt);
  }
  if (updates.schedule_type !== undefined) {
    fields.push('schedule_type = ?');
    values.push(updates.schedule_type);
  }
  if (updates.schedule_value !== undefined) {
    fields.push('schedule_value = ?');
    values.push(updates.schedule_value);
  }
  if (updates.next_run !== undefined) {
    fields.push('next_run = ?');
    values.push(updates.next_run);
  }
  if (updates.status !== undefined) {
    fields.push('status = ?');
    values.push(updates.status);
  }

  if (fields.length === 0) return;

  values.push(id);
  db.prepare(
    `UPDATE scheduled_tasks SET ${fields.join(', ')} WHERE id = ?`,
  ).run(...values);
}

export function deleteTask(id: string): void {
  // Delete child records first (FK constraint)
  db.prepare('DELETE FROM task_run_logs WHERE task_id = ?').run(id);
  db.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(id);
}

export function deleteRegisteredGroup(jid: string): void {
  db.prepare('DELETE FROM registered_groups WHERE jid = ?').run(jid);
}

export function deleteTasksForChatJid(chatJid: string): void {
  const tasks = db
    .prepare('SELECT id FROM scheduled_tasks WHERE chat_jid = ?')
    .all(chatJid) as Array<{ id: string }>;
  db.transaction(() => {
    for (const task of tasks) {
      db.prepare('DELETE FROM task_run_logs WHERE task_id = ?').run(task.id);
    }
    db.prepare('DELETE FROM scheduled_tasks WHERE chat_jid = ?').run(chatJid);
  })();
}

export function getDueTasks(): ScheduledTask[] {
  const now = new Date().toISOString();
  return db
    .prepare(
      `
    SELECT * FROM scheduled_tasks
    WHERE status = 'active' AND next_run IS NOT NULL AND next_run <= ?
    ORDER BY next_run
  `,
    )
    .all(now) as ScheduledTask[];
}

export function updateTaskAfterRun(
  id: string,
  nextRun: string | null,
  lastResult: string,
): void {
  const now = new Date().toISOString();
  db.prepare(
    `
    UPDATE scheduled_tasks
    SET next_run = ?, last_run = ?, last_result = ?, status = CASE WHEN ? IS NULL THEN 'completed' ELSE status END
    WHERE id = ?
  `,
  ).run(nextRun, now, lastResult, nextRun, id);
}

export function logTaskRun(log: TaskRunLog): void {
  db.prepare(
    `
    INSERT INTO task_run_logs (task_id, run_at, duration_ms, status, result, error)
    VALUES (?, ?, ?, ?, ?, ?)
  `,
  ).run(
    log.task_id,
    log.run_at,
    log.duration_ms,
    log.status,
    log.result,
    log.error,
  );
}

// --- Router state accessors ---

export function getRouterState(key: string): string | undefined {
  const row = db
    .prepare('SELECT value FROM router_state WHERE key = ?')
    .get(key) as { value: string } | undefined;
  return row?.value;
}

export function setRouterState(key: string, value: string): void {
  db.prepare(
    'INSERT OR REPLACE INTO router_state (key, value) VALUES (?, ?)',
  ).run(key, value);
}

// --- Session accessors ---

export interface SessionInfo {
  sessionId: string;
  agentType: AgentType;
}

export function getSession(groupFolder: string): SessionInfo | null {
  const row = db
    .prepare('SELECT session_id, agent_type FROM sessions WHERE group_folder = ?')
    .get(groupFolder) as { session_id: string; agent_type: string } | undefined;
  if (!row) return null;
  return { sessionId: row.session_id, agentType: (row.agent_type || 'deepagent') as AgentType };
}

export function setSession(groupFolder: string, sessionId: string, agentType: AgentType = 'deepagent'): void {
  db.prepare(
    'INSERT OR REPLACE INTO sessions (group_folder, session_id, agent_type) VALUES (?, ?, ?)',
  ).run(groupFolder, sessionId, agentType);
}

export function deleteSession(groupFolder: string): void {
  db.prepare('DELETE FROM sessions WHERE group_folder = ?').run(groupFolder);
}

export function getAllSessions(): Record<string, SessionInfo> {
  const rows = db
    .prepare('SELECT group_folder, session_id, agent_type FROM sessions')
    .all() as Array<{ group_folder: string; session_id: string; agent_type: string }>;
  const result: Record<string, SessionInfo> = {};
  for (const row of rows) {
    result[row.group_folder] = {
      sessionId: row.session_id,
      agentType: (row.agent_type || 'deepagent') as AgentType,
    };
  }
  return result;
}

// --- Web chat skill accessors ---

export function getSessionSkillBindings(chatJid: string): string[] {
  const rows = db
    .prepare(
      'SELECT skill_name FROM session_skill_bindings WHERE chat_jid = ? ORDER BY skill_name ASC',
    )
    .all(chatJid) as Array<{ skill_name: string }>;
  return rows.map((row) => row.skill_name);
}

export function replaceSessionSkillBindings(
  chatJid: string,
  skills: string[],
): void {
  const now = new Date().toISOString();
  const normalizedSkills = Array.from(new Set(skills)).sort((a, b) =>
    a.localeCompare(b),
  );

  const deleteStmt = db.prepare(
    'DELETE FROM session_skill_bindings WHERE chat_jid = ?',
  );
  const insertStmt = db.prepare(
    `INSERT INTO session_skill_bindings (chat_jid, skill_name, created_at, updated_at)
     VALUES (?, ?, ?, ?)`,
  );

  const tx = db.transaction((dedupedSkills: string[]) => {
    deleteStmt.run(chatJid);
    for (const skill of dedupedSkills) {
      insertStmt.run(chatJid, skill, now, now);
    }
  });

  tx(normalizedSkills);
}

export function getSessionSkillSyncState(
  chatJid: string,
): SessionSkillSyncState | null {
  const row = db
    .prepare(
      `SELECT chat_jid, status, last_synced_at, error_message, updated_at
       FROM session_skill_sync_state
       WHERE chat_jid = ?`,
    )
    .get(chatJid) as SessionSkillSyncState | undefined;
  return row ?? null;
}

export function setSessionSkillSyncState(
  chatJid: string,
  input: {
    status: SessionSkillSyncStatus;
    lastSyncedAt?: string | null;
    errorMessage?: string | null;
  },
): void {
  const now = new Date().toISOString();
  const lastSyncedAt =
    input.lastSyncedAt === undefined ? null : input.lastSyncedAt;
  const errorMessage =
    input.errorMessage === undefined ? null : input.errorMessage;

  db.prepare(
    `INSERT INTO session_skill_sync_state (
       chat_jid,
       status,
       last_synced_at,
       error_message,
       updated_at
     ) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(chat_jid) DO UPDATE SET
       status = excluded.status,
       last_synced_at = excluded.last_synced_at,
       error_message = excluded.error_message,
       updated_at = excluded.updated_at`,
  ).run(chatJid, input.status, lastSyncedAt, errorMessage, now);
}

export function deleteSessionSkillData(chatJid: string): void {
  const deleteBindingsStmt = db.prepare(
    'DELETE FROM session_skill_bindings WHERE chat_jid = ?',
  );
  const deleteSyncStateStmt = db.prepare(
    'DELETE FROM session_skill_sync_state WHERE chat_jid = ?',
  );

  const tx = db.transaction(() => {
    deleteBindingsStmt.run(chatJid);
    deleteSyncStateStmt.run(chatJid);
  });

  tx();
}

export function getChatJidsBoundToSkill(skillName: string): string[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT chat_jid
       FROM session_skill_bindings
       WHERE skill_name = ?
       ORDER BY chat_jid ASC`,
    )
    .all(skillName) as Array<{ chat_jid: string }>;
  return rows.map((row) => row.chat_jid);
}

export function renameBoundSkill(oldName: string, newName: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE session_skill_bindings
     SET skill_name = ?, updated_at = ?
     WHERE skill_name = ?`,
  ).run(newName, now, oldName);
}

export function removeSkillFromAllChats(skillName: string): string[] {
  const affectedChatJids = getChatJidsBoundToSkill(skillName);
  db.prepare('DELETE FROM session_skill_bindings WHERE skill_name = ?').run(
    skillName,
  );
  return affectedChatJids;
}

// --- Registered group accessors ---

export function getRegisteredGroup(
  jid: string,
): (RegisteredGroup & { jid: string }) | undefined {
  const row = db
    .prepare('SELECT * FROM registered_groups WHERE jid = ?')
    .get(jid) as
    | {
        jid: string;
        name: string;
        folder: string;
        trigger_pattern: string;
        added_at: string;
        container_config: string | null;
        requires_trigger: number | null;
      }
    | undefined;
  if (!row) return undefined;
  if (!isValidGroupFolder(row.folder)) {
    logger.warn(
      { jid: row.jid, folder: row.folder },
      'Skipping registered group with invalid folder',
    );
    return undefined;
  }
  return {
    jid: row.jid,
    name: row.name,
    folder: row.folder,
    trigger: row.trigger_pattern,
    added_at: row.added_at,
    containerConfig: row.container_config
      ? JSON.parse(row.container_config)
      : undefined,
    requiresTrigger:
      row.requires_trigger === null ? undefined : row.requires_trigger === 1,
  };
}

export function setRegisteredGroup(jid: string, group: RegisteredGroup): void {
  if (!isValidGroupFolder(group.folder)) {
    throw new Error(`Invalid group folder "${group.folder}" for JID ${jid}`);
  }
  db.prepare(
    `INSERT OR REPLACE INTO registered_groups (jid, name, folder, trigger_pattern, added_at, container_config, requires_trigger)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    jid,
    group.name,
    group.folder,
    group.trigger,
    group.added_at,
    group.containerConfig ? JSON.stringify(group.containerConfig) : null,
    group.requiresTrigger === undefined ? 1 : group.requiresTrigger ? 1 : 0,
  );
}

export function getAllRegisteredGroups(): Record<string, RegisteredGroup> {
  const rows = db.prepare('SELECT * FROM registered_groups').all() as Array<{
    jid: string;
    name: string;
    folder: string;
    trigger_pattern: string;
    added_at: string;
    container_config: string | null;
    requires_trigger: number | null;
  }>;
  const result: Record<string, RegisteredGroup> = {};
  for (const row of rows) {
    if (!isValidGroupFolder(row.folder)) {
      logger.warn(
        { jid: row.jid, folder: row.folder },
        'Skipping registered group with invalid folder',
      );
      continue;
    }
    result[row.jid] = {
      name: row.name,
      folder: row.folder,
      trigger: row.trigger_pattern,
      added_at: row.added_at,
      containerConfig: row.container_config
        ? JSON.parse(row.container_config)
        : undefined,
      requiresTrigger:
        row.requires_trigger === null ? undefined : row.requires_trigger === 1,
    };
  }
  return result;
}

// --- JSON migration ---

function migrateJsonState(): void {
  const migrateFile = (filename: string) => {
    const filePath = path.join(DATA_DIR, filename);
    if (!fs.existsSync(filePath)) return null;
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      fs.renameSync(filePath, `${filePath}.migrated`);
      return data;
    } catch {
      return null;
    }
  };

  // Migrate router_state.json
  const routerState = migrateFile('router_state.json') as {
    last_timestamp?: string;
    last_agent_timestamp?: Record<string, string>;
  } | null;
  if (routerState) {
    if (routerState.last_timestamp) {
      setRouterState('last_timestamp', routerState.last_timestamp);
    }
    if (routerState.last_agent_timestamp) {
      setRouterState(
        'last_agent_timestamp',
        JSON.stringify(routerState.last_agent_timestamp),
      );
    }
  }

  // Migrate sessions.json
  const sessions = migrateFile('sessions.json') as Record<
    string,
    string
  > | null;
  if (sessions) {
    for (const [folder, sessionId] of Object.entries(sessions)) {
      setSession(folder, sessionId);
    }
  }

  // Migrate registered_groups.json
  const groups = migrateFile('registered_groups.json') as Record<
    string,
    RegisteredGroup
  > | null;
  if (groups) {
    for (const [jid, group] of Object.entries(groups)) {
      try {
        setRegisteredGroup(jid, group);
      } catch (err) {
        logger.warn(
          { jid, folder: group.folder, err },
          'Skipping migrated registered group with invalid folder',
        );
      }
    }
  }
}

// --- User types ---

export interface User {
  id: string;
  username: string;
  password_hash: string;
  role: 'admin' | 'user';
  display_name: string | null;
  created_at: string;
  updated_at: string;
  last_login: string | null;
}

export interface UserWithoutPassword {
  id: string;
  username: string;
  role: 'admin' | 'user';
  display_name: string | null;
  created_at: string;
  updated_at: string;
  last_login: string | null;
}

// --- User operations ---

export function createUser(user: {
  id: string;
  username: string;
  password_hash: string;
  role?: 'admin' | 'user';
  display_name?: string;
}): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (id, username, password_hash, role, display_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    user.id,
    user.username,
    user.password_hash,
    user.role || 'user',
    user.display_name || null,
    now,
    now,
  );
}

export function getUserByUsername(username: string): User | undefined {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username) as
    | User
    | undefined;
}

export function getUserById(id: string): User | undefined {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as
    | User
    | undefined;
}

export function getAllUsers(): UserWithoutPassword[] {
  return db
    .prepare(
      'SELECT id, username, role, display_name, created_at, updated_at, last_login FROM users ORDER BY created_at DESC',
    )
    .all() as UserWithoutPassword[];
}

export function updateUser(
  id: string,
  updates: {
    username?: string;
    role?: 'admin' | 'user';
    display_name?: string;
  },
): void {
  const fields: string[] = ['updated_at = ?'];
  const values: unknown[] = [new Date().toISOString()];

  if (updates.username !== undefined) {
    fields.push('username = ?');
    values.push(updates.username);
  }
  if (updates.role !== undefined) {
    fields.push('role = ?');
    values.push(updates.role);
  }
  if (updates.display_name !== undefined) {
    fields.push('display_name = ?');
    values.push(updates.display_name);
  }

  values.push(id);
  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(
    ...values,
  );
}

export function updateUserPassword(id: string, passwordHash: string): void {
  db.prepare(
    'UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?',
  ).run(passwordHash, new Date().toISOString(), id);
}

export function updateUserLastLogin(id: string): void {
  db.prepare('UPDATE users SET last_login = ? WHERE id = ?').run(
    new Date().toISOString(),
    id,
  );
}

export function deleteUser(id: string): void {
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
}

// --- Command audit log ---

export function insertCommandAuditLog(entry: {
  group_folder: string;
  command: string;
  reason?: string;
  approved: boolean;
}): void {
  db.prepare(
    `INSERT INTO command_audit_log (group_folder, command, reason, approved, timestamp)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    entry.group_folder,
    entry.command,
    entry.reason ?? null,
    entry.approved ? 1 : 0,
    new Date().toISOString(),
  );
}
