import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { EventEmitter } from 'events';

const TEST_ROOT = path.join(os.tmpdir(), 'cnp-bot-container-runner-test');
const DATA_DIR = path.join(TEST_ROOT, 'data');
const GROUPS_DIR = path.join(TEST_ROOT, 'groups');

vi.mock('./config.js', () => ({
  AgentType: {},
  CONTAINER_IMAGE: 'cnp-bot-agent:latest',
  CONTAINER_MAX_OUTPUT_SIZE: 1024 * 1024,
  CONTAINER_TIMEOUT: 30_000,
  DATA_DIR,
  DEEP_AGENT_MODEL: 'test-model',
  DEEP_AGENT_PYTHON: 'python3',
  GROUPS_DIR,
  IDLE_TIMEOUT: 5_000,
  TIMEZONE: 'Asia/Shanghai',
  USE_LOCAL_AGENT: true,
}));

vi.mock('./env.js', () => ({
  readEnvFile: vi.fn(() => ({})),
}));

vi.mock('./mount-security.js', () => ({
  validateAdditionalMounts: vi.fn((mounts: Array<{ hostPath: string }>) =>
    mounts.map((mount) => ({
      hostPath: mount.hostPath,
      containerPath: '/workspace/extra/mounted-repo',
      readonly: true,
    })),
  ),
}));

class FakeChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = {
    write: vi.fn(),
    end: vi.fn(),
  };
  kill = vi.fn();
}

const spawnMock = vi.fn();

vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  return {
    ...actual,
    spawn: spawnMock,
    exec: vi.fn(),
  };
});

describe('runContainerAgent', () => {
  beforeEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.mkdirSync(path.join(GROUPS_DIR, 'global'), { recursive: true });
    spawnMock.mockReset();
  });

  afterEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('在本地 agent 模式下为 additional mounts 建立 workspace/extra 映射', async () => {
    const mountSource = path.join(TEST_ROOT, 'mounted-repo-src');
    fs.mkdirSync(mountSource, { recursive: true });
    fs.writeFileSync(path.join(mountSource, 'AGENTS.md'), '# mounted memory\n');

    spawnMock.mockImplementation(() => {
      const proc = new FakeChildProcess();
      queueMicrotask(() => {
        proc.stdout.emit(
          'data',
          '---CNP_BOT_OUTPUT_START---{"status":"success","result":"ok"}---CNP_BOT_OUTPUT_END---',
        );
        proc.emit('close', 0);
      });
      return proc;
    });

    const { runContainerAgent } = await import('./container-runner.js');

    const result = await runContainerAgent(
      {
        name: 'Main',
        folder: 'main',
        trigger: '@bot',
        added_at: '2026-04-03T00:00:00.000Z',
        containerConfig: {
          additionalMounts: [{ hostPath: mountSource, readonly: true }],
        },
      },
      {
        prompt: 'test',
        groupFolder: 'main',
        chatJid: 'web:test',
        isMain: true,
        assistantName: 'CNP_Bot',
      },
      () => {},
    );

    expect(result.status).toBe('success');

    const mountedPath = path.join(DATA_DIR, 'workspaces', 'main', 'extra', 'mounted-repo');
    expect(fs.existsSync(mountedPath)).toBe(true);
    expect(fs.lstatSync(mountedPath).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(path.join(mountedPath, 'AGENTS.md'), 'utf-8')).toContain('mounted memory');
  });
});
