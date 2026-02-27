import { randomUUID } from 'crypto';

import { ASSISTANT_NAME } from '../config.js';
import { storeChatMetadata, storeMessageDirect } from '../db.js';
import { Channel } from '../types.js';

export class WebChannel implements Channel {
  name = 'web';

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

