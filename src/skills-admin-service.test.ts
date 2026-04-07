import fs from 'fs';
import os from 'os';
import path from 'path';

import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  _initTestDatabase,
  getChatJidsBoundToSkill,
  getSessionSkillBindings,
  getSessionSkillSyncState,
  replaceSessionSkillBindings,
  setSessionSkillSyncState,
} from './db.js';
import {
  deleteGlobalSkillAndRebind,
  importGlobalSkillZip,
  renameGlobalSkillAndRebind,
} from './skills-admin-service.js';

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeFile(rootDir: string, relativePath: string, content: string): void {
  const fullPath = path.join(rootDir, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf8');
}

async function createZipFromDir(sourceDir: string, zipPath: string): Promise<void> {
  const zip = new JSZip();

  const addDirectory = (currentDir: string, relativeDir = ''): void => {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const entryRelativePath = relativeDir
        ? path.posix.join(relativeDir, entry.name)
        : entry.name;
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        addDirectory(fullPath, entryRelativePath);
      } else {
        zip.file(entryRelativePath, fs.readFileSync(fullPath));
      }
    }
  };

  addDirectory(sourceDir);
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  fs.writeFileSync(zipPath, buffer);
}

beforeEach(() => {
  _initTestDatabase();
});

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

describe('skills admin service', () => {
  it('imports a zip containing one top-level skill with SKILL.md', async () => {
    const workspace = createTempDir('skills-admin-import-');
    const uploadDir = path.join(workspace, 'upload');
    const globalDir = path.join(workspace, 'global');
    const zipPath = path.join(workspace, 'tmux.zip');

    writeFile(uploadDir, 'tmux/SKILL.md', '# tmux');
    writeFile(uploadDir, 'tmux/scripts/run.sh', 'echo hi');
    fs.mkdirSync(globalDir, { recursive: true });
    await createZipFromDir(uploadDir, zipPath);

    await expect(
      importGlobalSkillZip({ zipPath, globalRootDir: globalDir }),
    ).resolves.toEqual({ skillName: 'tmux' });

    expect(fs.existsSync(path.join(globalDir, 'tmux/SKILL.md'))).toBe(true);
  });

  it('imports a zip without top-level directory by using zip filename as skill name', async () => {
    const workspace = createTempDir('skills-admin-import-flat-');
    const uploadDir = path.join(workspace, 'upload');
    const globalDir = path.join(workspace, 'global');
    const zipPath = path.join(workspace, 'flat-skill.zip');

    writeFile(uploadDir, 'SKILL.md', '# flat skill');
    writeFile(uploadDir, 'scripts/run.sh', 'echo hi');
    fs.mkdirSync(globalDir, { recursive: true });
    await createZipFromDir(uploadDir, zipPath);

    await expect(
      importGlobalSkillZip({ zipPath, globalRootDir: globalDir }),
    ).resolves.toEqual({ skillName: 'flat-skill' });

    expect(
      fs.existsSync(path.join(globalDir, 'flat-skill/SKILL.md')),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(globalDir, 'flat-skill/scripts/run.sh')),
    ).toBe(true);
  });

  it('rejects zips missing SKILL.md', async () => {
    const workspace = createTempDir('skills-admin-missing-skill-');
    const uploadDir = path.join(workspace, 'upload');
    const globalDir = path.join(workspace, 'global');
    const zipPath = path.join(workspace, 'broken.zip');

    writeFile(uploadDir, 'broken/readme.md', 'missing');
    fs.mkdirSync(globalDir, { recursive: true });
    await createZipFromDir(uploadDir, zipPath);

    await expect(
      importGlobalSkillZip({ zipPath, globalRootDir: globalDir }),
    ).rejects.toThrow(/SKILL\.md/i);
  });

  it('rejects duplicate top-level skill names', async () => {
    const workspace = createTempDir('skills-admin-duplicate-');
    const uploadDir = path.join(workspace, 'upload');
    const globalDir = path.join(workspace, 'global');
    const zipPath = path.join(workspace, 'tmux.zip');

    writeFile(uploadDir, 'tmux/SKILL.md', '# tmux');
    fs.mkdirSync(path.join(globalDir, 'tmux'), { recursive: true });
    writeFile(globalDir, 'tmux/SKILL.md', '# existing');
    await createZipFromDir(uploadDir, zipPath);

    await expect(
      importGlobalSkillZip({ zipPath, globalRootDir: globalDir }),
    ).rejects.toThrow(/already exists/i);
  });

  it('falls back to copy when moving imported skill across devices fails with EXDEV', async () => {
    const workspace = createTempDir('skills-admin-exdev-');
    const uploadDir = path.join(workspace, 'upload');
    const globalDir = path.join(workspace, 'global');
    const zipPath = path.join(workspace, 'cross-device.zip');

    writeFile(uploadDir, 'cross-device/SKILL.md', '# cross device');
    writeFile(uploadDir, 'cross-device/scripts/run.sh', 'echo exdev');
    fs.mkdirSync(globalDir, { recursive: true });
    await createZipFromDir(uploadDir, zipPath);

    const renameSync = vi.spyOn(fs, 'renameSync');
    renameSync.mockImplementation((oldPath, newPath) => {
      if (
        String(oldPath).includes(`${path.sep}skills-import-`) &&
        String(newPath) === path.join(globalDir, 'cross-device')
      ) {
        const error = new Error(
          `EXDEV: cross-device link not permitted, rename '${oldPath}' -> '${newPath}'`,
        ) as NodeJS.ErrnoException;
        error.code = 'EXDEV';
        throw error;
      }
      return fs.renameSync.wrappedMethod.call(fs, oldPath, newPath);
    });

    await expect(
      importGlobalSkillZip({ zipPath, globalRootDir: globalDir }),
    ).resolves.toEqual({ skillName: 'cross-device' });

    expect(fs.existsSync(path.join(globalDir, 'cross-device/SKILL.md'))).toBe(true);
    expect(
      fs.readFileSync(path.join(globalDir, 'cross-device/scripts/run.sh'), 'utf8'),
    ).toContain('echo exdev');
  });

  it('renames a top-level skill and updates session bindings', async () => {
    const globalDir = createTempDir('skills-admin-rename-');
    writeFile(globalDir, 'tmux/SKILL.md', '# tmux');
    replaceSessionSkillBindings('web:a', ['tmux']);
    setSessionSkillSyncState('web:a', { status: 'synced' });

    const syncChatSkills = vi.fn().mockResolvedValue(undefined);

    await renameGlobalSkillAndRebind({
      fromPath: 'tmux',
      toPath: 'terminal',
      globalRootDir: globalDir,
      isChatActive: (jid) => jid === 'web:a',
      syncChatSkills,
    });

    expect(fs.existsSync(path.join(globalDir, 'terminal/SKILL.md'))).toBe(true);
    expect(getSessionSkillBindings('web:a')).toEqual(['terminal']);
    expect(getChatJidsBoundToSkill('terminal')).toEqual(['web:a']);
    expect(getSessionSkillSyncState('web:a')?.status).toBe('pending');
    expect(syncChatSkills).toHaveBeenCalledWith('web:a');
  });

  it('deletes a top-level skill and removes affected bindings', async () => {
    const globalDir = createTempDir('skills-admin-delete-');
    writeFile(globalDir, 'tmux/SKILL.md', '# tmux');
    replaceSessionSkillBindings('web:a', ['tmux', 'prometheus']);
    replaceSessionSkillBindings('web:b', ['tmux']);
    setSessionSkillSyncState('web:a', { status: 'synced' });
    setSessionSkillSyncState('web:b', { status: 'synced' });

    const syncChatSkills = vi.fn().mockResolvedValue(undefined);

    await deleteGlobalSkillAndRebind({
      relativePath: 'tmux',
      globalRootDir: globalDir,
      isChatActive: (jid) => jid === 'web:a',
      syncChatSkills,
    });

    expect(fs.existsSync(path.join(globalDir, 'tmux'))).toBe(false);
    expect(getSessionSkillBindings('web:a')).toEqual(['prometheus']);
    expect(getSessionSkillBindings('web:b')).toEqual([]);
    expect(getSessionSkillSyncState('web:a')?.status).toBe('pending');
    expect(getSessionSkillSyncState('web:b')?.status).toBe('pending');
    expect(syncChatSkills).toHaveBeenCalledTimes(1);
    expect(syncChatSkills).toHaveBeenCalledWith('web:a');
  });
});
