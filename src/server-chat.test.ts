import net from 'net';
import { randomUUID } from 'crypto';
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';
import jwt from 'jsonwebtoken';

vi.mock('./logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { startServer } from './server.js';
import {
  _initTestDatabase,
  storeChatMetadata,
  storeMessageDirect,
} from './db.js';
import { JWT_SECRET } from './config.js';

// --- Helpers ---

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const addr = srv.address() as net.AddressInfo;
      srv.close(() => resolve(addr.port));
    });
    srv.on('error', reject);
  });
}

function connectAuth(port: number, jid: string, token: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const url = `ws://localhost:${port}/ws?jid=${encodeURIComponent(jid)}`;
    const ws = new WebSocket(url);

    ws.once('open', () => {
      ws.send(JSON.stringify({ type: 'auth', token }));
    });

    const onMessage = (data: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(data.toString()) as { type: string };
        if (msg.type === 'ready') {
          ws.off('message', onMessage);
          resolve(ws);
        }
      } catch {
        /* ignore parse errors */
      }
    };

    ws.on('message', onMessage);
    ws.once('error', reject);

    // Safety timeout
    setTimeout(() => reject(new Error('connectAuth timeout')), 5000);
  });
}

/**
 * Collect `n` non-heartbeat messages from a WebSocket within `timeoutMs`.
 */
function collectMessages(ws: WebSocket, n: number, timeoutMs = 3000): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const collected: unknown[] = [];
    let timer: ReturnType<typeof setTimeout>;

    const onMessage = (data: WebSocket.RawData) => {
      const msg = JSON.parse(data.toString()) as { type: string };
      if (msg.type === 'heartbeat') return;
      collected.push(msg);
      if (collected.length >= n) {
        clearTimeout(timer);
        ws.off('message', onMessage);
        resolve(collected);
      }
    };

    timer = setTimeout(() => {
      ws.off('message', onMessage);
      reject(
        new Error(`collectMessages timeout: got ${collected.length}/${n}`),
      );
    }, timeoutMs);

    ws.on('message', onMessage);
  });
}

/**
 * Collect all non-heartbeat messages arriving within `windowMs`.
 */
function collectWithin(ws: WebSocket, windowMs: number): Promise<unknown[]> {
  return new Promise((resolve) => {
    const collected: unknown[] = [];
    const onMessage = (data: WebSocket.RawData) => {
      const msg = JSON.parse(data.toString()) as { type: string };
      if (msg.type !== 'heartbeat') collected.push(msg);
    };
    ws.on('message', onMessage);
    setTimeout(() => {
      ws.off('message', onMessage);
      resolve(collected);
    }, windowMs);
  });
}

// --- Test constants ---

const JID_A = 'web:session-a';
const JID_B = 'web:session-b';

// --- Test suite ---

describe('server chat integration - concurrent sessions', () => {
  let port: number;
  let broadcastToJid: (jid: string, payload: unknown) => void;

  beforeAll(async () => {
    _initTestDatabase();

    const ts = new Date().toISOString();
    // Register both chats (admin role only checks jid exists)
    storeChatMetadata(JID_A, ts, 'Session A', 'web', false, 'user-a');
    storeChatMetadata(JID_B, ts, 'Session B', 'web', false, 'user-b');

    port = await getFreePort();
    const result = startServer({
      port,
      onWebUserMessage: async (jid, text, userId) => {
        const id = randomUUID();
        const timestamp = new Date().toISOString();
        const msg = {
          id,
          chat_jid: jid,
          sender: userId,
          sender_name: 'User',
          content: text,
          timestamp,
          is_from_me: false,
          is_bot_message: false,
        };
        storeMessageDirect(msg);
        return msg;
      },
    });
    broadcastToJid = result.broadcastToJid;

    // Give the server time to start listening
    await new Promise((r) => setTimeout(r, 150));
  });

  // --- Session A ---

  describe('Session A', () => {
    const tokenA = jwt.sign(
      { userId: 'user-a', username: 'user-a', role: 'admin' },
      JWT_SECRET,
      { expiresIn: '1h' },
    );
    let wsA: WebSocket;

    beforeAll(async () => {
      wsA = await connectAuth(port, JID_A, tokenA);
    });

    afterAll(() => {
      wsA?.close();
    });

    it('Round 1 - text reply: receives echo and agent text message', async () => {
      // Collect 2 messages: echo + agent broadcast
      const promise = collectMessages(wsA, 2);

      wsA.send(JSON.stringify({ type: 'send', content: 'Hello' }));

      // Let the server echo arrive, then simulate agent response
      await new Promise((r) => setTimeout(r, 80));
      broadcastToJid(JID_A, {
        type: 'message',
        data: {
          id: randomUUID(),
          chat_jid: JID_A,
          sender: 'agent',
          sender_name: 'Agent',
          content: 'Hi there!',
          timestamp: new Date().toISOString(),
        },
      });

      const received = await promise;
      expect(received).toHaveLength(2);
      // Both should be message type
      const types = (received as Array<{ type: string }>).map((m) => m.type);
      expect(types).toContain('message');
    });

    it('Round 2 - tool use: receives echo and all stream events including tool card', async () => {
      // Collect 5 messages: 1 echo + 4 broadcasts
      const promise = collectMessages(wsA, 5);

      wsA.send(JSON.stringify({ type: 'send', content: 'Run ls command' }));

      await new Promise((r) => setTimeout(r, 80));

      // Simulate agent streaming with tool use
      broadcastToJid(JID_A, {
        type: 'stream_event',
        event: { type: 'tool_use', name: 'Bash', input: { command: 'ls' } },
      });
      broadcastToJid(JID_A, {
        type: 'stream_event',
        event: { type: 'tool_result', content: 'file.txt\ndir/' },
      });
      broadcastToJid(JID_A, {
        type: 'stream',
        chunk: 'Here is the output.',
      });
      broadcastToJid(JID_A, {
        type: 'message',
        data: {
          id: randomUUID(),
          chat_jid: JID_A,
          content: 'Done.',
          timestamp: new Date().toISOString(),
        },
      });

      const received = await promise;
      expect(received).toHaveLength(5);

      // Assert tool card is present
      const toolUse = (received as Array<{ type: string; event?: { type: string; name?: string; input?: { command?: string } } }>).find(
        (m) => m.type === 'stream_event' && m.event?.type === 'tool_use',
      );
      expect(toolUse).toBeDefined();
      expect(toolUse!.event!.name).toBe('Bash');
      expect(toolUse!.event!.input!.command).toBe('ls');
    });

    it('broadcasts jumpserver_session events without leaking internal tool_use cards', async () => {
      const promise = collectMessages(wsA, 2);

      broadcastToJid(JID_A, {
        type: 'stream_event',
        event: {
          type: 'jumpserver_session',
          block: {
            type: 'jumpserver_session',
            id: 'jump-1',
            stage: 'running_remote_command',
            target_host: '10.246.104.234',
            executions: [
              { id: 'exec-1', command: 'journalctl -n 50', status: 'running' },
            ],
          },
        },
      });
      broadcastToJid(JID_A, {
        type: 'message',
        data: {
          id: randomUUID(),
          chat_jid: JID_A,
          content: JSON.stringify([
            {
              type: 'jumpserver_session',
              id: 'jump-1',
              stage: 'completed',
              target_host: '10.246.104.234',
              executions: [
                {
                  id: 'exec-1',
                  command: 'journalctl -n 50',
                  status: 'completed',
                },
              ],
            },
          ]),
          timestamp: new Date().toISOString(),
        },
      });

      const received = await promise;
      const sessionEvent = (
        received as Array<{ type: string; event?: { type?: string; block?: { target_host?: string } } }>
      ).find(
        (msg) =>
          msg.type === 'stream_event' &&
          msg.event?.type === 'jumpserver_session',
      );

      expect(sessionEvent).toBeDefined();
      expect(sessionEvent?.event?.block?.target_host).toBe('10.246.104.234');
    });
  });

  // --- Session B ---

  describe('Session B', () => {
    const tokenB = jwt.sign(
      { userId: 'user-b', username: 'user-b', role: 'admin' },
      JWT_SECRET,
      { expiresIn: '1h' },
    );
    let wsB: WebSocket;

    beforeAll(async () => {
      wsB = await connectAuth(port, JID_B, tokenB);
    });

    afterAll(() => {
      wsB?.close();
    });

    it('Round 1 - text reply: receives echo and agent message', async () => {
      const promise = collectMessages(wsB, 2);

      wsB.send(JSON.stringify({ type: 'send', content: 'What is 2+2' }));

      await new Promise((r) => setTimeout(r, 80));
      broadcastToJid(JID_B, {
        type: 'message',
        data: {
          id: randomUUID(),
          chat_jid: JID_B,
          content: '4',
          timestamp: new Date().toISOString(),
        },
      });

      const received = await promise;
      expect(received).toHaveLength(2);
    });

    it('Round 2 - tool use: receives echo, tool card, and final message', async () => {
      const promise = collectMessages(wsB, 3);

      wsB.send(JSON.stringify({ type: 'send', content: 'List files' }));

      await new Promise((r) => setTimeout(r, 80));

      broadcastToJid(JID_B, {
        type: 'stream_event',
        event: { type: 'tool_use', name: 'Bash', input: { command: 'find .' } },
      });
      broadcastToJid(JID_B, {
        type: 'message',
        data: {
          id: randomUUID(),
          chat_jid: JID_B,
          content: 'Found files.',
          timestamp: new Date().toISOString(),
        },
      });

      const received = await promise;
      expect(received).toHaveLength(3);

      const toolCard = (received as Array<{ type: string; event?: { type: string; name?: string; input?: { command?: string } } }>).find(
        (m) => m.type === 'stream_event' && m.event?.type === 'tool_use',
      );
      expect(toolCard).toBeDefined();
      expect(toolCard!.event!.name).toBe('Bash');
      expect(toolCard!.event!.input!.command).toBe('find .');
    });
  });

  // --- Cross-session isolation ---

  it('cross-session isolation: broadcasts to session-a do not leak to session-b', async () => {
    const tokenA = jwt.sign(
      { userId: 'user-a', username: 'user-a', role: 'admin' },
      JWT_SECRET,
      { expiresIn: '1h' },
    );
    const tokenB = jwt.sign(
      { userId: 'user-b', username: 'user-b', role: 'admin' },
      JWT_SECRET,
      { expiresIn: '1h' },
    );

    const wsA2 = await connectAuth(port, JID_A, tokenA);
    const wsB2 = await connectAuth(port, JID_B, tokenB);

    // Begin collecting B's messages BEFORE broadcasting to A
    const bWindow = collectWithin(wsB2, 300);

    // Send a message on A and broadcast several events to A's JID
    wsA2.send(JSON.stringify({ type: 'send', content: 'isolation check' }));
    await new Promise((r) => setTimeout(r, 50));

    broadcastToJid(JID_A, {
      type: 'stream_event',
      event: { type: 'tool_use', name: 'Bash', input: { command: 'whoami' } },
    });
    broadcastToJid(JID_A, {
      type: 'message',
      data: { id: randomUUID(), content: 'A only', timestamp: new Date().toISOString() },
    });

    // Wait for window to close, then assert B received nothing from A
    const bReceived = await bWindow;

    const leaked = (bReceived as Array<{ type: string }>).filter(
      (m) => m.type === 'stream_event' || (m.type === 'message'),
    );
    expect(leaked).toHaveLength(0);

    wsA2.close();
    wsB2.close();
  });
});
