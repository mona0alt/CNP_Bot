import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_KB_API_URL = process.env.KB_API_URL;
const ORIGINAL_KB_API_KEY = process.env.KB_API_KEY;
const ORIGINAL_KB_ROOT_URI = process.env.KB_ROOT_URI;

describe('config KB env loading', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.KB_API_URL;
    delete process.env.KB_API_KEY;
    delete process.env.KB_ROOT_URI;
  });

  afterEach(() => {
    vi.doUnmock('./env.js');
    vi.resetModules();

    if (ORIGINAL_KB_API_URL === undefined) {
      delete process.env.KB_API_URL;
    } else {
      process.env.KB_API_URL = ORIGINAL_KB_API_URL;
    }

    if (ORIGINAL_KB_API_KEY === undefined) {
      delete process.env.KB_API_KEY;
    } else {
      process.env.KB_API_KEY = ORIGINAL_KB_API_KEY;
    }

    if (ORIGINAL_KB_ROOT_URI === undefined) {
      delete process.env.KB_ROOT_URI;
    } else {
      process.env.KB_ROOT_URI = ORIGINAL_KB_ROOT_URI;
    }
  });

  it('应优先使用 .env 中的知识库配置', async () => {
    vi.doMock('./env.js', () => ({
      readEnvFile: () => ({
        KB_API_URL: 'http://kb.internal:1933',
        KB_API_KEY: 'kb-secret',
        KB_ROOT_URI: 'viking://resources/test-kb/',
      }),
    }));

    const config = await import('./config.js');

    expect(config.KB_API_URL).toBe('http://kb.internal:1933');
    expect(config.KB_API_KEY).toBe('kb-secret');
    expect(config.KB_ROOT_URI).toBe('viking://resources/test-kb/');
  });
});
