import path from 'path';

import { describe, expect, it } from 'vitest';

import { isValidGroupFolder, resolveGroupFolderPath, resolveGroupIpcPath } from './group-folder.js';

describe('group folder validation', () => {
  it('accepts normal group folder names', () => {
    expect(isValidGroupFolder('main')).toBe(true);
    expect(isValidGroupFolder('family-chat')).toBe(true);
    expect(isValidGroupFolder('Team_42')).toBe(true);
  });

  it('rejects traversal and reserved names', () => {
    expect(isValidGroupFolder('../../etc')).toBe(false);
    expect(isValidGroupFolder('/tmp')).toBe(false);
    expect(isValidGroupFolder('global')).toBe(false);
    expect(isValidGroupFolder('')).toBe(false);
  });

  it('resolves safe paths under groups directory', () => {
    const resolved = resolveGroupFolderPath('family-chat');
    expect(
      resolved.endsWith(`${path.sep}groups${path.sep}family-chat`),
    ).toBe(true);
  });

  it('resolves safe paths under data ipc directory', () => {
    const resolved = resolveGroupIpcPath('family-chat');
    expect(
      resolved.endsWith(`${path.sep}data${path.sep}ipc${path.sep}family-chat`),
    ).toBe(true);
  });

  it('throws for unsafe folder names', () => {
    expect(() => resolveGroupFolderPath('../../etc')).toThrow();
    expect(() => resolveGroupIpcPath('/tmp')).toThrow();
  });

  it('accepts a 64-character alphanumeric name (max length)', () => {
    const name = 'a'.repeat(64);
    expect(isValidGroupFolder(name)).toBe(true);
  });

  it('rejects a 65-character name (exceeds max length)', () => {
    const name = 'a'.repeat(65);
    expect(isValidGroupFolder(name)).toBe(false);
  });

  it('rejects names starting with a dash', () => {
    expect(isValidGroupFolder('-abc')).toBe(false);
  });

  it('rejects names starting with an underscore', () => {
    expect(isValidGroupFolder('_abc')).toBe(false);
  });

  it('rejects GLOBAL (case-insensitive reserved word)', () => {
    expect(isValidGroupFolder('GLOBAL')).toBe(false);
  });

  it('rejects Global (case-insensitive reserved word)', () => {
    expect(isValidGroupFolder('Global')).toBe(false);
  });

  it('accepts a single-character name', () => {
    expect(isValidGroupFolder('a')).toBe(true);
  });

  it('rejects names with leading or trailing whitespace', () => {
    expect(isValidGroupFolder(' main ')).toBe(false);
    expect(isValidGroupFolder(' main')).toBe(false);
    expect(isValidGroupFolder('main ')).toBe(false);
  });
});
