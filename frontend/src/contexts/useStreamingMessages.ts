import { useContext } from 'react';
import { StreamingMessagesContext } from './StreamingMessagesContext';

export function useStreamingMessages() {
  const context = useContext(StreamingMessagesContext);
  if (!context) {
    throw new Error('useStreamingMessages must be used within StreamingMessagesProvider');
  }
  return context;
}