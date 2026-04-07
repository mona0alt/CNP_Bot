import fs from 'fs';
import path from 'path';

import {
  DATA_DIR,
  GLOBAL_SKILLS_DIR,
  SESSION_SKILLS_DIR,
} from './config.js';
import {
  getSessionSkillBindings,
  setSessionSkillSyncState,
} from './db.js';

export function getChatActiveSkillsDir(
  chatJid: string,
  sessionRootDir?: string,
): string {
  return path.join(sessionRootDir ?? SESSION_SKILLS_DIR, chatJid, 'active');
}

function getChatSessionFolder(chatJid: string): string {
  return chatJid.replace(/:/g, '-');
}

function getChatMountedClaudeDir(
  chatJid: string,
  claudeSessionsRootDir?: string,
): string {
  return path.join(
    claudeSessionsRootDir ?? path.join(DATA_DIR, 'sessions'),
    getChatSessionFolder(chatJid),
    '.claude',
  );
}

function getChatMountedClaudeSkillsDir(
  chatJid: string,
  claudeSessionsRootDir?: string,
): string {
  return path.join(
    getChatMountedClaudeDir(chatJid, claudeSessionsRootDir),
    'skills',
  );
}

function getManagedSkillsStatePath(
  chatJid: string,
  claudeSessionsRootDir?: string,
): string {
  return path.join(
    getChatMountedClaudeDir(chatJid, claudeSessionsRootDir),
    'session-skills.json',
  );
}

function readManagedSkillsState(
  chatJid: string,
  claudeSessionsRootDir?: string,
): string[] {
  const statePath = getManagedSkillsStatePath(chatJid, claudeSessionsRootDir);
  if (!fs.existsSync(statePath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    return Array.isArray(parsed?.selectedSkills)
      ? (parsed.selectedSkills as unknown[]).filter(
          (item): item is string => typeof item === 'string',
        )
      : [];
  } catch {
    return [];
  }
}

function writeManagedSkillsState(
  chatJid: string,
  selectedSkills: string[],
  claudeSessionsRootDir?: string,
): void {
  const claudeDir = getChatMountedClaudeDir(chatJid, claudeSessionsRootDir);
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(
    getManagedSkillsStatePath(chatJid, claudeSessionsRootDir),
    JSON.stringify({ selectedSkills }, null, 2) + '\n',
    'utf8',
  );
}

export function deleteChatSkillsDir(
  chatJid: string,
  sessionRootDir?: string,
): void {
  fs.rmSync(path.join(sessionRootDir ?? SESSION_SKILLS_DIR, chatJid), {
    recursive: true,
    force: true,
  });
}

export async function syncChatSkills(input: {
  chatJid: string;
  globalRootDir?: string;
  sessionRootDir?: string;
  claudeSessionsRootDir?: string;
}): Promise<{ status: 'synced' | 'failed'; errorMessage?: string }> {
  const globalRootDir = input.globalRootDir ?? GLOBAL_SKILLS_DIR;
  const activeDir = getChatActiveSkillsDir(input.chatJid, input.sessionRootDir);
  const claudeSkillsDir = getChatMountedClaudeSkillsDir(
    input.chatJid,
    input.claudeSessionsRootDir,
  );
  const selectedSkills = getSessionSkillBindings(input.chatJid);

  try {
    for (const skillName of selectedSkills) {
      const sourceDir = path.join(globalRootDir, skillName);
      if (!fs.existsSync(sourceDir)) {
        throw new Error(`Selected skill is missing: ${skillName}`);
      }
    }

    fs.rmSync(activeDir, { recursive: true, force: true });
    fs.mkdirSync(activeDir, { recursive: true });
    fs.mkdirSync(claudeSkillsDir, { recursive: true });

    const previouslyManagedSkills = readManagedSkillsState(
      input.chatJid,
      input.claudeSessionsRootDir,
    );
    for (const oldSkillName of previouslyManagedSkills) {
      if (selectedSkills.includes(oldSkillName)) continue;
      fs.rmSync(path.join(claudeSkillsDir, oldSkillName), {
        recursive: true,
        force: true,
      });
    }

    for (const skillName of selectedSkills) {
      const sourceDir = path.join(globalRootDir, skillName);
      const targetDir = path.join(activeDir, skillName);
      const claudeTargetDir = path.join(claudeSkillsDir, skillName);

      fs.cpSync(sourceDir, targetDir, { recursive: true });
      fs.rmSync(claudeTargetDir, { recursive: true, force: true });
      fs.cpSync(sourceDir, claudeTargetDir, { recursive: true });
    }

    writeManagedSkillsState(
      input.chatJid,
      selectedSkills,
      input.claudeSessionsRootDir,
    );

    setSessionSkillSyncState(input.chatJid, {
      status: 'synced',
      lastSyncedAt: new Date().toISOString(),
      errorMessage: null,
    });

    return { status: 'synced' };
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : 'Failed to sync chat skills';
    setSessionSkillSyncState(input.chatJid, {
      status: 'failed',
      errorMessage,
      lastSyncedAt: null,
    });
    return { status: 'failed', errorMessage };
  }
}
