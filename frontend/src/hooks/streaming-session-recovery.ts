import type { Message } from '../lib/types';

export interface MergeStreamingResult {
  messages: Message[];
  activeStreamId: string | null;
}

export interface ActiveStreamResolution {
  index: number;
  activeStreamId: string | null;
}

function isStreamingBotMessage(message: Message, jid?: string): boolean {
  return (
    message.is_bot_message &&
    message.id.startsWith('stream-') &&
    (jid === undefined || message.chat_jid === jid)
  );
}

export function mergePersistedAndStreamingMessages(
  persistedMessages: Message[],
  savedStreamingMessages: Message[] | undefined,
): MergeStreamingResult {
  if (!savedStreamingMessages || savedStreamingMessages.length === 0) {
    return {
      messages: persistedMessages,
      activeStreamId: null,
    };
  }

  const latestPersistedBotTs = persistedMessages
    .filter((message) => message.is_bot_message)
    .reduce<number>(
      (max, message) => Math.max(max, new Date(message.timestamp).getTime()),
      0,
    );

  const freshStreaming = savedStreamingMessages.filter((message) => {
    const streamTs = new Date(message.timestamp).getTime();
    return !latestPersistedBotTs || streamTs > latestPersistedBotTs;
  });

  if (freshStreaming.length === 0) {
    return {
      messages: persistedMessages,
      activeStreamId: null,
    };
  }

  const streamingIds = new Set(freshStreaming.map((message) => message.id));
  const filteredPersistedMessages = persistedMessages.filter(
    (message) => !streamingIds.has(message.id),
  );

  return {
    messages: [...filteredPersistedMessages, ...freshStreaming],
    activeStreamId: freshStreaming[freshStreaming.length - 1]?.id ?? null,
  };
}

export function resolveActiveStreamMessage(
  messages: Message[],
  jid: string | null,
  activeStreamId: string | null,
): ActiveStreamResolution {
  if (!jid) {
    return { index: -1, activeStreamId: null };
  }

  if (activeStreamId) {
    const activeIndex = messages.findIndex(
      (message) => message.id === activeStreamId,
    );
    if (activeIndex !== -1) {
      return { index: activeIndex, activeStreamId };
    }
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (isStreamingBotMessage(message, jid)) {
      return {
        index,
        activeStreamId: message.id,
      };
    }
  }

  return { index: -1, activeStreamId: null };
}
