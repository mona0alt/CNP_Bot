import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./db.js', () => ({
  storeChatMetadata: vi.fn(),
  storeMessageDirect: vi.fn(),
}));

vi.mock('./config.js', () => ({
  ASSISTANT_NAME: 'CNP-Bot',
}));

import { WebChannel } from './channels/web.js';

describe('WebChannel', () => {
  const broadcastToJid = vi.fn();
  let channel: WebChannel;

  beforeEach(() => {
    broadcastToJid.mockReset();
    channel = new WebChannel({ broadcastToJid });
  });

  it('broadcasts typing state to the correct jid', async () => {
    await channel.setTyping('web:test', true);
    await channel.setTyping('web:test', false);

    expect(broadcastToJid).toHaveBeenNthCalledWith(1, 'web:test', {
      type: 'typing',
      chat_jid: 'web:test',
      isTyping: true,
    });
    expect(broadcastToJid).toHaveBeenNthCalledWith(2, 'web:test', {
      type: 'typing',
      chat_jid: 'web:test',
      isTyping: false,
    });
  });
});
