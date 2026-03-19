import { randomUUID } from 'crypto';

import { ASSISTANT_NAME } from '../config.js';
import { storeChatMetadata, storeMessageDirect } from '../db.js';
import { BroadcastCapability } from '../server.js';
import { Channel } from '../types.js';

export class WebChannel implements Channel {
  name = 'web';
  private broadcaster?: BroadcastCapability;

  constructor(broadcaster?: BroadcastCapability) {
    this.broadcaster = broadcaster;
  }

  async connect(): Promise<void> {
    return;
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    const timestamp = new Date().toISOString();
    const message = {
      id: randomUUID(),
      chat_jid: jid,
      sender: 'cnp-bot',
      sender_name: ASSISTANT_NAME,
      content: text,
      timestamp,
      is_from_me: false,
      is_bot_message: true,
    };

    storeChatMetadata(jid, timestamp, jid, 'web', false);
    storeMessageDirect(message);
    
    // Also broadcast full message to clients so they can update their view
    // (Though they might have received chunks, this confirms the final message)
    if (this.broadcaster) {
        this.broadcaster.broadcastToJid(jid, {
            type: 'message',
            data: message,
        });
    }
  }

  async streamMessage(jid: string, chunk: string): Promise<void> {
    if (this.broadcaster) {
        this.broadcaster.broadcastToJid(jid, {
            type: 'stream',
            chat_jid: jid,
            chunk
        });
    }
  }

  async streamEvent(jid: string, event: any): Promise<void> {
    if (this.broadcaster) {
        this.broadcaster.broadcastToJid(jid, {
            type: 'stream_event',
            chat_jid: jid,
            event
        });
    }
  }

  async setTyping(jid: string, isTyping: boolean): Promise<void> {
    if (this.broadcaster) {
      this.broadcaster.broadcastToJid(jid, {
        type: 'typing',
        chat_jid: jid,
        isTyping,
      });
    }
  }

  isConnected(): boolean {
    return true;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('web:');
  }

  async disconnect(): Promise<void> {
    return;
  }
}
