import fs from 'fs';
import path from 'path';

import {
  getEnvFilePath,
  formatEnvFileValue,
  parseEnvFileValue,
  readEnvText,
} from './env.js';
import {
  getSystemConfigField,
  listSystemConfigSections,
  type SystemConfigFieldType,
  listSystemConfigFields,
  type SystemConfigField,
  type SystemConfigKey,
} from './system-config-schema.js';

export type SystemConfigValues = Record<SystemConfigKey, string>;
export type SystemConfigInputValues = Partial<SystemConfigValues>;
export type EditableEnvConfigValues = Record<string, string>;

export interface EditableEnvConfigField {
  key: string;
  section: string;
  label: string;
  type: SystemConfigFieldType;
  required: boolean;
  secret: boolean;
  restartRequired: boolean;
  defaultValue?: string;
  options?: Array<{ label: string; value: string }>;
  dangerLevel?: 'normal' | 'warning' | 'danger';
  dangerMessage?: string;
}

export interface EditableEnvConfigSection {
  id: string;
  title: string;
}

export interface SystemConfigSnapshot {
  values: Record<string, string>;
  changedKeys: string[];
  restartRequired: boolean;
}

type ParsedEnvLine =
  | { kind: 'blank'; raw: string }
  | { kind: 'comment'; raw: string }
  | { kind: 'kv'; raw: string; key: string; value: string; managed: boolean }
  | { kind: 'other'; raw: string };

const MANAGED_FIELDS = listSystemConfigFields();
const MANAGED_KEY_SET = new Set<string>(MANAGED_FIELDS.map((field) => field.key));
const SYSTEM_SECTION_TITLE_MAP = new Map<string, string>(
  listSystemConfigSections().map((section) => [section.id, section.title]),
);

function assertKnownInputKeys(values: SystemConfigInputValues): void {
  for (const key of Object.keys(values as Record<string, unknown>)) {
    if (!MANAGED_KEY_SET.has(key)) {
      throw new Error(`Unknown system config value: ${key}`);
    }
  }
}

function listEnvKeys(lines: ParsedEnvLine[]): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    if (line.kind !== 'kv') continue;
    if (seen.has(line.key)) continue;
    seen.add(line.key);
    keys.push(line.key);
  }
  return keys;
}

function inferCustomSection(key: string): EditableEnvConfigSection {
  const prefix = key.includes('_') ? key.split('_')[0] : '';
  if (!prefix) {
    return {
      id: 'env-other',
      title: '其他 .env',
    };
  }

  return {
    id: `env-${prefix.toLowerCase()}`,
    title: `${prefix} .env`,
  };
}

function inferCustomFieldType(key: string, value: string): SystemConfigFieldType {
  if (/(SECRET|TOKEN|KEY|PASS|PASSWORD)/i.test(key)) {
    return 'secret';
  }
  if (value === 'true' || value === 'false') {
    return 'toggle';
  }
  if (/^\d+$/.test(value)) {
    return 'number';
  }
  return 'text';
}

function inferCustomField(key: string, value: string): EditableEnvConfigField {
  const section = inferCustomSection(key);
  const type = inferCustomFieldType(key, value);
  return {
    key,
    section: section.id,
    label: key,
    type,
    required: value.trim() !== '',
    secret: type === 'secret',
    restartRequired: true,
  };
}

function cloneEditableField(field: EditableEnvConfigField): EditableEnvConfigField {
  return {
    ...field,
    options: field.options?.map((option) => ({ ...option })),
  };
}

function buildEditableEnvFieldsFromLines(lines: ParsedEnvLine[]): EditableEnvConfigField[] {
  const values = buildAllEnvValueMap(lines);
  return listEnvKeys(lines).map((key) => {
    const knownField = getSystemConfigField(key);
    if (knownField) {
      return cloneEditableField(knownField);
    }
    return inferCustomField(key, values[key] ?? '');
  });
}

function buildEditableEnvSectionsFromFields(
  fields: EditableEnvConfigField[],
): EditableEnvConfigSection[] {
  const sections: EditableEnvConfigSection[] = [];
  const seen = new Set<string>();

  for (const field of fields) {
    if (seen.has(field.section)) continue;
    seen.add(field.section);
    sections.push({
      id: field.section,
      title: SYSTEM_SECTION_TITLE_MAP.get(field.section) ?? inferCustomSection(field.key).title,
    });
  }

  return sections;
}

function buildAllEnvValueMap(lines: ParsedEnvLine[]): EditableEnvConfigValues {
  const values: EditableEnvConfigValues = {};
  for (const line of lines) {
    if (line.kind !== 'kv') continue;
    if (Object.prototype.hasOwnProperty.call(values, line.key)) continue;
    values[line.key] = line.value;
  }
  return values;
}

function validateEditableEnvFieldValue(field: EditableEnvConfigField, value: string): void {
  const trimmed = value.trim();

  if (field.required && trimmed === '') {
    throw new Error(`Missing required env config value: ${field.key}`);
  }

  if (trimmed === '') return;

  if (field.type === 'number' && !/^\d+$/.test(trimmed)) {
    throw new Error(`Invalid number for env config value: ${field.key}`);
  }

  if (field.type === 'select' && field.options) {
    const allowedValues = new Set(field.options.map((option) => option.value));
    if (!allowedValues.has(trimmed)) {
      throw new Error(`Invalid select value for env config value: ${field.key}`);
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
    current[line.key as SystemConfigKey] = line.value;
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
      updatedLines.push(
        `${line.key}=${formatEnvFileValue(values[line.key as SystemConfigKey] ?? '')}`,
      );
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

export function listEditableEnvConfigFields(): EditableEnvConfigField[] {
  return buildEditableEnvFieldsFromLines(parseEnvLines(readEnvText()));
}

export function listEditableEnvConfigSections(): EditableEnvConfigSection[] {
  return buildEditableEnvSectionsFromFields(listEditableEnvConfigFields());
}

export function loadEditableEnvConfigValues(): EditableEnvConfigValues {
  return buildAllEnvValueMap(parseEnvLines(readEnvText()));
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

export function saveEditableEnvConfigValues(
  values: EditableEnvConfigValues,
): SystemConfigSnapshot {
  const currentLines = parseEnvLines(readEnvText());
  const currentValues = buildAllEnvValueMap(currentLines);
  const editableFields = buildEditableEnvFieldsFromLines(currentLines);
  const editableFieldMap = new Map(editableFields.map((field) => [field.key, field] as const));

  for (const key of Object.keys(values)) {
    if (!editableFieldMap.has(key)) {
      throw new Error(`Unknown env config value: ${key}`);
    }
  }

  const nextValues: EditableEnvConfigValues = {};
  const changedKeys: string[] = [];
  let restartRequired = false;

  for (const field of editableFields) {
    const nextValue = values[field.key] ?? currentValues[field.key] ?? '';
    validateEditableEnvFieldValue(field, nextValue);
    nextValues[field.key] = nextValue;
    if ((currentValues[field.key] ?? '') !== nextValue) {
      changedKeys.push(field.key);
      restartRequired = restartRequired || field.restartRequired;
    }
  }

  const outputLines = currentLines.map((line) => {
    if (line.kind !== 'kv') return line.raw;
    if (!Object.prototype.hasOwnProperty.call(nextValues, line.key)) return line.raw;
    return `${line.key}=${formatEnvFileValue(nextValues[line.key] ?? '')}`;
  });

  writeAtomicFile(getEnvFilePath(), `${outputLines.join('\n')}\n`);

  return {
    values: nextValues,
    changedKeys,
    restartRequired,
  };
}
