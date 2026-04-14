import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readEnvFile as readEnvValuesFromFile, readEnvText } from './env.js';
import { listSystemConfigFields } from './system-config-schema.js';
import {
  listEditableEnvConfigFields,
  listEditableEnvConfigSections,
  loadEditableEnvConfigValues,
  saveEditableEnvConfigValues,
  loadSystemConfigValues,
  saveSystemConfigValues,
  validateSystemConfigValues,
  type SystemConfigValues,
} from './system-config-service.js';

const ORIGINAL_CWD = process.cwd();

function setTempCwd(): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'system-config-service-'));
  process.chdir(tempDir);
  return tempDir;
}

function restoreCwd(): void {
  process.chdir(ORIGINAL_CWD);
}

function writeEnvFile(content: string): void {
  fs.writeFileSync(path.join(process.cwd(), '.env'), content);
}

function readRawEnvFile(): string {
  return fs.readFileSync(path.join(process.cwd(), '.env'), 'utf-8');
}

function buildValidValues(overrides: Partial<SystemConfigValues> = {}): SystemConfigValues {
  const values = {} as SystemConfigValues;
  for (const field of listSystemConfigFields()) {
    if (field.type === 'number') {
      values[field.key] = '123';
      continue;
    }
    if (field.type === 'select') {
      values[field.key] = field.options?.[0]?.value ?? '';
      continue;
    }
    if (field.type === 'secret') {
      values[field.key] = field.required ? 'secret-value' : '';
      continue;
    }
    values[field.key] = field.required ? `${field.key}-value` : '';
  }

  return { ...values, ...overrides };
}

function writeEnvFromValues(values: SystemConfigValues, prefix: string[] = []): void {
  const lines = [...prefix];
  for (const field of listSystemConfigFields()) {
    lines.push(`${field.key}=${values[field.key] ?? ''}`);
  }
  lines.push('');
  writeEnvFile(lines.join('\n'));
}

describe('system config service', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = setTempCwd();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    restoreCwd();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('loads current values from .env using schema defaults and empty values', () => {
    writeEnvFile([
      '# header comment',
      'ASSISTANT_NAME=Nova',
      'DEFAULT_AGENT_TYPE=claude',
      'CONTAINER_TIMEOUT=2000',
      'KB_API_URL=',
      'UNKNOWN_KEY=keep-me',
      '',
    ].join('\n'));

    const values = loadSystemConfigValues();

    expect(values.ASSISTANT_NAME).toBe('Nova');
    expect(values.DEFAULT_AGENT_TYPE).toBe('claude');
    expect(values.CONTAINER_TIMEOUT).toBe('2000');
    expect(values.KB_API_URL).toBe('');
    expect(values.KB_API_KEY).toBe('');
    expect(Object.keys(values)).toEqual(listSystemConfigFields().map((field) => field.key));
    expect((values as Record<string, string>).UNKNOWN_KEY).toBeUndefined();
  });

  it('lists editable fields directly from .env including non-schema keys', () => {
    writeEnvFile([
      'ASSISTANT_NAME=Nova',
      'ANTHROPIC_BASE_URL=http://example.invalid',
      'ANTHROPIC_AUTH_TOKEN=top-secret',
      'JUMPSERVER_PORT=2222',
      '',
    ].join('\n'));

    const fields = listEditableEnvConfigFields();
    const sections = listEditableEnvConfigSections();
    const values = loadEditableEnvConfigValues();

    expect(fields.map((field) => field.key)).toEqual([
      'ASSISTANT_NAME',
      'ANTHROPIC_BASE_URL',
      'ANTHROPIC_AUTH_TOKEN',
      'JUMPSERVER_PORT',
    ]);
    expect(fields.find((field) => field.key === 'ANTHROPIC_AUTH_TOKEN')).toMatchObject({
      type: 'secret',
      section: 'env-anthropic',
    });
    expect(fields.find((field) => field.key === 'JUMPSERVER_PORT')).toMatchObject({
      type: 'number',
      section: 'env-jumpserver',
    });
    expect(sections).toEqual([
      { id: 'agent', title: 'Agent 基础' },
      { id: 'env-anthropic', title: 'ANTHROPIC .env' },
      { id: 'env-jumpserver', title: 'JUMPSERVER .env' },
    ]);
    expect(values).toEqual({
      ASSISTANT_NAME: 'Nova',
      ANTHROPIC_BASE_URL: 'http://example.invalid',
      ANTHROPIC_AUTH_TOKEN: 'top-secret',
      JUMPSERVER_PORT: '2222',
    });
  });

  it('saves editable .env values for both schema and non-schema keys', () => {
    writeEnvFile([
      '# keep me',
      'ASSISTANT_NAME=Nova',
      'ANTHROPIC_BASE_URL=http://old.invalid',
      'ANTHROPIC_AUTH_TOKEN=old-secret',
      '',
    ].join('\n'));

    const snapshot = saveEditableEnvConfigValues({
      ASSISTANT_NAME: 'CNP Bot',
      ANTHROPIC_BASE_URL: 'http://new.invalid',
      ANTHROPIC_AUTH_TOKEN: 'new-secret',
    });

    expect(readRawEnvFile()).toContain('# keep me');
    expect(readRawEnvFile()).toContain('ASSISTANT_NAME=\'CNP Bot\'');
    expect(readRawEnvFile()).toContain('ANTHROPIC_BASE_URL=http://new.invalid');
    expect(readRawEnvFile()).toContain('ANTHROPIC_AUTH_TOKEN=new-secret');
    expect(snapshot.changedKeys).toEqual([
      'ASSISTANT_NAME',
      'ANTHROPIC_BASE_URL',
      'ANTHROPIC_AUTH_TOKEN',
    ]);
    expect(snapshot.values).toEqual({
      ASSISTANT_NAME: 'CNP Bot',
      ANTHROPIC_BASE_URL: 'http://new.invalid',
      ANTHROPIC_AUTH_TOKEN: 'new-secret',
    });
  });

  it('preserves unknown env lines and comments when saving', () => {
    writeEnvFile([
      '# keep this comment',
      'UNKNOWN_KEY=keep-me',
      'ASSISTANT_NAME=Old',
      'DEFAULT_AGENT_TYPE=deepagent',
      'CONTAINER_TIMEOUT=1000',
      'CONTAINER_MAX_OUTPUT_SIZE=2000',
      'IDLE_TIMEOUT=3000',
      'MAX_CONCURRENT_CONTAINERS=4',
      'TIMEZONE=Asia/Shanghai',
      'JWT_SECRET=old-secret',
      'JWT_EXPIRES_IN=7d',
      'KB_INJECT_LIMIT=5',
      'KB_SEARCH_TIMEOUT=15000',
      'KB_EXTRACT_TIMEOUT=30000',
      'KB_SUMMARY_LLM_TIMEOUT=12000',
      '',
    ].join('\n'));

    const snapshot = saveSystemConfigValues(
      buildValidValues({
        ASSISTANT_NAME: 'New',
        DEFAULT_AGENT_TYPE: 'claude',
        KB_API_URL: 'https://example.invalid',
        KB_API_KEY: '',
        KB_API_ACCOUNT: 'default',
        KB_API_USER: 'default',
        KB_ROOT_URI: 'viking://resources/cnp-kb/',
        KB_SUMMARY_LLM_API_URL: '',
        KB_SUMMARY_LLM_API_KEY: '',
        KB_SUMMARY_LLM_MODEL: '',
      }),
    );

    const content = readRawEnvFile();

    expect(content).toContain('# keep this comment');
    expect(content).toContain('UNKNOWN_KEY=keep-me');
    expect(content).toContain('ASSISTANT_NAME=New');
    expect(content).toContain('DEFAULT_AGENT_TYPE=claude');
    expect(snapshot.changedKeys).toContain('ASSISTANT_NAME');
    expect(snapshot.restartRequired).toBe(true);
  });

  it('rejects missing required values', () => {
    expect(() =>
      validateSystemConfigValues(
        buildValidValues({
          ASSISTANT_NAME: '',
        }),
      ),
    ).toThrow(/ASSISTANT_NAME/);
  });

  it('rejects invalid number values', () => {
    expect(() =>
      validateSystemConfigValues(
        buildValidValues({
          CONTAINER_TIMEOUT: 'not-a-number',
        }),
      ),
    ).toThrow(/CONTAINER_TIMEOUT/);
  });

  it('rejects invalid select values', () => {
    expect(() =>
      validateSystemConfigValues(
        buildValidValues({
          DEFAULT_AGENT_TYPE: 'not-an-option',
        }),
      ),
    ).toThrow(/DEFAULT_AGENT_TYPE/);
  });

  it('rejects unknown input keys', () => {
    const values = {
      ...buildValidValues(),
      UNKNOWN_KEY: 'value',
    } as Record<string, string>;

    expect(() => validateSystemConfigValues(values)).toThrow(/UNKNOWN_KEY/);
    expect(() => saveSystemConfigValues(values)).toThrow(/UNKNOWN_KEY/);
  });

  it('round-trips quoted, escaped and special characters consistently', () => {
    const values = buildValidValues({
      ASSISTANT_NAME: 'Assistant Name',
      DEFAULT_AGENT_TYPE: 'claude',
      JWT_SECRET: 'pa ss "q" \\ #',
      KB_API_URL: 'https://example.invalid/path?a=1&b="two words"\\tail',
    });

    writeEnvFromValues(values);

    const snapshot = saveSystemConfigValues({
      ...values,
      JWT_SECRET: 'pa ss "q" \\ #',
      KB_API_URL: 'https://example.invalid/path?a=1&b="two words"\\tail',
    });

    expect(snapshot.changedKeys).toHaveLength(0);
    expect(readEnvValuesFromFile(['JWT_SECRET', 'KB_API_URL'])).toEqual({
      JWT_SECRET: 'pa ss "q" \\ #',
      KB_API_URL: 'https://example.invalid/path?a=1&b="two words"\\tail',
    });
  });

  it('throws on non-ENOENT read errors', () => {
    const error = new Error('permission denied') as NodeJS.ErrnoException;
    error.code = 'EACCES';
    vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw error;
    });

    expect(() => readEnvText()).toThrow('permission denied');
  });

  it('allows saving secret fields and empty optional values', () => {
    writeEnvFromValues(buildValidValues({
      ASSISTANT_NAME: 'Assistant',
      JWT_SECRET: 'old-secret',
      KB_API_KEY: 'old-key',
    }));

    const snapshot = saveSystemConfigValues(
      buildValidValues({
        ASSISTANT_NAME: 'Assistant',
        JWT_SECRET: 'new-secret',
        KB_API_KEY: '',
        KB_API_URL: '',
        KB_SUMMARY_LLM_API_KEY: '',
      }),
    );

    const content = readRawEnvFile();

    expect(content).toContain('JWT_SECRET=new-secret');
    expect(content).toContain('KB_API_KEY=');
    expect(content).toContain('KB_API_URL=');
    expect(snapshot.changedKeys).toEqual(expect.arrayContaining(['JWT_SECRET', 'KB_API_KEY']));
    expect(snapshot.changedKeys).toHaveLength(2);
    expect(snapshot.restartRequired).toBe(true);
  });

  it('returns changed keys and restartRequired', () => {
    writeEnvFromValues(buildValidValues({
      ASSISTANT_NAME: 'Assistant',
      DEFAULT_AGENT_TYPE: 'deepagent',
      CONTAINER_TIMEOUT: '1000',
      JWT_SECRET: 'secret-one',
    }));

    const snapshot = saveSystemConfigValues(
      buildValidValues({
        ASSISTANT_NAME: 'Assistant',
        DEFAULT_AGENT_TYPE: 'claude',
        CONTAINER_TIMEOUT: '1234',
        JWT_SECRET: 'secret-two',
      }),
    );

    expect(snapshot.changedKeys).toEqual([
      'DEFAULT_AGENT_TYPE',
      'CONTAINER_TIMEOUT',
      'JWT_SECRET',
    ]);
    expect(snapshot.restartRequired).toBe(true);
  });
});
