import net from 'net';

import { beforeAll, describe, expect, it, vi } from 'vitest';
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
import { _initTestDatabase, storeChatMetadata } from './db.js';
import { JWT_SECRET } from './config.js';

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
        /* ignore */
      }
    };

    ws.on('message', onMessage);
    ws.once('error', reject);
    setTimeout(() => reject(new Error('connectAuth timeout')), 5000);
  });
}

describe.skip('server interactive websocket handling', () => {
  let port: number;

  const onAskUserResponse = vi.fn();
  const onConfirmBashResponse = vi.fn();

  beforeAll(async () => {
    _initTestDatabase();
    storeChatMetadata(
      'web:interactive-session',
      new Date().toISOString(),
      'Interactive Session',
      'web',
      false,
      'user-1',
    );

    port = await getFreePort();
    startServer({
      port,
      getGroupFolder: () => 'interactive-folder',
      onAskUserResponse,
      onConfirmBashResponse,
    });

    await new Promise((resolve) => setTimeout(resolve, 150));
  });

  it('应转发 ask_user_response', async () => {
    const token = jwt.sign(
      { userId: 'user-1', username: 'user-1', role: 'admin' },
      JWT_SECRET,
      { expiresIn: '1h' },
    );
    const ws = await connectAuth(port, 'web:interactive-session', token);

    ws.send(
      JSON.stringify({
        type: 'ask_user_response',
        requestId: 'ask-1',
        answer: '生产环境',
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(onAskUserResponse).toHaveBeenCalledWith(
      'interactive-folder',
      'ask-1',
      '生产环境',
    );
    ws.close();
  });

  it('应转发 confirm_bash_response', async () => {
    const token = jwt.sign(
      { userId: 'user-1', username: 'user-1', role: 'admin' },
      JWT_SECRET,
      { expiresIn: '1h' },
    );
    const ws = await connectAuth(port, 'web:interactive-session', token);

    ws.send(
      JSON.stringify({
        type: 'confirm_bash_response',
        requestId: 'confirm-1',
        approved: true,
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(onConfirmBashResponse).toHaveBeenCalledWith(
      'interactive-folder',
      'confirm-1',
      true,
    );
    ws.close();
  });
});
