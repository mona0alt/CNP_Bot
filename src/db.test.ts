import { describe, it, expect, beforeEach } from 'vitest';

import {
  _initTestDatabase,
  createTask,
  canAccessChat,
  clearMessages,
  deleteChatByRole,
  deleteSessionSkillData,
  deleteRegisteredGroup,
  deleteSession,
  deleteTask,
  getAllChats,
  getAllRegisteredGroups,
  getAllSessions,
  getChatsByRole,
  getDueTasks,
  getMessagesSince,
  getNewMessages,
  getRegisteredGroup,
  getRouterState,
  getSession,
  getSessionSkillBindings,
  getSessionSkillSyncState,
  getTaskById,
  logTaskRun,
  replaceSessionSkillBindings,
  setRegisteredGroup,
  setRouterState,
  setSession,
  setSessionSkillSyncState,
  storeChatMetadata,
  storeMessage,
  storeMessageDirect,
  updateTask,
  updateTaskAfterRun,
} from './db.js';

beforeEach(() => {
  _initTestDatabase();
});

// Helper to store a message using the normalized NewMessage interface
function store(overrides: {
  id: string;
  chat_jid: string;
  sender: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_from_me?: boolean;
}) {
  storeMessage({
    id: overrides.id,
    chat_jid: overrides.chat_jid,
    sender: overrides.sender,
    sender_name: overrides.sender_name,
    content: overrides.content,
    timestamp: overrides.timestamp,
    is_from_me: overrides.is_from_me ?? false,
  });
}

// --- storeMessage (NewMessage format) ---

describe('storeMessage', () => {
  it('stores a message and retrieves it', () => {
    storeChatMetadata('group@g.us', '2024-01-01T00:00:00.000Z');

    store({
      id: 'msg-1',
      chat_jid: 'group@g.us',
      sender: '123@s.whatsapp.net',
      sender_name: 'Alice',
      content: 'hello world',
      timestamp: '2024-01-01T00:00:01.000Z',
    });

    const messages = getMessagesSince('group@g.us', '2024-01-01T00:00:00.000Z', 'Andy');
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe('msg-1');
    expect(messages[0].sender).toBe('123@s.whatsapp.net');
    expect(messages[0].sender_name).toBe('Alice');
    expect(messages[0].content).toBe('hello world');
  });

  it('filters out empty content', () => {
    storeChatMetadata('group@g.us', '2024-01-01T00:00:00.000Z');

    store({
      id: 'msg-2',
      chat_jid: 'group@g.us',
      sender: '111@s.whatsapp.net',
      sender_name: 'Dave',
      content: '',
      timestamp: '2024-01-01T00:00:04.000Z',
    });

    const messages = getMessagesSince('group@g.us', '2024-01-01T00:00:00.000Z', 'Andy');
    expect(messages).toHaveLength(0);
  });

  it('stores is_from_me flag', () => {
    storeChatMetadata('group@g.us', '2024-01-01T00:00:00.000Z');

    store({
      id: 'msg-3',
      chat_jid: 'group@g.us',
      sender: 'me@s.whatsapp.net',
      sender_name: 'Me',
      content: 'my message',
      timestamp: '2024-01-01T00:00:05.000Z',
      is_from_me: true,
    });

    // Message is stored (we can retrieve it — is_from_me doesn't affect retrieval)
    const messages = getMessagesSince('group@g.us', '2024-01-01T00:00:00.000Z', 'Andy');
    expect(messages).toHaveLength(1);
  });

  it('upserts on duplicate id+chat_jid', () => {
    storeChatMetadata('group@g.us', '2024-01-01T00:00:00.000Z');

    store({
      id: 'msg-dup',
      chat_jid: 'group@g.us',
      sender: '123@s.whatsapp.net',
      sender_name: 'Alice',
      content: 'original',
      timestamp: '2024-01-01T00:00:01.000Z',
    });

    store({
      id: 'msg-dup',
      chat_jid: 'group@g.us',
      sender: '123@s.whatsapp.net',
      sender_name: 'Alice',
      content: 'updated',
      timestamp: '2024-01-01T00:00:01.000Z',
    });

    const messages = getMessagesSince('group@g.us', '2024-01-01T00:00:00.000Z', 'Andy');
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('updated');
  });
});

// --- getMessagesSince ---

describe('getMessagesSince', () => {
  beforeEach(() => {
    storeChatMetadata('group@g.us', '2024-01-01T00:00:00.000Z');

    store({
      id: 'm1', chat_jid: 'group@g.us', sender: 'Alice@s.whatsapp.net',
      sender_name: 'Alice', content: 'first', timestamp: '2024-01-01T00:00:01.000Z',
    });
    store({
      id: 'm2', chat_jid: 'group@g.us', sender: 'Bob@s.whatsapp.net',
      sender_name: 'Bob', content: 'second', timestamp: '2024-01-01T00:00:02.000Z',
    });
    storeMessage({
      id: 'm3', chat_jid: 'group@g.us', sender: 'Bot@s.whatsapp.net',
      sender_name: 'Bot', content: 'bot reply', timestamp: '2024-01-01T00:00:03.000Z',
      is_bot_message: true,
    });
    store({
      id: 'm4', chat_jid: 'group@g.us', sender: 'Carol@s.whatsapp.net',
      sender_name: 'Carol', content: 'third', timestamp: '2024-01-01T00:00:04.000Z',
    });
  });

  it('returns messages after the given timestamp', () => {
    const msgs = getMessagesSince('group@g.us', '2024-01-01T00:00:02.000Z', 'Andy');
    // Should exclude m1, m2 (before/at timestamp), m3 (bot message)
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe('third');
  });

  it('excludes bot messages via is_bot_message flag', () => {
    const msgs = getMessagesSince('group@g.us', '2024-01-01T00:00:00.000Z', 'Andy');
    const botMsgs = msgs.filter((m) => m.content === 'bot reply');
    expect(botMsgs).toHaveLength(0);
  });

  it('returns all non-bot messages when sinceTimestamp is empty', () => {
    const msgs = getMessagesSince('group@g.us', '', 'Andy');
    // 3 user messages (bot message excluded)
    expect(msgs).toHaveLength(3);
  });

  it('filters pre-migration bot messages via content prefix backstop', () => {
    // Simulate a message written before migration: has prefix but is_bot_message = 0
    store({
      id: 'm5', chat_jid: 'group@g.us', sender: 'Bot@s.whatsapp.net',
      sender_name: 'Bot', content: 'Andy: old bot reply',
      timestamp: '2024-01-01T00:00:05.000Z',
    });
    const msgs = getMessagesSince('group@g.us', '2024-01-01T00:00:04.000Z', 'Andy');
    expect(msgs).toHaveLength(0);
  });
});

// --- getNewMessages ---

describe('getNewMessages', () => {
  beforeEach(() => {
    storeChatMetadata('group1@g.us', '2024-01-01T00:00:00.000Z');
    storeChatMetadata('group2@g.us', '2024-01-01T00:00:00.000Z');

    store({
      id: 'a1', chat_jid: 'group1@g.us', sender: 'user@s.whatsapp.net',
      sender_name: 'User', content: 'g1 msg1', timestamp: '2024-01-01T00:00:01.000Z',
    });
    store({
      id: 'a2', chat_jid: 'group2@g.us', sender: 'user@s.whatsapp.net',
      sender_name: 'User', content: 'g2 msg1', timestamp: '2024-01-01T00:00:02.000Z',
    });
    storeMessage({
      id: 'a3', chat_jid: 'group1@g.us', sender: 'user@s.whatsapp.net',
      sender_name: 'User', content: 'bot reply', timestamp: '2024-01-01T00:00:03.000Z',
      is_bot_message: true,
    });
    store({
      id: 'a4', chat_jid: 'group1@g.us', sender: 'user@s.whatsapp.net',
      sender_name: 'User', content: 'g1 msg2', timestamp: '2024-01-01T00:00:04.000Z',
    });
  });

  it('returns new messages across multiple groups', () => {
    const { messages, newTimestamp } = getNewMessages(
      ['group1@g.us', 'group2@g.us'],
      '2024-01-01T00:00:00.000Z',
      'Andy',
    );
    // Excludes bot message, returns 3 user messages
    expect(messages).toHaveLength(3);
    expect(newTimestamp).toBe('2024-01-01T00:00:04.000Z');
  });

  it('filters by timestamp', () => {
    const { messages } = getNewMessages(
      ['group1@g.us', 'group2@g.us'],
      '2024-01-01T00:00:02.000Z',
      'Andy',
    );
    // Only g1 msg2 (after ts, not bot)
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('g1 msg2');
  });

  it('returns empty for no registered groups', () => {
    const { messages, newTimestamp } = getNewMessages([], '', 'Andy');
    expect(messages).toHaveLength(0);
    expect(newTimestamp).toBe('');
  });
});

// --- storeChatMetadata ---

describe('storeChatMetadata', () => {
  it('stores chat with JID as default name', () => {
    storeChatMetadata('group@g.us', '2024-01-01T00:00:00.000Z');
    const chats = getAllChats();
    expect(chats).toHaveLength(1);
    expect(chats[0].jid).toBe('group@g.us');
    expect(chats[0].name).toBe('group@g.us');
  });

  it('stores chat with explicit name', () => {
    storeChatMetadata('group@g.us', '2024-01-01T00:00:00.000Z', 'My Group');
    const chats = getAllChats();
    expect(chats[0].name).toBe('My Group');
  });

  it('updates name on subsequent call with name', () => {
    storeChatMetadata('group@g.us', '2024-01-01T00:00:00.000Z');
    storeChatMetadata('group@g.us', '2024-01-01T00:00:01.000Z', 'Updated Name');
    const chats = getAllChats();
    expect(chats).toHaveLength(1);
    expect(chats[0].name).toBe('Updated Name');
  });

  it('preserves newer timestamp on conflict', () => {
    storeChatMetadata('group@g.us', '2024-01-01T00:00:05.000Z');
    storeChatMetadata('group@g.us', '2024-01-01T00:00:01.000Z');
    const chats = getAllChats();
    expect(chats[0].last_message_time).toBe('2024-01-01T00:00:05.000Z');
  });
});

describe('chat RBAC accessors', () => {
  beforeEach(() => {
    storeChatMetadata('web:user-a', '2024-01-01T00:00:00.000Z', 'A Chat', 'web', false, 'user-a');
    storeChatMetadata('web:user-b', '2024-01-01T00:00:00.000Z', 'B Chat', 'web', false, 'user-b');
    storeChatMetadata('group@g.us', '2024-01-01T00:00:00.000Z', 'Group', 'web', true);
  });

  it('returns only owned chats for user role', () => {
    const chats = getChatsByRole('user-a', 'user');
    expect(chats).toHaveLength(1);
    expect(chats[0].jid).toBe('web:user-a');
  });

  it('returns all chats for admin role', () => {
    const chats = getChatsByRole('admin-id', 'admin');
    expect(chats).toHaveLength(3);
  });

  it('checks access by role and ownership', () => {
    expect(canAccessChat('web:user-a', 'user-a', 'user')).toBe(true);
    expect(canAccessChat('web:user-a', 'user-b', 'user')).toBe(false);
    expect(canAccessChat('web:user-a', 'admin-id', 'admin')).toBe(true);
  });

  it('deletes only when role has access', () => {
    expect(deleteChatByRole('web:user-a', 'user-b', 'user')).toBe(false);
    expect(deleteChatByRole('web:user-a', 'user-a', 'user')).toBe(true);
    expect(canAccessChat('web:user-a', 'admin-id', 'admin')).toBe(false);
  });
});

describe('session skill accessors', () => {
  it('stores and replaces session skill bindings', () => {
    replaceSessionSkillBindings('web:test', ['tmux', 'prometheus']);
    expect(getSessionSkillBindings('web:test')).toEqual([
      'prometheus',
      'tmux',
    ]);

    replaceSessionSkillBindings('web:test', ['jumpserver']);
    expect(getSessionSkillBindings('web:test')).toEqual(['jumpserver']);
  });

  it('stores sync state and clears skill data when chat is deleted', () => {
    replaceSessionSkillBindings('web:test', ['tmux']);

    setSessionSkillSyncState('web:test', {
      status: 'failed',
      errorMessage: 'copy failed',
    });

    expect(getSessionSkillSyncState('web:test')).toMatchObject({
      chat_jid: 'web:test',
      status: 'failed',
      error_message: 'copy failed',
    });

    deleteSessionSkillData('web:test');

    expect(getSessionSkillBindings('web:test')).toEqual([]);
    expect(getSessionSkillSyncState('web:test')).toBeNull();
  });
});

// --- Task CRUD ---

describe('task CRUD', () => {
  it('creates and retrieves a task', () => {
    createTask({
      id: 'task-1',
      group_folder: 'main',
      chat_jid: 'group@g.us',
      prompt: 'do something',
      schedule_type: 'once',
      schedule_value: '2024-06-01T00:00:00.000Z',
      context_mode: 'isolated',
      next_run: '2024-06-01T00:00:00.000Z',
      status: 'active',
      created_at: '2024-01-01T00:00:00.000Z',
    });

    const task = getTaskById('task-1');
    expect(task).toBeDefined();
    expect(task!.prompt).toBe('do something');
    expect(task!.status).toBe('active');
  });

  it('updates task status', () => {
    createTask({
      id: 'task-2',
      group_folder: 'main',
      chat_jid: 'group@g.us',
      prompt: 'test',
      schedule_type: 'once',
      schedule_value: '2024-06-01T00:00:00.000Z',
      context_mode: 'isolated',
      next_run: null,
      status: 'active',
      created_at: '2024-01-01T00:00:00.000Z',
    });

    updateTask('task-2', { status: 'paused' });
    expect(getTaskById('task-2')!.status).toBe('paused');
  });

  it('deletes a task and its run logs', () => {
    createTask({
      id: 'task-3',
      group_folder: 'main',
      chat_jid: 'group@g.us',
      prompt: 'delete me',
      schedule_type: 'once',
      schedule_value: '2024-06-01T00:00:00.000Z',
      context_mode: 'isolated',
      next_run: null,
      status: 'active',
      created_at: '2024-01-01T00:00:00.000Z',
    });

    deleteTask('task-3');
    expect(getTaskById('task-3')).toBeUndefined();
  });
});

// --- sessions ---

describe('sessions', () => {
  it('returns null for missing session', () => {
    expect(getSession('nonexistent')).toBeNull();
  });

  it('stores and retrieves a session (default agentType)', () => {
    setSession('main', 'sess-abc-123');
    expect(getSession('main')).toEqual({ sessionId: 'sess-abc-123', agentType: 'deepagent' });
  });

  it('overwrites on re-set', () => {
    setSession('main', 'old-id');
    setSession('main', 'new-id');
    expect(getSession('main')).toEqual({ sessionId: 'new-id', agentType: 'deepagent' });
  });

  it('returns all sessions as a map', () => {
    setSession('main', 'sess-1');
    setSession('other', 'sess-2', 'claude');
    const all = getAllSessions();
    expect(all).toEqual({
      main: { sessionId: 'sess-1', agentType: 'deepagent' },
      other: { sessionId: 'sess-2', agentType: 'claude' },
    });
  });

  it('deletes a session', () => {
    setSession('main', 'sess-del');
    deleteSession('main');
    expect(getSession('main')).toBeNull();
  });

  it('stores deepagent type explicitly', () => {
    setSession('g1', 's1', 'deepagent');
    expect(getSession('g1')).toEqual({ sessionId: 's1', agentType: 'deepagent' });
  });

  it('stores claude type', () => {
    setSession('g2', 's2', 'claude');
    expect(getSession('g2')).toEqual({ sessionId: 's2', agentType: 'claude' });
  });
});

// --- router state ---

describe('router state', () => {
  it('returns undefined for missing key', () => {
    expect(getRouterState('no_such_key')).toBeUndefined();
  });

  it('stores and retrieves a value', () => {
    setRouterState('last_timestamp', '2024-01-01T00:00:00.000Z');
    expect(getRouterState('last_timestamp')).toBe('2024-01-01T00:00:00.000Z');
  });

  it('overwrites on re-set', () => {
    setRouterState('mykey', 'first');
    setRouterState('mykey', 'second');
    expect(getRouterState('mykey')).toBe('second');
  });

  it('stores JSON string values', () => {
    const payload = JSON.stringify({ a: 1, b: '2' });
    setRouterState('json_key', payload);
    const retrieved = getRouterState('json_key');
    expect(retrieved).toBe(payload);
    expect(JSON.parse(retrieved!)).toEqual({ a: 1, b: '2' });
  });
});

// --- registered groups ---

describe('registered groups', () => {
  const base = {
    name: 'Test Group',
    folder: 'testgroup',
    trigger: '@Bot',
    added_at: '2024-01-01T00:00:00.000Z',
  };

  it('returns undefined for missing group', () => {
    expect(getRegisteredGroup('unknown@g.us')).toBeUndefined();
  });

  it('stores and retrieves a group', () => {
    setRegisteredGroup('group@g.us', base);
    const g = getRegisteredGroup('group@g.us');
    expect(g).toBeDefined();
    expect(g!.name).toBe('Test Group');
    expect(g!.folder).toBe('testgroup');
    expect(g!.trigger).toBe('@Bot');
  });

  it('stores and retrieves requires_trigger flag', () => {
    setRegisteredGroup('group@g.us', { ...base, requiresTrigger: false });
    const g = getRegisteredGroup('group@g.us');
    expect(g!.requiresTrigger).toBe(false);
  });

  it('round-trips container_config JSON', () => {
    const config = { additionalMounts: [{ hostPath: '/data', readonly: true }], timeout: 60000 };
    setRegisteredGroup('group@g.us', { ...base, containerConfig: config });
    const g = getRegisteredGroup('group@g.us');
    expect(g!.containerConfig).toEqual(config);
  });

  it('returns all registered groups', () => {
    setRegisteredGroup('g1@g.us', { ...base, folder: 'g1group', name: 'G1' });
    setRegisteredGroup('g2@g.us', { ...base, folder: 'g2group', name: 'G2' });
    const all = getAllRegisteredGroups();
    expect(Object.keys(all)).toHaveLength(2);
    expect(all['g1@g.us'].name).toBe('G1');
    expect(all['g2@g.us'].name).toBe('G2');
  });

  it('deletes a registered group', () => {
    setRegisteredGroup('group@g.us', base);
    deleteRegisteredGroup('group@g.us');
    expect(getRegisteredGroup('group@g.us')).toBeUndefined();
  });

  it('rejects invalid folder name', () => {
    expect(() =>
      setRegisteredGroup('group@g.us', { ...base, folder: '../../bad' }),
    ).toThrow();
  });
});

// --- getDueTasks ---

describe('getDueTasks', () => {
  function makeTask(id: string, nextRun: string | null, status: string) {
    createTask({
      id,
      group_folder: 'main',
      chat_jid: 'group@g.us',
      prompt: 'test',
      schedule_type: 'once',
      schedule_value: '2024-06-01T00:00:00.000Z',
      context_mode: 'isolated',
      next_run: nextRun,
      status: status as 'active' | 'paused' | 'completed',
      created_at: '2024-01-01T00:00:00.000Z',
    });
  }

  it('returns active tasks whose next_run is in the past', () => {
    makeTask('t-due', '2020-01-01T00:00:00.000Z', 'active');
    const due = getDueTasks();
    expect(due.map((t) => t.id)).toContain('t-due');
  });

  it('excludes paused tasks', () => {
    makeTask('t-paused', '2020-01-01T00:00:00.000Z', 'paused');
    const due = getDueTasks();
    expect(due.map((t) => t.id)).not.toContain('t-paused');
  });

  it('excludes completed tasks', () => {
    makeTask('t-done', '2020-01-01T00:00:00.000Z', 'completed');
    const due = getDueTasks();
    expect(due.map((t) => t.id)).not.toContain('t-done');
  });

  it('excludes tasks with future next_run', () => {
    makeTask('t-future', '2099-12-31T23:59:59.000Z', 'active');
    const due = getDueTasks();
    expect(due.map((t) => t.id)).not.toContain('t-future');
  });

  it('excludes tasks with null next_run', () => {
    makeTask('t-null', null, 'active');
    const due = getDueTasks();
    expect(due.map((t) => t.id)).not.toContain('t-null');
  });
});

// --- clearMessages ---

describe('clearMessages', () => {
  beforeEach(() => {
    storeChatMetadata('chat-a@g.us', '2024-01-01T00:00:00.000Z');
    storeChatMetadata('chat-b@g.us', '2024-01-01T00:00:00.000Z');

    storeMessage({
      id: 'ma1', chat_jid: 'chat-a@g.us', sender: 'u@s.whatsapp.net',
      sender_name: 'U', content: 'msg in A', timestamp: '2024-01-01T00:00:01.000Z',
    });
    storeMessage({
      id: 'mb1', chat_jid: 'chat-b@g.us', sender: 'u@s.whatsapp.net',
      sender_name: 'U', content: 'msg in B', timestamp: '2024-01-01T00:00:01.000Z',
    });
  });

  it('removes messages for the target chat', () => {
    clearMessages('chat-a@g.us');
    const msgs = getMessagesSince('chat-a@g.us', '', 'Bot');
    expect(msgs).toHaveLength(0);
  });

  it('leaves messages for other chats untouched', () => {
    clearMessages('chat-a@g.us');
    const msgs = getMessagesSince('chat-b@g.us', '', 'Bot');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe('msg in B');
  });
});

// --- logTaskRun / updateTaskAfterRun ---

describe('logTaskRun and updateTaskAfterRun', () => {
  beforeEach(() => {
    createTask({
      id: 'run-task',
      group_folder: 'main',
      chat_jid: 'group@g.us',
      prompt: 'do work',
      schedule_type: 'interval',
      schedule_value: '60',
      context_mode: 'isolated',
      next_run: '2024-01-01T00:01:00.000Z',
      status: 'active',
      created_at: '2024-01-01T00:00:00.000Z',
    });
  });

  it('logTaskRun stores a run log entry', () => {
    logTaskRun({
      task_id: 'run-task',
      run_at: '2024-01-01T00:01:00.000Z',
      duration_ms: 1234,
      status: 'success',
      result: 'all done',
      error: null,
    });
    // Verify the task still exists after logging
    expect(getTaskById('run-task')).toBeDefined();
  });

  it('updateTaskAfterRun updates last_run, last_result, and next_run', () => {
    updateTaskAfterRun('run-task', '2024-01-01T00:02:00.000Z', 'run ok');
    const task = getTaskById('run-task')!;
    expect(task.last_result).toBe('run ok');
    expect(task.next_run).toBe('2024-01-01T00:02:00.000Z');
    expect(task.last_run).toBeTruthy();
  });

  it('updateTaskAfterRun with null nextRun marks task completed', () => {
    updateTaskAfterRun('run-task', null, 'final run');
    const task = getTaskById('run-task')!;
    expect(task.status).toBe('completed');
    expect(task.next_run).toBeNull();
  });
});

// --- storeMessageDirect ---

describe('storeMessageDirect', () => {
  it('stores a direct message and it is retrievable', () => {
    storeChatMetadata('webchat@g.us', '2024-01-01T00:00:00.000Z');
    storeMessageDirect({
      id: 'direct-1',
      chat_jid: 'webchat@g.us',
      sender: 'user-xyz',
      sender_name: 'XYZ',
      content: 'direct message',
      timestamp: '2024-01-01T00:00:01.000Z',
      is_from_me: false,
    });
    const msgs = getMessagesSince('webchat@g.us', '', 'Bot');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe('direct message');
  });
});
