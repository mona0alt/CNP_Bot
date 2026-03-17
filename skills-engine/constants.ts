export const CNP_BOT_DIR = '.cnp-bot';
export const STATE_FILE = 'state.yaml';
export const BASE_DIR = '.cnp-bot/base';
export const BACKUP_DIR = '.cnp-bot/backup';
export const LOCK_FILE = '.cnp-bot/lock';
export const CUSTOM_DIR = '.cnp-bot/custom';
export const SKILLS_SCHEMA_VERSION = '0.1.0';

// Top-level paths to include in base snapshot and upstream extraction.
// Add new entries here when new root-level directories/files need tracking.
export const BASE_INCLUDES = ['src/', 'package.json', '.env.example', 'container/'];
