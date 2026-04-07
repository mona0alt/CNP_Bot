import fs from 'fs';
import os from 'os';
import path from 'path';
import { pipeline } from 'stream/promises';

import unzipper from 'unzipper';

import {
  getChatJidsBoundToSkill,
  removeSkillFromAllChats,
  renameBoundSkill,
  setSessionSkillSyncState,
} from './db.js';
import { GLOBAL_SKILLS_DIR } from './config.js';
import { deleteGlobalSkillEntry, moveGlobalSkillEntry } from './skills-store.js';

function getGlobalRootDir(rootDir?: string): string {
  const resolved = rootDir ?? GLOBAL_SKILLS_DIR;
  fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}

function deriveSkillNameFromZipPath(zipPath: string): string {
  const parsed = path.parse(zipPath).name.trim();
  if (!parsed || parsed === '.' || parsed === '..') {
    throw new Error('Cannot derive skill name from zip filename');
  }
  return parsed;
}

function getTopLevelSkillEntry(
  extractDir: string,
  originalName: string,
): { name: string; fullPath: string } {
  const entries = fs
    .readdirSync(extractDir, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith('.'));

  if (entries.length === 1 && entries[0]?.isDirectory()) {
    const skillName = entries[0].name;
    const fullPath = path.join(extractDir, skillName);
    if (!fs.existsSync(path.join(fullPath, 'SKILL.md'))) {
      throw new Error('Imported skill must include SKILL.md');
    }

    return { name: skillName, fullPath };
  }

  const rootSkillMdPath = path.join(extractDir, 'SKILL.md');
  if (!fs.existsSync(rootSkillMdPath) || !fs.statSync(rootSkillMdPath).isFile()) {
    throw new Error('Imported skill must include SKILL.md');
  }

  const skillName = deriveSkillNameFromZipPath(originalName);
  const fullPath = path.join(extractDir, skillName);
  if (fs.existsSync(fullPath)) {
    throw new Error(`Zip root entry conflicts with skill name "${skillName}"`);
  }

  fs.mkdirSync(fullPath, { recursive: true });
  for (const entryName of fs.readdirSync(extractDir)) {
    if (entryName === skillName) continue;
    fs.renameSync(
      path.join(extractDir, entryName),
      path.join(fullPath, entryName),
    );
  }

  return { name: skillName, fullPath };
}

function assertTopLevelPath(relativePath: string): string {
  const normalized = path.posix.normalize(relativePath).replace(/\/+$/, '');
  if (
    !normalized ||
    normalized === '.' ||
    normalized === '..' ||
    normalized.includes('/') ||
    normalized.includes('\\')
  ) {
    throw new Error('Expected a top-level skill directory path');
  }
  return normalized;
}

function moveDirectoryWithCrossDeviceFallback(
  sourcePath: string,
  destinationPath: string,
): void {
  try {
    fs.renameSync(sourcePath, destinationPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'EXDEV') {
      throw err;
    }

    fs.cpSync(sourcePath, destinationPath, { recursive: true });
    fs.rmSync(sourcePath, { recursive: true, force: true });
  }
}

async function extractZipToDirectory(
  zipPath: string,
  extractDir: string,
): Promise<void> {
  const directory = await unzipper.Open.file(zipPath);

  for (const entry of directory.files) {
    const normalizedPath = path.posix.normalize(entry.path);
    if (
      !normalizedPath ||
      normalizedPath === '.' ||
      normalizedPath.startsWith('../') ||
      normalizedPath.includes('/../')
    ) {
      throw new Error('Zip contains unsafe entry path');
    }

    const destinationPath = path.join(
      extractDir,
      ...normalizedPath.split('/'),
    );
    const relative = path.relative(extractDir, destinationPath);
    if (
      relative === '..' ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw new Error('Zip contains unsafe entry path');
    }

    if (entry.type === 'Directory') {
      fs.mkdirSync(destinationPath, { recursive: true });
      continue;
    }

    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    await pipeline(entry.stream(), fs.createWriteStream(destinationPath));
  }
}

async function resyncActiveChats(
  affectedChatJids: string[],
  isChatActive?: (chatJid: string) => boolean,
  syncChatSkills?: (chatJid: string) => Promise<void>,
): Promise<void> {
  for (const chatJid of affectedChatJids) {
    setSessionSkillSyncState(chatJid, { status: 'pending' });
    if (isChatActive?.(chatJid)) {
      await syncChatSkills?.(chatJid);
    }
  }
}

export async function importGlobalSkillZip(input: {
  zipPath: string;
  globalRootDir?: string;
  originalName?: string;
}): Promise<{ skillName: string }> {
  const globalRootDir = getGlobalRootDir(input.globalRootDir);
  const extractDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-import-'));

  try {
    await extractZipToDirectory(input.zipPath, extractDir);

    const { name: skillName, fullPath } = getTopLevelSkillEntry(
      extractDir,
      input.originalName ?? input.zipPath,
    );
    const destinationPath = path.join(globalRootDir, skillName);

    if (fs.existsSync(destinationPath)) {
      throw new Error(`Skill "${skillName}" already exists`);
    }

    moveDirectoryWithCrossDeviceFallback(fullPath, destinationPath);
    return { skillName };
  } finally {
    fs.rmSync(extractDir, { recursive: true, force: true });
  }
}

export async function renameGlobalSkillAndRebind(input: {
  fromPath: string;
  toPath: string;
  globalRootDir?: string;
  isChatActive?: (chatJid: string) => boolean;
  syncChatSkills?: (chatJid: string) => Promise<void>;
}): Promise<void> {
  const globalRootDir = getGlobalRootDir(input.globalRootDir);
  const oldName = assertTopLevelPath(input.fromPath);
  const newName = assertTopLevelPath(input.toPath);
  const affectedChatJids = getChatJidsBoundToSkill(oldName);

  moveGlobalSkillEntry(oldName, newName, globalRootDir);
  renameBoundSkill(oldName, newName);
  await resyncActiveChats(
    affectedChatJids,
    input.isChatActive,
    input.syncChatSkills,
  );
}

export async function deleteGlobalSkillAndRebind(input: {
  relativePath: string;
  globalRootDir?: string;
  isChatActive?: (chatJid: string) => boolean;
  syncChatSkills?: (chatJid: string) => Promise<void>;
}): Promise<void> {
  const globalRootDir = getGlobalRootDir(input.globalRootDir);
  const skillName = assertTopLevelPath(input.relativePath);

  deleteGlobalSkillEntry(skillName, globalRootDir);
  const affectedChatJids = removeSkillFromAllChats(skillName);
  await resyncActiveChats(
    affectedChatJids,
    input.isChatActive,
    input.syncChatSkills,
  );
}
