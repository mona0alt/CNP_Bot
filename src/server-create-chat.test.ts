import net from 'net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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
import { _initTestDatabase } from './db.js';
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

describe('POST /api/chats', () => {
  let port: number;
  const onCreateChat = vi.fn();
  const token = jwt.sign(
    { userId: 'user-1', username: 'user-1', role: 'admin' },
    JWT_SECRET,
    { expiresIn: '1h' },
  );

  beforeAll(async () => {
    _initTestDatabase();
    port = await getFreePort();
    startServer({
      port,
      onCreateChat: onCreateChat as any,
    });
    await new Promise((r) => setTimeout(r, 100));
  });

  afterAll(() => {
    onCreateChat.mockReset();
  });

  it('passes requested agentType to onCreateChat so first turn uses the right agent', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/chats`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ agentType: 'claude' }),
    });

    expect(res.status).toBe(201);
    expect(onCreateChat).toHaveBeenCalledTimes(1);

    const [jid, userId, agentType] = onCreateChat.mock.calls[0] ?? [];
    expect(jid).toMatch(/^web:/);
    expect(userId).toBe('user-1');
    expect(agentType).toBe('claude');
  });
});
