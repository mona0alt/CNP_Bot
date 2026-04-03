import fs from 'fs';
import path from 'path';

import {
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
}): Promise<{ status: 'synced' | 'failed'; errorMessage?: string }> {
  const globalRootDir = input.globalRootDir ?? GLOBAL_SKILLS_DIR;
  const activeDir = getChatActiveSkillsDir(input.chatJid, input.sessionRootDir);
  const selectedSkills = getSessionSkillBindings(input.chatJid);

  try {
    fs.rmSync(activeDir, { recursive: true, force: true });
    fs.mkdirSync(activeDir, { recursive: true });

    for (const skillName of selectedSkills) {
      const sourceDir = path.join(globalRootDir, skillName);
      const targetDir = path.join(activeDir, skillName);

      if (!fs.existsSync(sourceDir)) {
        throw new Error(`Selected skill is missing: ${skillName}`);
      }

      fs.cpSync(sourceDir, targetDir, { recursive: true });
    }

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
