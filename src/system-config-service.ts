import fs from 'fs';
import path from 'path';

import {
  getEnvFilePath,
  formatEnvFileValue,
  parseEnvFileValue,
  readEnvText,
} from './env.js';
import {
  listSystemConfigFields,
  type SystemConfigField,
  type SystemConfigKey,
} from './system-config-schema.js';

export type SystemConfigValues = Record<SystemConfigKey, string>;
export type SystemConfigInputValues = Partial<SystemConfigValues>;

export interface SystemConfigSnapshot {
  values: SystemConfigValues;
  changedKeys: SystemConfigKey[];
  restartRequired: boolean;
}

type ParsedEnvLine =
  | { kind: 'blank'; raw: string }
  | { kind: 'comment'; raw: string }
  | { kind: 'kv'; raw: string; key: string; value: string; managed: boolean }
  | { kind: 'other'; raw: string };

const MANAGED_FIELDS = listSystemConfigFields();
const MANAGED_KEY_SET = new Set<string>(MANAGED_FIELDS.map((field) => field.key));

function assertKnownInputKeys(values: SystemConfigInputValues): void {
  for (const key of Object.keys(values as Record<string, unknown>)) {
    if (!MANAGED_KEY_SET.has(key)) {
      throw new Error(`Unknown system config value: ${key}`);
    }
  }
}

function parseEnvLines(content: string): ParsedEnvLine[] {
  if (!content) return [];

  return content
    .split(/\r?\n/)
    .filter((line, index, lines) => !(index === lines.length - 1 && line === ''))
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return { kind: 'blank', raw: line };
      if (trimmed.startsWith('#')) return { kind: 'comment', raw: line };

      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!match) return { kind: 'other', raw: line };

      const key = match[1];
      const value = parseEnvFileValue(match[2] ?? '');
      return {
        kind: 'kv',
        raw: line,
        key,
        value,
        managed: MANAGED_KEY_SET.has(key),
      };
    });
}

function buildCurrentValueMap(lines: ParsedEnvLine[]): SystemConfigValues {
  const current = {} as SystemConfigValues;
  for (const field of MANAGED_FIELDS) {
    current[field.key] = field.defaultValue ?? '';
  }

  for (const line of lines) {
    if (line.kind !== 'kv' || !line.managed) continue;
    current[line.key] = line.value;
  }

  return current;
}

function normalizeInputValues(values: SystemConfigInputValues): SystemConfigValues {
  const normalized = {} as SystemConfigValues;
  for (const field of MANAGED_FIELDS) {
    const value = values[field.key];
    normalized[field.key] = value ?? field.defaultValue ?? '';
  }
  return normalized;
}

function validateFieldValue(field: SystemConfigField, value: string): void {
  const trimmed = value.trim();

  if (field.required && trimmed === '') {
    throw new Error(`Missing required system config value: ${field.key}`);
  }

  if (trimmed === '') return;

  if (field.type === 'number' && !/^\d+$/.test(trimmed)) {
    throw new Error(`Invalid number for system config value: ${field.key}`);
  }

  if (field.type === 'select') {
    const allowedValues = new Set((field.options ?? []).map((option) => option.value));
    if (!allowedValues.has(trimmed)) {
      throw new Error(`Invalid select value for system config value: ${field.key}`);
    }
  }
}

function buildOutputLines(
  lines: ParsedEnvLine[],
  values: SystemConfigValues,
): string[] {
  const updatedLines: string[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    if (line.kind === 'kv' && line.managed) {
      seen.add(line.key);
      updatedLines.push(`${line.key}=${formatEnvFileValue(values[line.key] ?? '')}`);
      continue;
    }
    updatedLines.push(line.raw);
  }

  for (const field of MANAGED_FIELDS) {
    if (seen.has(field.key)) continue;
    updatedLines.push(`${field.key}=${formatEnvFileValue(values[field.key] ?? '')}`);
  }

  return updatedLines;
}

function writeAtomicFile(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  const tempPath = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );

  try {
    fs.writeFileSync(tempPath, content, 'utf-8');
    if (fs.existsSync(filePath)) {
      fs.chmodSync(tempPath, fs.statSync(filePath).mode);
    }
    fs.renameSync(tempPath, filePath);
  } finally {
    if (fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        // best effort cleanup; never hide the original write/rename failure
      }
    }
  }
}

export function loadSystemConfigValues(): SystemConfigValues {
  const parsedLines = parseEnvLines(readEnvText());
  return buildCurrentValueMap(parsedLines);
}

export function validateSystemConfigValues(values: SystemConfigInputValues): void {
  assertKnownInputKeys(values);
  const normalized = normalizeInputValues(values);
  for (const field of MANAGED_FIELDS) {
    validateFieldValue(field, normalized[field.key]);
  }
}

export function saveSystemConfigValues(values: SystemConfigInputValues): SystemConfigSnapshot {
  assertKnownInputKeys(values);
  const normalized = normalizeInputValues(values);
  validateSystemConfigValues(normalized);

  const currentLines = parseEnvLines(readEnvText());
  const currentValues = buildCurrentValueMap(currentLines);
  const changedKeys: SystemConfigKey[] = [];
  let restartRequired = false;

  for (const field of MANAGED_FIELDS) {
    const currentValue = currentValues[field.key] ?? field.defaultValue ?? '';
    const nextValue = normalized[field.key] ?? field.defaultValue ?? '';
    if (currentValue === nextValue) continue;

    changedKeys.push(field.key);
    restartRequired = restartRequired || field.restartRequired;
  }

  const output = buildOutputLines(currentLines, normalized).join('\n') + '\n';
  writeAtomicFile(getEnvFilePath(), output);

  return {
    values: normalized,
    changedKeys,
    restartRequired,
  };
}
