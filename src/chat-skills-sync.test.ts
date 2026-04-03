import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  _initTestDatabase,
  getSessionSkillSyncState,
  replaceSessionSkillBindings,
} from './db.js';
import {
  deleteChatSkillsDir,
  getChatActiveSkillsDir,
  syncChatSkills,
} from './chat-skills-sync.js';

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeFile(rootDir: string, relativePath: string, content: string): void {
  const fullPath = path.join(rootDir, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf8');
}

beforeEach(() => {
  _initTestDatabase();
});

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('chat skills sync', () => {
  it('copies all selected global skills into the session active directory', async () => {
    const globalRootDir = makeTempDir('global-skills-');
    const sessionRootDir = makeTempDir('session-skills-');

    writeFile(globalRootDir, 'tmux/SKILL.md', '# tmux');
    writeFile(globalRootDir, 'prometheus/SKILL.md', '# prometheus');
    replaceSessionSkillBindings('web:test', ['prometheus', 'tmux']);

    const result = await syncChatSkills({
      chatJid: 'web:test',
      globalRootDir,
      sessionRootDir,
    });

    expect(result).toEqual({ status: 'synced' });
    expect(
      fs.existsSync(
        path.join(getChatActiveSkillsDir('web:test', sessionRootDir), 'tmux/SKILL.md'),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(
          getChatActiveSkillsDir('web:test', sessionRootDir),
          'prometheus/SKILL.md',
        ),
      ),
    ).toBe(true);
    expect(getSessionSkillSyncState('web:test')?.status).toBe('synced');
  });

  it('marks sync failed when a selected skill is missing', async () => {
    const globalRootDir = makeTempDir('global-skills-missing-');
    const sessionRootDir = makeTempDir('session-skills-missing-');

    writeFile(globalRootDir, 'tmux/SKILL.md', '# tmux');
    replaceSessionSkillBindings('web:test', ['tmux', 'missing']);

    const result = await syncChatSkills({
      chatJid: 'web:test',
      globalRootDir,
      sessionRootDir,
    });

    expect(result.status).toBe('failed');
    expect(result.errorMessage).toMatch(/missing/i);
    expect(getSessionSkillSyncState('web:test')).toMatchObject({
      chat_jid: 'web:test',
      status: 'failed',
    });
  });

  it('clears old active files before re-sync', async () => {
    const globalRootDir = makeTempDir('global-skills-clear-');
    const sessionRootDir = makeTempDir('session-skills-clear-');

    writeFile(globalRootDir, 'tmux/SKILL.md', '# tmux');
    writeFile(globalRootDir, 'tmux/scripts/run.sh', 'echo tmux');
    replaceSessionSkillBindings('web:test', ['tmux']);

    const activeDir = getChatActiveSkillsDir('web:test', sessionRootDir);
    writeFile(activeDir, 'stale/file.txt', 'stale');

    await syncChatSkills({
      chatJid: 'web:test',
      globalRootDir,
      sessionRootDir,
    });

    expect(fs.existsSync(path.join(activeDir, 'stale/file.txt'))).toBe(false);
    expect(fs.existsSync(path.join(activeDir, 'tmux/scripts/run.sh'))).toBe(true);
  });

  it('deletes the chat skills directory', () => {
    const sessionRootDir = makeTempDir('session-skills-delete-');
    const activeDir = getChatActiveSkillsDir('web:test', sessionRootDir);
    writeFile(activeDir, 'tmux/SKILL.md', '# tmux');

    deleteChatSkillsDir('web:test', sessionRootDir);

    expect(fs.existsSync(activeDir)).toBe(false);
  });
});
