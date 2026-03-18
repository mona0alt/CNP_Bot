import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';

import { afterEach, describe, expect, it } from 'vitest';

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForJsonFile(dir: string, timeoutMs = 5000): Promise<string> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir).filter((file) => file.endsWith('.json'));
      if (files.length > 0) {
        return path.join(dir, files[0]);
      }
    }
    await delay(50);
  }

  throw new Error(`Timed out waiting for json file in ${dir}`);
}

async function waitForExit(child: ReturnType<typeof spawn>, timeoutMs = 5000) {
  return await new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Process did not exit within ${timeoutMs}ms`));
    }, timeoutMs);

    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
    child.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('confirm bash helpers', () => {
  it('主 Dockerfile 应安装 ask/confirm helper 脚本，避免本地代理模式缺失', () => {
    const dockerfile = fs.readFileSync(
      path.resolve(process.cwd(), 'Dockerfile'),
      'utf8',
    );
    expect(dockerfile).toContain(
      'COPY container/scripts/cnp-ask /usr/local/bin/cnp-ask',
    );
    expect(dockerfile).toContain(
      'COPY container/scripts/cnp-confirm /usr/local/bin/cnp-confirm',
    );
    expect(dockerfile).toContain(
      'RUN chmod +x /usr/local/bin/cnp-ask /usr/local/bin/cnp-confirm',
    );
  });

  it('cnp-confirm 应优先使用 IPC_DIR 环境变量写入确认请求并读取响应', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cnp-confirm-'));
    tempDirs.push(tempDir);

    const ipcDir = path.join(tempDir, 'ipc');
    const requestDir = path.join(ipcDir, 'confirm_requests');
    const responseDir = path.join(ipcDir, 'confirm_responses');
    const script = path.resolve(process.cwd(), 'container/scripts/cnp-confirm');

    const child = spawn(
      'bash',
      [script, 'rm -rf /tmp/cnp-danger-test', '递归强制删除文件'],
      {
        env: {
          ...process.env,
          IPC_DIR: ipcDir,
          CNP_BOT_CHAT_JID: 'web:test-confirm',
        },
        stdio: 'pipe',
      },
    );

    const requestFile = await waitForJsonFile(requestDir);
    const request = JSON.parse(fs.readFileSync(requestFile, 'utf8')) as {
      type: string;
      chatJid: string;
      command: string;
      reason: string;
      requestId: string;
    };

    expect(request.type).toBe('confirm_bash');
    expect(request.chatJid).toBe('web:test-confirm');
    expect(request.command).toBe('rm -rf /tmp/cnp-danger-test');
    expect(request.reason).toBe('递归强制删除文件');

    fs.mkdirSync(responseDir, { recursive: true });
    fs.writeFileSync(
      path.join(responseDir, `${request.requestId}.json`),
      JSON.stringify({ approved: true }),
    );

    const exitCode = await waitForExit(child);
    expect(exitCode).toBe(0);
  });

  it('cnp-confirm 遇到尚未写完的响应文件时应继续等待，而不是直接失败', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cnp-confirm-'));
    tempDirs.push(tempDir);

    const ipcDir = path.join(tempDir, 'ipc');
    const requestDir = path.join(ipcDir, 'confirm_requests');
    const responseDir = path.join(ipcDir, 'confirm_responses');
    const script = path.resolve(process.cwd(), 'container/scripts/cnp-confirm');

    const child = spawn(
      'bash',
      [script, 'git reset --hard', '强制重置 Git 历史（可能丢失提交）'],
      {
        env: {
          ...process.env,
          IPC_DIR: ipcDir,
          CNP_BOT_CHAT_JID: 'web:test-confirm-retry',
        },
        stdio: 'pipe',
      },
    );

    const requestFile = await waitForJsonFile(requestDir);
    const request = JSON.parse(fs.readFileSync(requestFile, 'utf8')) as {
      requestId: string;
    };

    fs.mkdirSync(responseDir, { recursive: true });
    const responseFile = path.join(responseDir, `${request.requestId}.json`);
    fs.writeFileSync(responseFile, '{"approved":');
    await delay(150);
    fs.writeFileSync(responseFile, JSON.stringify({ approved: false }));

    const exitCode = await waitForExit(child);
    expect(exitCode).toBe(2);
  });
});
