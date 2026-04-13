import { EventEmitter } from 'events';

import httpMocks from 'node-mocks-http';
import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('./system-config-service.js', () => ({
  loadSystemConfigValues: vi.fn(),
  saveSystemConfigValues: vi.fn(),
}));

vi.mock('./service-control.js', () => ({
  getRestartRuntimeInfo: vi.fn(),
  readRestartStatus: vi.fn(),
  requestServiceRestart: vi.fn(),
}));

import { JWT_SECRET } from './config.js';
import { createApp } from './server.js';
import {
  getRestartRuntimeInfo,
  readRestartStatus,
  requestServiceRestart,
} from './service-control.js';
import {
  loadSystemConfigValues,
  saveSystemConfigValues,
} from './system-config-service.js';
import {
  listSystemConfigFields,
  listSystemConfigSections,
} from './system-config-schema.js';

function createToken(userId: string, role: 'admin' | 'user'): string {
  return jwt.sign({ userId, username: userId, role }, JWT_SECRET, {
    expiresIn: '1h',
  });
}

function compactField(field: ReturnType<typeof listSystemConfigFields>[number]) {
  const compacted: Record<string, unknown> = { ...field };
  if (compacted.options === undefined) {
    delete compacted.options;
  }
  if (compacted.dangerLevel === undefined) {
    delete compacted.dangerLevel;
  }
  if (compacted.dangerMessage === undefined) {
    delete compacted.dangerMessage;
  }
  return compacted;
}

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

describe('system config api', () => {
  const adminToken = createToken('admin-1', 'admin');
  const userToken = createToken('user-1', 'user');
  const app = createApp().app;
  const expectedSections = listSystemConfigSections().map((section) => ({
    ...section,
    fields: listSystemConfigFields().filter(
      (field) => field.section === section.id,
    ).map(compactField),
  }));

  beforeEach(() => {
    vi.mocked(loadSystemConfigValues).mockReturnValue({
      ASSISTANT_NAME: 'CNP Bot',
    } as ReturnType<typeof loadSystemConfigValues>);
    vi.mocked(saveSystemConfigValues).mockReturnValue({
      values: {
        ASSISTANT_NAME: 'CNP Bot',
      } as ReturnType<typeof loadSystemConfigValues>,
      changedKeys: ['ASSISTANT_NAME'],
      restartRequired: true,
    });
    vi.mocked(getRestartRuntimeInfo).mockReturnValue({
      manager: 'systemd-user',
      status: 'running',
      canRestart: true,
    });
    vi.mocked(readRestartStatus).mockReturnValue({
      status: 'requested',
      message: null,
    });
    vi.mocked(requestServiceRestart).mockReturnValue({
      manager: 'systemd-user',
      status: 'running',
      canRestart: true,
    });
  });

  it('允许管理员读取 schema + values', async () => {
    const res = await invokeApp(app, {
      method: 'GET',
      url: '/api/system-config',
      token: adminToken,
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      sections: expectedSections,
      values: {
        ASSISTANT_NAME: 'CNP Bot',
      },
      restart: {
        manager: 'systemd-user',
        status: 'running',
        canRestart: true,
      },
      pendingRestart: true,
    });
  });

  it('允许管理员读取 restart-status', async () => {
    const res = await invokeApp(app, {
      method: 'GET',
      url: '/api/system-config/restart-status',
      token: adminToken,
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'requested',
      message: null,
    });
  });

  it('拒绝非管理员访问系统配置', async () => {
    const res = await invokeApp(app, {
      method: 'GET',
      url: '/api/system-config',
      token: userToken,
    });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Admin access required' });
  });

  it.each([
    ['GET', '/api/system-config'],
    ['PUT', '/api/system-config'],
    ['POST', '/api/system-config/restart'],
    ['GET', '/api/system-config/restart-status'],
  ])('拒绝非管理员访问 %s %s', async (method, url) => {
    const res = await invokeApp(app, {
      method,
      url,
      token: userToken,
      body:
        method === 'PUT'
          ? { values: { ASSISTANT_NAME: 'New Bot' } }
          : undefined,
    });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Admin access required' });
  });

  it('保存系统配置成功', async () => {
    const nextValues = {
      ASSISTANT_NAME: 'New Bot',
    };
    vi.mocked(saveSystemConfigValues).mockReturnValue({
      values: nextValues as ReturnType<typeof loadSystemConfigValues>,
      changedKeys: ['ASSISTANT_NAME'],
      restartRequired: true,
    });

    const res = await invokeApp(app, {
      method: 'PUT',
      url: '/api/system-config',
      token: adminToken,
      body: { values: nextValues },
    });

    expect(res.status).toBe(200);
    expect(saveSystemConfigValues).toHaveBeenCalledWith(nextValues);
    expect(res.body).toMatchObject({
      values: nextValues,
      changedKeys: ['ASSISTANT_NAME'],
      restartRequired: true,
      pendingRestart: true,
    });
  });

  it('系统配置校验失败时返回 400', async () => {
    const res = await invokeApp(app, {
      method: 'PUT',
      url: '/api/system-config',
      token: adminToken,
      body: { values: { ASSISTANT_NAME: 123 } },
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid request body' });
  });

  it('重启请求返回 202', async () => {
    const res = await invokeApp(app, {
      method: 'POST',
      url: '/api/system-config/restart',
      token: adminToken,
    });

    expect(res.status).toBe(202);
    expect(requestServiceRestart).toHaveBeenCalledTimes(1);
    expect(res.body).toMatchObject({
      success: true,
      pendingRestart: true,
    });
  });

  it('返回的 sections 包含 fields 结构', async () => {
    const res = await invokeApp(app, {
      method: 'GET',
      url: '/api/system-config',
      token: adminToken,
    });

    expect(res.status).toBe(200);
    expect(res.body.sections).toEqual(expectedSections);
    for (const section of res.body.sections) {
      expect(section.fields).toBeInstanceOf(Array);
      for (const field of section.fields) {
        expect(field).toMatchObject({
          section: section.id,
          key: expect.any(String),
          label: expect.any(String),
          type: expect.any(String),
        });
      }
    }
  });
});
