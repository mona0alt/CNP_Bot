import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createGlobalSkillEntry,
  deleteGlobalSkillEntry,
  getGlobalSkillTree,
  listGlobalSkills,
  moveGlobalSkillEntry,
  readGlobalSkillFile,
  writeGlobalSkillFile,
} from './skills-store.js';

const tempDirs: string[] = [];

function createSkillsRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-store-'));
  tempDirs.push(root);
  return root;
}

function write(root: string, relativePath: string, content: string | Buffer): void {
  const targetPath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('skills store', () => {
  it('lists only top-level skill directories containing SKILL.md', () => {
    const root = createSkillsRoot();
    write(root, 'tmux/SKILL.md', '# tmux');
    write(root, 'prometheus/SKILL.md', '# prometheus');
    write(root, 'draft/readme.txt', 'not a skill');

    expect(listGlobalSkills(root)).toEqual([
      expect.objectContaining({ name: 'prometheus', hasSkillMd: true }),
      expect.objectContaining({ name: 'tmux', hasSkillMd: true }),
    ]);
  });

  it('returns a tree for a specific skill', () => {
    const root = createSkillsRoot();
    write(root, 'tmux/SKILL.md', '# tmux');
    write(root, 'tmux/scripts/run.sh', 'echo hi');

    expect(getGlobalSkillTree({ rootDir: root, skill: 'tmux' })).toEqual([
      expect.objectContaining({
        name: 'tmux',
        type: 'directory',
        children: expect.arrayContaining([
          expect.objectContaining({ name: 'SKILL.md', type: 'file' }),
          expect.objectContaining({ name: 'scripts', type: 'directory' }),
        ]),
      }),
    ]);
  });

  it('reads and writes text files under the root', () => {
    const root = createSkillsRoot();
    write(root, 'tmux/SKILL.md', '# tmux');

    expect(readGlobalSkillFile('tmux/SKILL.md', root)).toMatchObject({
      path: 'tmux/SKILL.md',
      content: '# tmux',
      editable: true,
    });

    writeGlobalSkillFile('tmux/SKILL.md', '# updated', root);

    expect(readGlobalSkillFile('tmux/SKILL.md', root).content).toBe('# updated');
  });

  it('creates files and directories', () => {
    const root = createSkillsRoot();
    write(root, 'tmux/SKILL.md', '# tmux');

    createGlobalSkillEntry(
      { parentPath: 'tmux', name: 'references', type: 'directory' },
      root,
    );
    createGlobalSkillEntry(
      { parentPath: 'tmux/references', name: 'notes.md', type: 'file' },
      root,
    );

    expect(fs.existsSync(path.join(root, 'tmux/references'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'tmux/references/notes.md'))).toBe(true);
  });

  it('renames and moves entries within the root', () => {
    const root = createSkillsRoot();
    write(root, 'tmux/SKILL.md', '# tmux');
    write(root, 'tmux/scripts/run.sh', 'echo hi');

    moveGlobalSkillEntry('tmux/scripts/run.sh', 'tmux/scripts/exec.sh', root);
    expect(fs.existsSync(path.join(root, 'tmux/scripts/exec.sh'))).toBe(true);

    deleteGlobalSkillEntry('tmux/scripts/exec.sh', root);
    expect(fs.existsSync(path.join(root, 'tmux/scripts/exec.sh'))).toBe(false);
  });

  it('rejects path traversal outside the skills root', () => {
    const root = createSkillsRoot();
    write(root, 'tmux/SKILL.md', '# tmux');

    expect(() => readGlobalSkillFile('../etc/passwd', root)).toThrow();
    expect(() =>
      createGlobalSkillEntry(
        { parentPath: '../etc', name: 'passwd', type: 'file' },
        root,
      ),
    ).toThrow();
    expect(() => moveGlobalSkillEntry('tmux/SKILL.md', '../SKILL.md', root)).toThrow();
  });

  it('marks binary files as non-editable', () => {
    const root = createSkillsRoot();
    write(root, 'tmux/SKILL.md', '# tmux');
    write(root, 'tmux/assets/icon.png', Buffer.from([0, 159, 146, 150]));

    expect(readGlobalSkillFile('tmux/assets/icon.png', root)).toMatchObject({
      path: 'tmux/assets/icon.png',
      editable: false,
    });
  });
});
