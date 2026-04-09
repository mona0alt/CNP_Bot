import os from 'os';
import path from 'path';

import { readEnvFile } from './env.js';

// Read config values from .env (falls back to process.env).
// Secrets are NOT read here — they stay on disk and are loaded only
// where needed (container-runner.ts) to avoid leaking to child processes.
const envConfig = readEnvFile([
  'ASSISTANT_NAME',
  'ASSISTANT_HAS_OWN_NUMBER',
  'USE_LOCAL_AGENT',
  'JWT_SECRET',
  'KB_API_URL',
  'KB_API_KEY',
  'KB_API_ACCOUNT',
  'KB_API_USER',
  'KB_API_AGENT_ID',
  'KB_ROOT_URI',
  'KB_INJECT_LIMIT',
  'KB_SEARCH_TIMEOUT',
  'KB_EXTRACT_TIMEOUT',
]);

export const ASSISTANT_NAME =
  process.env.ASSISTANT_NAME || envConfig.ASSISTANT_NAME || 'Assistant';
export const ASSISTANT_HAS_OWN_NUMBER =
  (process.env.ASSISTANT_HAS_OWN_NUMBER || envConfig.ASSISTANT_HAS_OWN_NUMBER) === 'true';
export const USE_LOCAL_AGENT =
  (process.env.USE_LOCAL_AGENT || envConfig.USE_LOCAL_AGENT) === 'true';
export const POLL_INTERVAL = 2000;
export const SCHEDULER_POLL_INTERVAL = 60000;

export type AgentType = 'claude' | 'deepagent';
export const DEFAULT_AGENT_TYPE: AgentType =
  (process.env.DEFAULT_AGENT_TYPE as AgentType) || 'deepagent';
export const DEEP_AGENT_MODEL = process.env.DEEP_AGENT_MODEL || 'claude-sonnet-4-6';
export const DEEP_AGENT_RUNNER_PATH = process.env.DEEP_AGENT_RUNNER_PATH ||
  'container/deep-agent-runner/src/main.py';
export const DEEP_AGENT_PYTHON = process.env.DEEP_AGENT_PYTHON ||
  '/opt/deepagent-venv/bin/python';

// Absolute paths needed for container mounts
const PROJECT_ROOT = process.cwd();
const HOME_DIR = process.env.HOME || os.homedir();

// Mount security: allowlist stored OUTSIDE project root, never mounted into containers
export const MOUNT_ALLOWLIST_PATH = path.join(
  HOME_DIR,
  '.config',
  'cnp-bot',
  'mount-allowlist.json',
);
export const STORE_DIR = path.resolve(PROJECT_ROOT, 'store');
export const GROUPS_DIR = path.resolve(PROJECT_ROOT, 'groups');
export const DATA_DIR = path.resolve(PROJECT_ROOT, 'data');
export const SKILLS_DIR = path.join(DATA_DIR, 'skills');
export const GLOBAL_SKILLS_DIR = path.join(SKILLS_DIR, 'global');
export const SESSION_SKILLS_DIR = path.join(SKILLS_DIR, 'sessions');
export const MAIN_GROUP_FOLDER = 'main';

export const CONTAINER_IMAGE =
  process.env.CONTAINER_IMAGE || 'cnp-bot-agent:latest';
export const CONTAINER_TIMEOUT = parseInt(
  process.env.CONTAINER_TIMEOUT || '1800000',
  10,
);
export const CONTAINER_MAX_OUTPUT_SIZE = parseInt(
  process.env.CONTAINER_MAX_OUTPUT_SIZE || '10485760',
  10,
); // 10MB default
export const IPC_POLL_INTERVAL = 1000;
export const IDLE_TIMEOUT = parseInt(
  process.env.IDLE_TIMEOUT || '900000',
  10,
); // 15min default — how long to keep container alive after last result
export const MAX_CONCURRENT_CONTAINERS = Math.max(
  1,
  parseInt(process.env.MAX_CONCURRENT_CONTAINERS || '5', 10) || 5,
);

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const TRIGGER_PATTERN = new RegExp(
  `^@${escapeRegex(ASSISTANT_NAME)}\\b`,
  'i',
);

// Timezone for scheduled tasks (cron expressions, etc.)
// Uses system timezone by default
export const TIMEZONE =
  process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;

// JWT configuration — must be set explicitly; a random secret on every restart
// would invalidate all active sessions after each deployment.
const _jwtSecret = process.env.JWT_SECRET || envConfig.JWT_SECRET;
if (!_jwtSecret) {
  console.error(
    '[FATAL] JWT_SECRET is not configured. ' +
      'Set it in the environment or .env file. ' +
      'Generate one with: node -e "require(\'crypto\').randomBytes(32).toString(\'hex\')" | xargs echo',
  );
  process.exit(1);
}
export const JWT_SECRET: string = _jwtSecret;
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// --- Knowledge Base (OpenViking) ---
export const KB_API_URL = process.env.KB_API_URL || envConfig.KB_API_URL || '';
export const KB_API_KEY = process.env.KB_API_KEY || envConfig.KB_API_KEY || '';
export const KB_API_ACCOUNT =
  process.env.KB_API_ACCOUNT || envConfig.KB_API_ACCOUNT || 'default';
export const KB_API_USER =
  process.env.KB_API_USER || envConfig.KB_API_USER || 'default';
export const KB_API_AGENT_ID =
  process.env.KB_API_AGENT_ID || envConfig.KB_API_AGENT_ID || '';
export const KB_ROOT_URI =
  process.env.KB_ROOT_URI || envConfig.KB_ROOT_URI || 'viking://resources/cnp-kb/';
export const KB_INJECT_LIMIT = parseInt(
  process.env.KB_INJECT_LIMIT || envConfig.KB_INJECT_LIMIT || '5',
  10,
);
export const KB_SEARCH_TIMEOUT = parseInt(
  process.env.KB_SEARCH_TIMEOUT || envConfig.KB_SEARCH_TIMEOUT || '15000',
  10,
);
export const KB_EXTRACT_TIMEOUT = parseInt(
  process.env.KB_EXTRACT_TIMEOUT || envConfig.KB_EXTRACT_TIMEOUT || '30000',
  10,
);
