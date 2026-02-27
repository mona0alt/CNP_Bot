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
    storeChatMetadata(jid, timestamp, jid === 'web:default' ? 'Web Chat' : jid, 'web', false);
    storeMessageDirect({
      id: randomUUID(),
      chat_jid: jid,
      sender: 'nanoclaw',
      sender_name: ASSISTANT_NAME,
      content: text,
      timestamp,
      is_from_me: false,
      is_bot_message: true,
    });
    
    // Also broadcast full message to clients so they can update their view
    // (Though they might have received chunks, this confirms the final message)
    if (this.broadcaster) {
        this.broadcaster.broadcastToJid(jid, {
            type: 'message',
            chat_jid: jid,
            content: text,
            sender: 'nanoclaw',
            is_bot_message: true,
            timestamp
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

