import { describe, expect, it } from 'vitest';

import { getSystemConfigField, listSystemConfigFields, listSystemConfigSections } from './system-config-schema.js';

const EXPECTED_KEYS = [
  'ASSISTANT_NAME',
  'ASSISTANT_HAS_OWN_NUMBER',
  'USE_LOCAL_AGENT',
  'DEFAULT_AGENT_TYPE',
  'DEEP_AGENT_MODEL',
  'DEEP_AGENT_RUNNER_PATH',
  'DEEP_AGENT_PYTHON',
  'CONTAINER_IMAGE',
  'CONTAINER_TIMEOUT',
  'CONTAINER_MAX_OUTPUT_SIZE',
  'IDLE_TIMEOUT',
  'MAX_CONCURRENT_CONTAINERS',
  'TIMEZONE',
  'JWT_SECRET',
  'JWT_EXPIRES_IN',
  'KB_API_URL',
  'KB_API_KEY',
  'KB_API_ACCOUNT',
  'KB_API_USER',
  'KB_API_AGENT_ID',
  'KB_ROOT_URI',
  'KB_INJECT_LIMIT',
  'KB_SEARCH_TIMEOUT',
  'KB_EXTRACT_TIMEOUT',
  'KB_SUMMARY_LLM_API_URL',
  'KB_SUMMARY_LLM_API_KEY',
  'KB_SUMMARY_LLM_MODEL',
  'KB_SUMMARY_LLM_TIMEOUT',
] as const;

describe('system config schema', () => {
  it('includes every editable system config key', () => {
    expect(listSystemConfigFields().map((field) => field.key)).toEqual([...EXPECTED_KEYS]);
  });

  it('exposes the expected section titles', () => {
    expect(listSystemConfigSections().map((section) => section.title)).toEqual([
      'Agent 基础',
      'DeepAgent',
      '运行时',
      '认证安全',
      '知识库',
      '草稿总结 LLM',
    ]);
  });

  it('marks every field as restart required', () => {
    for (const field of listSystemConfigFields()) {
      expect(field.restartRequired).toBe(true);
    }
  });

  it('keeps the schema internally consistent', () => {
    const sections = listSystemConfigSections();
    const sectionIds = new Set(sections.map((section) => section.id));
    const fields = listSystemConfigFields();

    expect(new Set(fields.map((field) => field.key)).size).toBe(fields.length);

    for (const field of fields) {
      expect(sectionIds.has(field.section)).toBe(true);
      if (field.type === 'select') {
        expect(field.options).toBeDefined();
        expect(field.options).not.toHaveLength(0);
      }
      if (field.type === 'secret') {
        expect(field.secret).toBe(true);
      }
    }
  });

  it('returns schema copies instead of shared references', () => {
    const field = getSystemConfigField('DEFAULT_AGENT_TYPE');
    expect(field).toBeDefined();
    if (!field) return;

    field.label = 'mutated label';
    field.options?.push({ label: 'Mutated', value: 'mutated' });

    const freshField = getSystemConfigField('DEFAULT_AGENT_TYPE');
    expect(freshField?.label).toBe('默认 Agent 类型');
    expect(freshField?.options).toHaveLength(2);
  });
});
