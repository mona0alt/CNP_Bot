import fs from 'fs';
import path from 'path';

import { GLOBAL_SKILLS_DIR } from './config.js';

export interface SkillListItem {
  name: string;
  hasSkillMd: boolean;
  updatedAt: string;
}

export interface SkillTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: SkillTreeNode[];
  editable?: boolean;
}

function getRootDir(rootDir?: string): string {
  return rootDir ?? GLOBAL_SKILLS_DIR;
}

function ensureRootDir(rootDir: string): void {
  fs.mkdirSync(rootDir, { recursive: true });
}

function assertSafeName(name: string): void {
  if (!name.trim() || name === '.' || name === '..') {
    throw new Error('Invalid entry name');
  }
  if (name.includes('/') || name.includes('\\')) {
    throw new Error('Invalid entry name');
  }
}

function resolveWithinRoot(rootDir: string, relativePath: string): string {
  const resolvedRoot = path.resolve(rootDir);
  const resolvedPath = path.resolve(resolvedRoot, relativePath);
  const relative = path.relative(resolvedRoot, resolvedPath);

  if (
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error('Path escapes skills root');
  }

  return resolvedPath;
}

function isLikelyTextFile(filePath: string): boolean {
  const buffer = fs.readFileSync(filePath);
  const sample = buffer.subarray(0, 1024);
  for (const byte of sample) {
    if (byte === 0) return false;
  }
  return true;
}

function toRelativePath(rootDir: string, fullPath: string): string {
  return path.relative(path.resolve(rootDir), fullPath).split(path.sep).join('/');
}

function buildTree(rootDir: string, fullPath: string): SkillTreeNode {
  const stats = fs.statSync(fullPath);
  const relativePath = toRelativePath(rootDir, fullPath);

  if (stats.isDirectory()) {
    const children = fs
      .readdirSync(fullPath)
      .sort((a, b) => a.localeCompare(b))
      .map((entry) => buildTree(rootDir, path.join(fullPath, entry)));

    return {
      name: path.basename(fullPath),
      path: relativePath,
      type: 'directory',
      children,
    };
  }

  return {
    name: path.basename(fullPath),
    path: relativePath,
    type: 'file',
    editable: isLikelyTextFile(fullPath),
  };
}

export function listGlobalSkills(rootDir?: string): SkillListItem[] {
  const baseDir = getRootDir(rootDir);
  ensureRootDir(baseDir);

  return fs
    .readdirSync(baseDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const skillDir = path.join(baseDir, entry.name);
      const skillMdPath = path.join(skillDir, 'SKILL.md');
      const stats = fs.statSync(skillDir);
      return {
        name: entry.name,
        hasSkillMd: fs.existsSync(skillMdPath),
        updatedAt: stats.mtime.toISOString(),
      };
    })
    .filter((entry) => entry.hasSkillMd)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getGlobalSkillTree(options?: {
  skill?: string;
  rootDir?: string;
}): SkillTreeNode[] {
  const baseDir = getRootDir(options?.rootDir);
  ensureRootDir(baseDir);

  const targetNames = options?.skill
    ? [options.skill]
    : fs
        .readdirSync(baseDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort((a, b) => a.localeCompare(b));

  return targetNames.map((name) => {
    const fullPath = resolveWithinRoot(baseDir, name);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Skill not found: ${name}`);
    }
    return buildTree(baseDir, fullPath);
  });
}

export function readGlobalSkillFile(
  relativePath: string,
  rootDir?: string,
): { path: string; content: string; editable: boolean } {
  const baseDir = getRootDir(rootDir);
  ensureRootDir(baseDir);
  const fullPath = resolveWithinRoot(baseDir, relativePath);

  if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
    throw new Error('File not found');
  }

  const editable = isLikelyTextFile(fullPath);
  return {
    path: toRelativePath(baseDir, fullPath),
    content: editable ? fs.readFileSync(fullPath, 'utf8') : '',
    editable,
  };
}

export function writeGlobalSkillFile(
  relativePath: string,
  content: string,
  rootDir?: string,
): void {
  const baseDir = getRootDir(rootDir);
  ensureRootDir(baseDir);
  const fullPath = resolveWithinRoot(baseDir, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf8');
}

export function createGlobalSkillEntry(
  input: { parentPath: string; name: string; type: 'file' | 'directory' },
  rootDir?: string,
): string {
  const baseDir = getRootDir(rootDir);
  ensureRootDir(baseDir);
  assertSafeName(input.name);
  const parentPath = resolveWithinRoot(baseDir, input.parentPath);
  const targetPath = resolveWithinRoot(
    baseDir,
    path.posix.join(toRelativePath(baseDir, parentPath), input.name),
  );

  if (!fs.existsSync(parentPath) || !fs.statSync(parentPath).isDirectory()) {
    throw new Error('Parent directory not found');
  }
  if (fs.existsSync(targetPath)) {
    throw new Error('Entry already exists');
  }

  if (input.type === 'directory') {
    fs.mkdirSync(targetPath, { recursive: true });
  } else {
    fs.writeFileSync(targetPath, '', 'utf8');
  }

  return toRelativePath(baseDir, targetPath);
}

export function moveGlobalSkillEntry(
  fromPath: string,
  toPath: string,
  rootDir?: string,
): void {
  const baseDir = getRootDir(rootDir);
  ensureRootDir(baseDir);
  const sourcePath = resolveWithinRoot(baseDir, fromPath);
  const destinationPath = resolveWithinRoot(baseDir, toPath);

  if (!fs.existsSync(sourcePath)) {
    throw new Error('Source entry not found');
  }
  if (fs.existsSync(destinationPath)) {
    throw new Error('Destination already exists');
  }

  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.renameSync(sourcePath, destinationPath);
}

export function deleteGlobalSkillEntry(
  relativePath: string,
  rootDir?: string,
): void {
  const baseDir = getRootDir(rootDir);
  ensureRootDir(baseDir);
  const fullPath = resolveWithinRoot(baseDir, relativePath);

  if (!fs.existsSync(fullPath)) {
    throw new Error('Entry not found');
  }

  fs.rmSync(fullPath, { recursive: true, force: false });
}
