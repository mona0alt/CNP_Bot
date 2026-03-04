import { createContext, useContext, useState, useCallback, useRef } from 'react';
import type { Message } from '@/lib/types';

interface StreamingMessagesContextType {
  // 保存指定 jid 的流式消息
  saveStreamingMessages: (jid: string, messages: Message[]) => void;
  // 获取指定 jid 的流式消息
  getStreamingMessages: (jid: string) => Message[] | undefined;
  // 清除指定 jid 的流式消息
  clearStreamingMessages: (jid: string) => void;
}

const StreamingMessagesContext = createContext<StreamingMessagesContextType | null>(null);

export function StreamingMessagesProvider({ children }: { children: React.ReactNode }) {
  const [, setStreamingMessages] = useState<Map<string, Message[]>>(new Map());
  const streamingMessagesRef = useRef<Map<string, Message[]>>(new Map());

  const saveStreamingMessages = useCallback((jid: string, messages: Message[]) => {
    const botMessages = messages.filter(m => m.is_bot_message);
    if (botMessages.length === 0) return;

    setStreamingMessages(prev => {
      const current = prev.get(jid);
      const sameLength = current?.length === botMessages.length;
      const sameMessages = sameLength && current!.every((item, index) => {
        const next = botMessages[index];
        return (
          item.id === next.id &&
          item.content === next.content &&
          item.timestamp === next.timestamp
        );
      });
      if (sameMessages) {
        return prev;
      }
      const newMap = new Map(prev);
      newMap.set(jid, botMessages);
      streamingMessagesRef.current = newMap;
      return newMap;
    });
  }, []);

  const getStreamingMessages = useCallback((jid: string): Message[] | undefined => {
    return streamingMessagesRef.current.get(jid);
  }, []);

  const clearStreamingMessages = useCallback((jid: string) => {
    setStreamingMessages(prev => {
      if (!prev.has(jid)) {
        return prev;
      }
      const newMap = new Map(prev);
      newMap.delete(jid);
      streamingMessagesRef.current = newMap;
      return newMap;
    });
  }, []);

  return (
    <StreamingMessagesContext.Provider value={{ saveStreamingMessages, getStreamingMessages, clearStreamingMessages }}>
      {children}
    </StreamingMessagesContext.Provider>
  );
}

export function useStreamingMessages() {
  const context = useContext(StreamingMessagesContext);
  if (!context) {
    throw new Error('useStreamingMessages must be used within StreamingMessagesProvider');
  }
  return context;
}
