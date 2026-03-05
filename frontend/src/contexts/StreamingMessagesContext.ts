import { createContext } from 'react';
import type { Message } from '@/lib/types';

interface StreamingMessagesContextType {
  // 保存指定 jid 的流式消息
  saveStreamingMessages: (jid: string, messages: Message[]) => void;
  // 获取指定 jid 的流式消息
  getStreamingMessages: (jid: string) => Message[] | undefined;
  // 清除指定 jid 的流式消息
  clearStreamingMessages: (jid: string) => void;
}

export const StreamingMessagesContext = createContext<StreamingMessagesContextType | null>(null);