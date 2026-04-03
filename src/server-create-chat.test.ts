import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import httpMocks from 'node-mocks-http';

vi.mock('./logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  _initTestDatabase,
  getSessionSkillBindings,
  getSessionSkillSyncState,
} from './db.js';
import { JWT_SECRET } from './config.js';
import { createApp } from './server.js';

async function invokeApp(
  app: ReturnType<typeof createApp>['app'],
  options: {
    method: string;
    url: string;
    token?: string;
    body?: unknown;
  },
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {};
  if (options.token) {
    headers.authorization = `Bearer ${options.token}`;
  }
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
  }

  const req = httpMocks.createRequest({
    method: options.method,
    url: options.url,
    headers,
    body: options.body,
  });
  const res = httpMocks.createResponse({ eventEmitter: EventEmitter });

  await new Promise<void>((resolve, reject) => {
    res.on('end', resolve);
    app.handle(req, res, reject);
  });

  return {
    status: res.statusCode,
    body: res._isJSON() ? res._getJSONData() : res._getData(),
  };
}

describe('POST /api/chats', () => {
  const onCreateChat = vi.fn();
  const token = jwt.sign(
    { userId: 'user-1', username: 'user-1', role: 'admin' },
    JWT_SECRET,
    { expiresIn: '1h' },
  );
  let skillsRootDir: string;

  beforeEach(() => {
    _initTestDatabase();
    onCreateChat.mockReset();
    skillsRootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'create-chat-skills-'));
    fs.mkdirSync(path.join(skillsRootDir, 'tmux'), { recursive: true });
    fs.writeFileSync(path.join(skillsRootDir, 'tmux', 'SKILL.md'), '# tmux', 'utf8');
  });

  afterEach(() => {
    fs.rmSync(skillsRootDir, { recursive: true, force: true });
  });

  it('passes requested agentType to onCreateChat so first turn uses the right agent', async () => {
    const app = createApp({
      onCreateChat: onCreateChat as any,
      skillsRootDir,
    }).app;

    const res = await invokeApp(app, {
      method: 'POST',
      url: '/api/chats',
      token,
      body: { agentType: 'claude' },
    });

    expect(res.status).toBe(201);
    expect(onCreateChat).toHaveBeenCalledTimes(1);

    const [jid, userId, agentType] = onCreateChat.mock.calls[0] ?? [];
    expect(jid).toMatch(/^web:/);
    expect(userId).toBe('user-1');
    expect(agentType).toBe('claude');
  });

  it('accepts initial skills during chat creation', async () => {
    const app = createApp({
      onCreateChat: onCreateChat as any,
      skillsRootDir,
    }).app;

    const res = await invokeApp(app, {
      method: 'POST',
      url: '/api/chats',
      token,
      body: { agentType: 'deepagent', skills: ['tmux'] },
    });

    expect(res.status).toBe(201);
    expect(res.body.jid).toMatch(/^web:/);
    expect(getSessionSkillBindings(res.body.jid)).toEqual(['tmux']);
    expect(getSessionSkillSyncState(res.body.jid)).toMatchObject({
      chat_jid: res.body.jid,
      status: 'pending',
    });
  });
});
