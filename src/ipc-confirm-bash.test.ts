import fs from 'fs';
import path from 'path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DATA_DIR } from './config.js';
import {
  startAskConfirmWatcher,
  writeAskResponse,
  writeConfirmResponse,
  type IpcAskRequest,
  type IpcConfirmRequest,
} from './ipc.js';

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor<T>(
  fn: () => T | undefined,
  timeoutMs = 5000,
): Promise<T> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const result = fn();
    if (result !== undefined) return result;
    await delay(20);
  }
  throw new Error('Timed out waiting for condition');
}

describe('interactive IPC flow', () => {
  const folder = `interactive-test-${Date.now()}`;
  const ipcDir = path.join(DATA_DIR, 'ipc', folder);
  const group = {
    name: 'Interactive Test',
    folder,
    trigger: '@Assistant',
    added_at: new Date().toISOString(),
    requiresTrigger: false,
  };
  const registeredGroups = {
    'web:interactive-test': group,
  };
  const askRequests: IpcAskRequest[] = [];
  const confirmRequests: IpcConfirmRequest[] = [];

  beforeAll(() => {
    fs.rmSync(ipcDir, { recursive: true, force: true });
    startAskConfirmWatcher(
      () => registeredGroups,
      (_groupFolder, req) => {
        askRequests.push(req);
      },
      (_groupFolder, req) => {
        confirmRequests.push(req);
      },
    );
  });

  afterAll(() => {
    fs.rmSync(ipcDir, { recursive: true, force: true });
  });

  it('应从 ask_requests 读取追问请求', async () => {
    const requestId = 'req-ask-1';
    const askDir = path.join(ipcDir, 'ask_requests');
    fs.mkdirSync(askDir, { recursive: true });
    fs.writeFileSync(
      path.join(askDir, `${requestId}.json`),
      JSON.stringify({
        type: 'ask_user',
        requestId,
        chatJid: 'web:interactive-test',
        question: '请补充部署环境信息',
      }),
    );

    const req = await waitFor(() =>
      askRequests.find((item) => item.requestId === requestId),
    );
    expect(req.question).toBe('请补充部署环境信息');
    expect(req.chatJid).toBe('web:interactive-test');
  });

  it('应把 ask 响应写入 ask_responses', () => {
    const requestId = 'req-ask-2';
    writeAskResponse(folder, requestId, '生产环境');
    const responseFile = path.join(ipcDir, 'ask_responses', `${requestId}.json`);
    expect(fs.existsSync(responseFile)).toBe(true);
    expect(JSON.parse(fs.readFileSync(responseFile, 'utf8'))).toEqual({
      answer: '生产环境',
    });
  });

  it('应从 confirm_requests 读取高危命令确认请求', async () => {
    const requestId = 'req-confirm-1';
    const confirmDir = path.join(ipcDir, 'confirm_requests');
    fs.mkdirSync(confirmDir, { recursive: true });
    fs.writeFileSync(
      path.join(confirmDir, `${requestId}.json`),
      JSON.stringify({
        type: 'confirm_bash',
        requestId,
        chatJid: 'web:interactive-test',
        command: 'rm -rf /tmp/cnp-danger-test',
        reason: '递归强制删除文件',
      }),
    );

    const req = await waitFor(() =>
      confirmRequests.find((item) => item.requestId === requestId),
    );
    expect(req.chatJid).toBe('web:interactive-test');
    expect(req.command).toBe('rm -rf /tmp/cnp-danger-test');
    expect(req.reason).toBe('递归强制删除文件');
  });

  it('应把确认结果写入 confirm_responses，供 helper 脚本读取', () => {
    const requestId = 'req-confirm-2';
    writeConfirmResponse(folder, requestId, true);
    const responseFile = path.join(
      ipcDir,
      'confirm_responses',
      `${requestId}.json`,
    );
    expect(fs.existsSync(responseFile)).toBe(true);
    expect(JSON.parse(fs.readFileSync(responseFile, 'utf8'))).toEqual({
      approved: true,
    });
  });
});
