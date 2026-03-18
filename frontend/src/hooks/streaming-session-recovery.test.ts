import { describe, expect, it } from 'vitest';

import type { Message } from '../lib/types';

import {
  mergePersistedAndStreamingMessages,
  resolveActiveStreamMessage,
} from './streaming-session-recovery';

function makeMessage(overrides: Partial<Message> & Pick<Message, 'id'>): Message {
  return {
    id: overrides.id,
    chat_jid: overrides.chat_jid ?? 'web:test',
    sender_name: overrides.sender_name ?? 'CNP-Bot',
    content: overrides.content ?? 'content',
    timestamp: overrides.timestamp ?? '2026-03-18T08:00:00.000Z',
    is_from_me: overrides.is_from_me ?? false,
    is_bot_message: overrides.is_bot_message ?? true,
  };
}

describe('streaming session recovery', () => {
  it('恢复未完成流式消息时，返回最后一条stream消息作为activeStreamId', () => {
    const persistedMessages = [
      makeMessage({
        id: 'persisted-final',
        timestamp: '2026-03-18T08:00:10.000Z',
        content: '历史消息',
      }),
    ];
    const savedStreamingMessages = [
      makeMessage({
        id: 'stream-1',
        timestamp: '2026-03-18T08:00:11.000Z',
        content: '[{"type":"tool_use","id":"tool-1","status":"calling"}]',
      }),
      makeMessage({
        id: 'stream-2',
        timestamp: '2026-03-18T08:00:12.000Z',
        content: '[{"type":"tool_use","id":"tool-1","status":"calling"},{"type":"text","text":"处理中"}]',
      }),
    ];

    const result = mergePersistedAndStreamingMessages(
      persistedMessages,
      savedStreamingMessages,
    );

    expect(result.messages.map((message) => message.id)).toEqual([
      'persisted-final',
      'stream-1',
      'stream-2',
    ]);
    expect(result.activeStreamId).toBe('stream-2');
  });

  it('若数据库已有更新的bot消息，则丢弃过期stream缓存', () => {
    const persistedMessages = [
      makeMessage({
        id: 'persisted-final',
        timestamp: '2026-03-18T08:00:20.000Z',
        content: '最终落库消息',
      }),
    ];
    const savedStreamingMessages = [
      makeMessage({
        id: 'stream-1',
        timestamp: '2026-03-18T08:00:12.000Z',
        content: '[{"type":"text","text":"旧流式"}]',
      }),
    ];

    const result = mergePersistedAndStreamingMessages(
      persistedMessages,
      savedStreamingMessages,
    );

    expect(result.messages).toEqual(persistedMessages);
    expect(result.activeStreamId).toBeNull();
  });

  it('切换session后activeStreamId丢失时，能fallback到当前会话最后一条stream卡片', () => {
    const messages = [
      makeMessage({
        id: 'persisted-1',
        timestamp: '2026-03-18T08:00:10.000Z',
      }),
      makeMessage({
        id: 'stream-old',
        timestamp: '2026-03-18T08:00:11.000Z',
        content: '[{"type":"tool_use","id":"tool-1","status":"calling"}]',
      }),
      makeMessage({
        id: 'stream-latest',
        timestamp: '2026-03-18T08:00:12.000Z',
        content: '[{"type":"tool_use","id":"tool-2","status":"calling"}]',
      }),
      makeMessage({
        id: 'stream-other-jid',
        chat_jid: 'web:other',
        timestamp: '2026-03-18T08:00:13.000Z',
        content: '[{"type":"tool_use","id":"tool-3","status":"calling"}]',
      }),
    ];

    const result = resolveActiveStreamMessage(messages, 'web:test', null);

    expect(result.index).toBe(2);
    expect(result.activeStreamId).toBe('stream-latest');
  });

  it('activeStreamId有效时优先复用，避免同轮对话拆成多张卡片', () => {
    const messages = [
      makeMessage({ id: 'stream-1' }),
      makeMessage({ id: 'stream-2', timestamp: '2026-03-18T08:00:01.000Z' }),
    ];

    const result = resolveActiveStreamMessage(messages, 'web:test', 'stream-1');

    expect(result.index).toBe(0);
    expect(result.activeStreamId).toBe('stream-1');
  });
});
