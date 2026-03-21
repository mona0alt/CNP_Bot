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

function connectAuth(
  port: number,
  jid: string,
  token: string,
): Promise<{ ws: WebSocket; bufferedMessages: any[] }> {
  return new Promise((resolve, reject) => {
    const url = `ws://localhost:${port}/ws?jid=${encodeURIComponent(jid)}`;
    const ws = new WebSocket(url);
    const bufferedMessages: any[] = [];

    ws.once('open', () => {
      ws.send(JSON.stringify({ type: 'auth', token }));
    });

    const onMessage = (data: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(data.toString()) as { type: string };
        if (msg.type === 'ready') {
          setTimeout(() => {
            ws.off('message', onMessage);
            resolve({ ws, bufferedMessages });
          }, 50);
          return;
        }
        bufferedMessages.push(msg);
      } catch {
        /* ignore */
      }
    };

    ws.on('message', onMessage);
    ws.once('error', reject);
    setTimeout(() => reject(new Error('connectAuth timeout')), 5000);
  });
}

describe('server interactive websocket handling', () => {
  let port: number;

  const onAskUserResponse = vi.fn();
  const onConfirmBashResponse = vi.fn();
  const getPendingInteractive = vi.fn(() => ({
    asks: [],
    confirms: [
      {
        requestId: 'confirm-pending-1',
        command: 'rm -rf /tmp/cnp-danger-test',
        reason: '递归强制删除文件',
        targetHost: '10.1.2.3',
      },
    ],
  }));

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
      getPendingInteractive,
    });

    await new Promise((resolve) => setTimeout(resolve, 150));
  });


  it('应在连接就绪后补发带 targetHost 的 confirm_bash', async () => {
    const token = jwt.sign(
      { userId: 'user-1', username: 'user-1', role: 'admin' },
      JWT_SECRET,
      { expiresIn: '1h' },
    );
    const { ws, bufferedMessages } = await connectAuth(port, 'web:interactive-session', token);

    const buffered = bufferedMessages.find((message) => message?.type === 'confirm_bash');
    const payload = buffered ?? await new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('pending confirm timeout')), 5000);
      ws.on('message', (data) => {
        try {
          const parsed = JSON.parse(data.toString());
          if (parsed?.type === 'confirm_bash') {
            clearTimeout(timer);
            resolve(parsed);
          }
        } catch {
          /* ignore */
        }
      });
    });

    expect(payload).toMatchObject({
      type: 'confirm_bash',
      chat_jid: 'web:interactive-session',
      requestId: 'confirm-pending-1',
      command: 'rm -rf /tmp/cnp-danger-test',
      reason: '递归强制删除文件',
      targetHost: '10.1.2.3',
    });
    ws.close();
  });

  it('应转发 ask_user_response', async () => {
    const token = jwt.sign(
      { userId: 'user-1', username: 'user-1', role: 'admin' },
      JWT_SECRET,
      { expiresIn: '1h' },
    );
    const { ws } = await connectAuth(port, 'web:interactive-session', token);

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
    const { ws } = await connectAuth(port, 'web:interactive-session', token);

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
