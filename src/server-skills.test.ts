import fs from 'fs';
import os from 'os';
import path from 'path';
import { EventEmitter } from 'events';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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

import { _initTestDatabase, replaceSessionSkillBindings, setSessionSkillSyncState, storeChatMetadata } from './db.js';
import { JWT_SECRET } from './config.js';
import { createApp } from './server.js';

function createToken(userId: string, role: 'admin' | 'user'): string {
  return jwt.sign({ userId, username: userId, role }, JWT_SECRET, {
    expiresIn: '1h',
  });
}

async function invokeApp(
  app: ReturnType<typeof createApp>['app'],
  options: {
    method: string;
    url: string;
    token?: string;
    body?: unknown;
    query?: Record<string, string>;
  },
): Promise<{ status: number; body: any }> {
  const url = new URL(`http://localhost${options.url}`);
  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      url.searchParams.set(key, value);
    }
  }

  const headers: Record<string, string> = {};
  if (options.token) {
    headers.authorization = `Bearer ${options.token}`;
  }
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
  }

  const req = httpMocks.createRequest({
    method: options.method,
    url: url.pathname + url.search,
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
    body: res._isJSON()
      ? res._getJSONData()
      : res._getData(),
  };
}

describe('skills api', () => {
  let skillsRootDir: string;
  let app: ReturnType<typeof createApp>['app'];
  const onChatSkillsUpdated = vi.fn<
    (jid: string) => Promise<{ status: 'pending' | 'synced' | 'failed'; errorMessage?: string }>
  >();

  const adminToken = createToken('admin-1', 'admin');
  const userAToken = createToken('user-a', 'user');
  const userBToken = createToken('user-b', 'user');

  beforeAll(() => {
    skillsRootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'server-skills-'));
    app = createApp({
      skillsRootDir,
      onChatSkillsUpdated,
    }).app;
  });

  beforeEach(() => {
    _initTestDatabase();
    onChatSkillsUpdated.mockReset();
    onChatSkillsUpdated.mockResolvedValue({ status: 'pending' });

    fs.rmSync(skillsRootDir, { recursive: true, force: true });
    fs.mkdirSync(path.join(skillsRootDir, 'tmux'), { recursive: true });
    fs.writeFileSync(path.join(skillsRootDir, 'tmux', 'SKILL.md'), '# tmux', 'utf8');
    fs.mkdirSync(path.join(skillsRootDir, 'prometheus'), { recursive: true });
    fs.writeFileSync(
      path.join(skillsRootDir, 'prometheus', 'SKILL.md'),
      '# prometheus',
      'utf8',
    );

    storeChatMetadata('web:user-a', '2024-01-01T00:00:00.000Z', 'A Chat', 'web', false, 'user-a');
    storeChatMetadata('web:user-b', '2024-01-01T00:00:00.000Z', 'B Chat', 'web', false, 'user-b');
  });

  afterAll(() => {
    if (skillsRootDir) {
      fs.rmSync(skillsRootDir, { recursive: true, force: true });
    }
  });

  it('allows admin to list skills', async () => {
    const res = await invokeApp(app, {
      method: 'GET',
      url: '/api/skills',
      token: adminToken,
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      expect.objectContaining({ name: 'prometheus', has_skill_md: true }),
      expect.objectContaining({ name: 'tmux', has_skill_md: true }),
    ]);
  });

  it('forbids non-admin from mutating global skills', async () => {
    const res = await invokeApp(app, {
      method: 'PUT',
      url: '/api/skills/file',
      token: userAToken,
      body: { path: 'tmux/SKILL.md', content: '# updated' },
    });

    expect(res.status).toBe(403);
  });

  it('returns file content for admin viewer', async () => {
    const res = await invokeApp(app, {
      method: 'GET',
      url: '/api/skills/file',
      token: adminToken,
      query: { path: 'tmux/SKILL.md' },
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      path: 'tmux/SKILL.md',
      content: '# tmux',
      editable: true,
    });
  });

  it('allows a user to read the catalog', async () => {
    const res = await invokeApp(app, {
      method: 'GET',
      url: '/api/skills/catalog',
      token: userAToken,
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      expect.objectContaining({ name: 'prometheus' }),
      expect.objectContaining({ name: 'tmux' }),
    ]);
  });

  it('allows a user to read skill detail from catalog', async () => {
    const res = await invokeApp(app, {
      method: 'GET',
      url: '/api/skills/catalog/file',
      token: userAToken,
      query: { path: 'tmux/SKILL.md' },
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      path: 'tmux/SKILL.md',
      content: '# tmux',
      editable: false,
    });
  });

  it('allows a user to load one skill tree by query', async () => {
    const res = await invokeApp(app, {
      method: 'GET',
      url: '/api/skills/catalog/tree',
      token: userAToken,
      query: { skill: 'tmux' },
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      expect.objectContaining({
        name: 'tmux',
        path: 'tmux',
        type: 'directory',
      }),
    ]);
  });

  it('allows a user to replace skills for an owned web chat', async () => {
    const res = await invokeApp(app, {
      method: 'PUT',
      url: '/api/chats/web%3Auser-a/skills',
      token: userAToken,
      body: { skills: ['tmux'] },
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      selectedSkills: ['tmux'],
      syncStatus: 'pending',
      errorMessage: null,
    });
    expect(onChatSkillsUpdated).toHaveBeenCalledWith('web:user-a');
  });

  it('rejects replacing skills for another users chat', async () => {
    const res = await invokeApp(app, {
      method: 'PUT',
      url: '/api/chats/web%3Auser-a/skills',
      token: userBToken,
      body: { skills: ['tmux'] },
    });

    expect(res.status).toBe(404);
  });

  it('returns sync state with chat skill bindings', async () => {
    replaceSessionSkillBindings('web:user-a', ['prometheus', 'tmux']);
    setSessionSkillSyncState('web:user-a', {
      status: 'failed',
      errorMessage: 'copy failed',
      lastSyncedAt: '2026-04-03T08:00:00.000Z',
    });

    const res = await invokeApp(app, {
      method: 'GET',
      url: '/api/chats/web%3Auser-a/skills',
      token: userAToken,
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      selectedSkills: ['prometheus', 'tmux'],
      syncStatus: 'failed',
      lastSyncedAt: '2026-04-03T08:00:00.000Z',
      errorMessage: 'copy failed',
    });
  });
});
