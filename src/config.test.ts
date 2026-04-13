import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_KB_API_URL = process.env.KB_API_URL;
const ORIGINAL_KB_API_KEY = process.env.KB_API_KEY;
const ORIGINAL_KB_API_ACCOUNT = process.env.KB_API_ACCOUNT;
const ORIGINAL_KB_API_USER = process.env.KB_API_USER;
const ORIGINAL_KB_API_AGENT_ID = process.env.KB_API_AGENT_ID;
const ORIGINAL_KB_ROOT_URI = process.env.KB_ROOT_URI;
const ORIGINAL_KB_SUMMARY_LLM_API_URL = process.env.KB_SUMMARY_LLM_API_URL;
const ORIGINAL_KB_SUMMARY_LLM_API_KEY = process.env.KB_SUMMARY_LLM_API_KEY;
const ORIGINAL_KB_SUMMARY_LLM_MODEL = process.env.KB_SUMMARY_LLM_MODEL;
const ORIGINAL_KB_SUMMARY_LLM_TIMEOUT = process.env.KB_SUMMARY_LLM_TIMEOUT;

describe('config KB env loading', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.KB_API_URL;
    delete process.env.KB_API_KEY;
    delete process.env.KB_API_ACCOUNT;
    delete process.env.KB_API_USER;
    delete process.env.KB_API_AGENT_ID;
    delete process.env.KB_ROOT_URI;
    delete process.env.KB_SUMMARY_LLM_API_URL;
    delete process.env.KB_SUMMARY_LLM_API_KEY;
    delete process.env.KB_SUMMARY_LLM_MODEL;
    delete process.env.KB_SUMMARY_LLM_TIMEOUT;
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

    if (ORIGINAL_KB_API_ACCOUNT === undefined) {
      delete process.env.KB_API_ACCOUNT;
    } else {
      process.env.KB_API_ACCOUNT = ORIGINAL_KB_API_ACCOUNT;
    }

    if (ORIGINAL_KB_API_USER === undefined) {
      delete process.env.KB_API_USER;
    } else {
      process.env.KB_API_USER = ORIGINAL_KB_API_USER;
    }

    if (ORIGINAL_KB_API_AGENT_ID === undefined) {
      delete process.env.KB_API_AGENT_ID;
    } else {
      process.env.KB_API_AGENT_ID = ORIGINAL_KB_API_AGENT_ID;
    }

    if (ORIGINAL_KB_ROOT_URI === undefined) {
      delete process.env.KB_ROOT_URI;
    } else {
      process.env.KB_ROOT_URI = ORIGINAL_KB_ROOT_URI;
    }

    if (ORIGINAL_KB_SUMMARY_LLM_API_URL === undefined) {
      delete process.env.KB_SUMMARY_LLM_API_URL;
    } else {
      process.env.KB_SUMMARY_LLM_API_URL = ORIGINAL_KB_SUMMARY_LLM_API_URL;
    }

    if (ORIGINAL_KB_SUMMARY_LLM_API_KEY === undefined) {
      delete process.env.KB_SUMMARY_LLM_API_KEY;
    } else {
      process.env.KB_SUMMARY_LLM_API_KEY = ORIGINAL_KB_SUMMARY_LLM_API_KEY;
    }

    if (ORIGINAL_KB_SUMMARY_LLM_MODEL === undefined) {
      delete process.env.KB_SUMMARY_LLM_MODEL;
    } else {
      process.env.KB_SUMMARY_LLM_MODEL = ORIGINAL_KB_SUMMARY_LLM_MODEL;
    }

    if (ORIGINAL_KB_SUMMARY_LLM_TIMEOUT === undefined) {
      delete process.env.KB_SUMMARY_LLM_TIMEOUT;
    } else {
      process.env.KB_SUMMARY_LLM_TIMEOUT = ORIGINAL_KB_SUMMARY_LLM_TIMEOUT;
    }
  });

  it('应优先使用 .env 中的知识库配置', async () => {
    vi.doMock('./env.js', () => ({
      readEnvFile: () => ({
        KB_API_URL: 'http://kb.internal:1933',
        KB_API_KEY: 'kb-secret',
        KB_API_ACCOUNT: 'acme',
        KB_API_USER: 'alice',
        KB_API_AGENT_ID: 'assistant-1',
        KB_ROOT_URI: 'viking://resources/test-kb/',
        KB_SUMMARY_LLM_API_URL: 'https://llm.example/v1',
        KB_SUMMARY_LLM_API_KEY: 'summary-secret',
        KB_SUMMARY_LLM_MODEL: 'gpt-4.1-mini',
        KB_SUMMARY_LLM_TIMEOUT: '12000',
      }),
    }));

    const config = await import('./config.js');

    expect(config.KB_API_URL).toBe('http://kb.internal:1933');
    expect(config.KB_API_KEY).toBe('kb-secret');
    expect(config.KB_API_ACCOUNT).toBe('acme');
    expect(config.KB_API_USER).toBe('alice');
    expect(config.KB_API_AGENT_ID).toBe('assistant-1');
    expect(config.KB_ROOT_URI).toBe('viking://resources/test-kb/');
    expect(config.KB_SUMMARY_LLM_API_URL).toBe('https://llm.example/v1');
    expect(config.KB_SUMMARY_LLM_API_KEY).toBe('summary-secret');
    expect(config.KB_SUMMARY_LLM_MODEL).toBe('gpt-4.1-mini');
    expect(config.KB_SUMMARY_LLM_TIMEOUT).toBe(12000);
  });
});
