import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';

export function getEnvFilePath(): string {
  return path.join(process.cwd(), '.env');
}

export function readEnvText(): string {
  try {
    return fs.readFileSync(getEnvFilePath(), 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      logger.debug({ err }, '.env file not found, using defaults');
      return '';
    }
    throw err;
  }
}

export function parseEnvFileValue(rawValue: string): string {
  const trimmed = rawValue.trim();
  if (trimmed.length < 2) return trimmed;

  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if (first !== last || (first !== '"' && first !== "'")) return trimmed;

  const inner = trimmed.slice(1, -1);
  if (first === '"') {
    return inner
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
  return inner.replace(/\\'/g, "'").replace(/\\\\/g, '\\');
}

export function formatEnvFileValue(value: string): string {
  if (value === '') return '';
  if (/^[A-Za-z0-9_./:@-]+$/.test(value)) return value;
  if (!value.includes("'") && !value.includes('\n')) {
    return `'${value}'`;
  }

  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

/**
 * Parse the .env file and return values for the requested keys.
 * Does NOT load anything into process.env — callers decide what to
 * do with the values. This keeps secrets out of the process environment
 * so they don't leak to child processes.
 */
export function readEnvFile(keys: string[]): Record<string, string> {
  const content = readEnvText();
  if (!content) return {};

  const result: Record<string, string> = {};
  const wanted = new Set(keys);

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    if (!wanted.has(key)) continue;
    const value = parseEnvFileValue(trimmed.slice(eqIdx + 1));
    if (value) result[key] = value;
  }

  return result;
}
