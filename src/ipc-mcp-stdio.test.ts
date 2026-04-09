import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, describe, expect, it } from 'vitest';

import { Client } from '../container/agent-runner/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '../container/agent-runner/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForJsonFile(dir: string, timeoutMs = 1500): Promise<string> {
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

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('ipc-mcp-stdio', () => {
  it('search_knowledge_base 应优先使用 IPC_DIR 环境变量写入知识库请求', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cnp-kb-mcp-'));
    tempDirs.push(tempDir);

    const ipcDir = path.join(tempDir, 'ipc');
    const requestDir = path.join(ipcDir, 'kb_requests');
    const responseDir = path.join(ipcDir, 'kb_responses');
    const serverPath = path.resolve(
      process.cwd(),
      'container/agent-runner/src/ipc-mcp-stdio.ts',
    );

    const transport = new StdioClientTransport({
      command: 'node',
      args: ['--import', 'tsx', serverPath],
      cwd: process.cwd(),
      env: {
        ...process.env,
        IPC_DIR: ipcDir,
        CNP_BOT_CHAT_JID: 'web:test-kb-search',
        CNP_BOT_GROUP_FOLDER: 'main',
        CNP_BOT_IS_MAIN: '1',
      },
      stderr: 'pipe',
    });
    const client = new Client({ name: 'kb-ipc-test', version: '1.0.0' });
    const stderrChunks: string[] = [];
    transport.stderr?.on('data', (chunk) => {
      stderrChunks.push(String(chunk));
    });

    let toolPromise: Promise<Awaited<ReturnType<Client['callTool']>>> | undefined;
    try {
      await client.connect(transport);
      toolPromise = client.callTool({
        name: 'search_knowledge_base',
        arguments: {
          query: '数据库连接超时',
          limit: 1,
        },
      });

      const requestFile = await waitForJsonFile(requestDir);
      const request = JSON.parse(fs.readFileSync(requestFile, 'utf8')) as {
        type: string;
        requestId: string;
        query: string;
        limit: number;
      };

      expect(request.type).toBe('kb_search');
      expect(request.query).toBe('数据库连接超时');
      expect(request.limit).toBe(1);

      fs.mkdirSync(responseDir, { recursive: true });
      fs.writeFileSync(
        path.join(responseDir, `${request.requestId}.json`),
        JSON.stringify({
          results: [
            {
              uri: 'viking://resources/cnp-kb/数据库连接超时排查.md',
              content: '# 数据库连接超时排查',
              score: 0.95,
            },
          ],
        }),
      );

      const result = await toolPromise;
      expect(result.isError).not.toBe(true);
      expect(result.content).toEqual([
        {
          type: 'text',
          text: expect.stringContaining('数据库连接超时排查'),
        },
      ]);
    } catch (err) {
      if (stderrChunks.length > 0) {
        throw new Error(
          `${err instanceof Error ? err.message : String(err)}\n\nstderr:\n${stderrChunks.join('')}`,
        );
      }
      throw err;
    } finally {
      await client.close().catch(() => undefined);
      await (toolPromise?.catch(() => undefined) ?? Promise.resolve());
    }
  });
});
