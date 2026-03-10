import fs from 'fs';
import path from 'path';
import { DATA_DIR, GROUPS_DIR } from './config.js';
import { clearMessages, deleteSession } from './db.js';
import { logger } from './logger.js';

export interface SlashCommand {
  command: string;
  description: string;
  allowedTools?: string[];
  source: 'sdk' | 'custom';
}

interface CommandResult {
  success: boolean;
  message: string;
}

const DEFAULT_COMMANDS: SlashCommand[] = [
  { command: '/help', description: 'Show available commands', source: 'sdk' },
  { command: '/clear', description: 'Clear chat history', source: 'sdk' },
  { command: '/status', description: 'Show current status', source: 'sdk' },
  {
    command: '/compact',
    description: 'Compact conversation history',
    source: 'sdk',
  },
];

let cachedCommands: SlashCommand[] = [];
let lastFetchTime: number = 0;
let sdkCommandsReceived = false;
const CACHE_TTL = 60000; // 1 minute

function getGlobalCommandsDir(): string {
  return path.join(DATA_DIR, 'sessions', '.claude', 'commands');
}

function parseFrontmatter(content: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const frontmatterStr = match[1];
  const body = match[2];

  const frontmatter: Record<string, unknown> = {};
  for (const line of frontmatterStr.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    frontmatter[key] = value;
  }

  return { frontmatter, body };
}

function scanCustomCommandsDir(dirPath: string): SlashCommand[] {
  const commands: SlashCommand[] = [];

  if (!fs.existsSync(dirPath)) {
    return commands;
  }

  try {
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      if (!file.endsWith('.md')) continue;

      const filePath = path.join(dirPath, file);
      const commandName = '/' + file.replace(/\.md$/, '');

      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const { frontmatter, body } = parseFrontmatter(content);

        const description =
          (frontmatter.description as string) ||
          body.trim().split('\n')[0]?.slice(0, 100) ||
          `Custom command: ${commandName}`;

        const allowedToolsStr = frontmatter['allowed-tools'] as
          | string
          | undefined;
        const allowedTools = allowedToolsStr
          ? allowedToolsStr.split(',').map((t) => t.trim())
          : undefined;

        commands.push({
          command: commandName,
          description,
          allowedTools,
          source: 'custom',
        });
      } catch (err) {
        logger.warn(
          { file: filePath, error: err },
          'Failed to parse command file',
        );
      }
    }
  } catch (err) {
    logger.warn(
      { dir: dirPath, error: err },
      'Failed to scan commands directory',
    );
  }

  return commands;
}

export function scanAllCustomCommands(): SlashCommand[] {
  const globalDir = getGlobalCommandsDir();
  const globalCommands = scanCustomCommandsDir(globalDir);

  // Scan per-group commands
  const groupsDir = path.join(DATA_DIR, 'sessions');
  if (fs.existsSync(groupsDir)) {
    for (const groupFolder of fs.readdirSync(groupsDir)) {
      if (groupFolder.startsWith('.')) continue; // Skip .claude

      const groupCommandsDir = path.join(
        groupsDir,
        groupFolder,
        '.claude',
        'commands',
      );
      const groupCommands = scanCustomCommandsDir(groupCommandsDir);

      // Merge, with later ones overriding earlier ones (group-specific > global)
      for (const cmd of groupCommands) {
        const existingIdx = globalCommands.findIndex(
          (c) => c.command === cmd.command,
        );
        if (existingIdx >= 0) {
          globalCommands[existingIdx] = cmd;
        } else {
          globalCommands.push(cmd);
        }
      }
    }
  }

  return globalCommands;
}

export function mergeCommands(sdkCommands: string[]): SlashCommand[] {
  const customCommands = scanAllCustomCommands();

  // Start with default commands (can be overridden by custom)
  const result: SlashCommand[] = [...DEFAULT_COMMANDS];

  // Add SDK commands (skip if already exists from defaults)
  for (const cmd of sdkCommands) {
    if (!result.find((c) => c.command === cmd)) {
      result.push({
        command: cmd,
        description: `SDK command: ${cmd}`,
        source: 'sdk',
      });
    }
  }

  // Merge custom commands (override同名)
  for (const cmd of customCommands) {
    const existingIdx = result.findIndex((c) => c.command === cmd.command);
    if (existingIdx >= 0) {
      result[existingIdx] = cmd;
    } else {
      result.push(cmd);
    }
  }

  return result;
}

export async function getSlashCommands(
  forceRefresh = false,
): Promise<SlashCommand[]> {
  const now = Date.now();

  if (
    !forceRefresh &&
    cachedCommands.length > 0 &&
    now - lastFetchTime < CACHE_TTL
  ) {
    return cachedCommands;
  }

  // Get SDK commands if received, otherwise use defaults
  let sdkCmdList: string[];
  if (sdkCommandsReceived) {
    sdkCmdList = cachedCommands
      .filter((c) => c.source === 'sdk')
      .map((c) => c.command);
  } else {
    sdkCmdList = DEFAULT_COMMANDS.map((c) => c.command);
  }

  cachedCommands = mergeCommands(sdkCmdList);
  lastFetchTime = now;

  return cachedCommands;
}

export function updateSdkCommands(commands: string[]): void {
  if (commands.length > 0) {
    sdkCommandsReceived = true;
    cachedCommands = mergeCommands(commands);
    lastFetchTime = Date.now();
    logger.info(
      { count: cachedCommands.length, fromSdk: commands },
      'Updated slash commands from SDK',
    );
  }
}

export async function executeSlashCommand(
  command: string,
  chatJid: string,
  groupFolder: string,
  args?: string,
): Promise<CommandResult | null> {
  const cmd = command.split(' ')[0]; // Remove args from command name
  const fullCommand = args ? `${cmd} ${args}` : cmd;

  switch (cmd) {
    case '/clear': {
      try {
        // Clear messages from database
        clearMessages(chatJid);

        // Reset session - delete the session file
        const sessionPath = path.join(
          DATA_DIR,
          'sessions',
          groupFolder,
          'session.json',
        );
        if (fs.existsSync(sessionPath)) {
          fs.unlinkSync(sessionPath);
        }

        logger.info({ chatJid, groupFolder }, 'Chat cleared');
        return { success: true, message: 'Chat history has been cleared.' };
      } catch (err) {
        logger.error({ err, chatJid }, 'Failed to clear chat');
        return { success: false, message: 'Failed to clear chat history.' };
      }
    }

    case '/help': {
      const commands = await getSlashCommands();
      const helpText = commands
        .map(
          (c) =>
            `**${c.command}** - ${c.description}${c.source === 'custom' ? ' (custom)' : ''}`,
        )
        .join('\n');
      return {
        success: true,
        message: `Available commands:\n\n${helpText}\n\nType a command and press Enter to use it.`,
      };
    }

    case '/status': {
      // Get status info
      const messagesPath = path.join(DATA_DIR, 'sessions', groupFolder);
      const hasSession = fs.existsSync(path.join(messagesPath, 'session.json'));

      return {
        success: true,
        message: `Status for this chat:\n- Session: ${hasSession ? 'Active' : 'None'}\n- Group: ${groupFolder}`,
      };
    }

    case '/compact': {
      // /compact should be handled by the SDK, return null to let it pass through
      return null;
    }

    default: {
      // Check if it's a custom command - if so, return null to let it execute via agent
      const commands = await getSlashCommands();
      const customCmd = commands.find(
        (c) => c.command === cmd && c.source === 'custom',
      );
      if (customCmd) {
        // Custom commands should be executed by the agent
        return null;
      }

      // Unknown command
      return {
        success: false,
        message: `Unknown command: ${cmd}. Type /help for available commands.`,
      };
    }
  }
}

export function isSlashCommand(content: string): boolean {
  return content.trim().startsWith('/');
}
