import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

export type RestartStatus =
  | 'idle'
  | 'requested'
  | 'stopping'
  | 'starting'
  | 'healthy'
  | 'failed';

export interface RestartRuntimeInfo {
  manager: 'launchd' | 'systemd-user' | 'systemd-system' | 'nohup' | 'unsupported';
  status: 'running' | 'stopped' | 'unknown';
  canRestart: boolean;
}

interface RestartStatusRecord {
  status: RestartStatus;
  message?: string | null;
  manager?: RestartRuntimeInfo['manager'];
  requestedAt?: string | null;
  updatedAt?: string | null;
  completedAt?: string | null;
}

const STATUS_FILE = path.join(process.cwd(), 'data', 'system-restart-status.json');
const SERVICE_LABEL = 'com.cnp-bot';
const SYSTEMD_SERVICE = 'cnp-bot';

function nowIso(): string {
  return new Date().toISOString();
}

function statusFilePath(): string {
  return STATUS_FILE;
}

function ensureStatusDir(): void {
  fs.mkdirSync(path.dirname(statusFilePath()), { recursive: true });
}

function writeRestartStatusRecord(
  status: RestartStatus,
  message?: string | null,
  manager?: RestartRuntimeInfo['manager'],
): RestartStatusRecord {
  const current = readRestartStatusRecord();
  const record: RestartStatusRecord = {
    ...current,
    status,
    message: message ?? null,
    manager: manager ?? current.manager,
    updatedAt: nowIso(),
  };

  if (!record.requestedAt && status === 'requested') {
    record.requestedAt = record.updatedAt;
  }
  if (status === 'healthy' || status === 'failed') {
    record.completedAt = record.updatedAt;
  }

  ensureStatusDir();
  fs.writeFileSync(statusFilePath(), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

function readRestartStatusRecord(): RestartStatusRecord {
  try {
    const raw = fs.readFileSync(statusFilePath(), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<RestartStatusRecord>;
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.status === 'string'
    ) {
      return {
        status: parsed.status as RestartStatus,
        message: typeof parsed.message === 'string' ? parsed.message : null,
        manager:
          parsed.manager === 'launchd' ||
          parsed.manager === 'systemd-user' ||
          parsed.manager === 'systemd-system' ||
          parsed.manager === 'nohup' ||
          parsed.manager === 'unsupported'
            ? parsed.manager
            : undefined,
        requestedAt:
          typeof parsed.requestedAt === 'string' ? parsed.requestedAt : null,
        updatedAt:
          typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
        completedAt:
          typeof parsed.completedAt === 'string' ? parsed.completedAt : null,
      };
    }
  } catch {
    // Missing or invalid status file falls back to idle.
  }
  return { status: 'idle', message: null };
}

function detectSystemd(): boolean {
  if (os.platform() !== 'linux') return false;
  try {
    return fs.readFileSync('/proc/1/comm', 'utf-8').trim() === 'systemd';
  } catch {
    return false;
  }
}

function detectRuntimeManager(): RestartRuntimeInfo['manager'] {
  const platform = os.platform();
  if (platform === 'darwin') return 'launchd';
  if (platform !== 'linux') return 'unsupported';

  if (detectSystemd()) {
    return typeof process.getuid === 'function' && process.getuid() === 0
      ? 'systemd-system'
      : 'systemd-user';
  }

  const wrapperPath = path.join(process.cwd(), 'start-cnp-bot.sh');
  if (fs.existsSync(wrapperPath)) return 'nohup';

  return 'unsupported';
}

function launchdKickstartCommand(): string {
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  if (uid !== null) {
    return `launchctl kickstart -k gui/${uid}/${SERVICE_LABEL}`;
  }
  return `launchctl kickstart -k ${SERVICE_LABEL}`;
}

function launchdFallbackCommands(): string[] {
  return [
    `launchctl stop ${SERVICE_LABEL}`,
    `launchctl start ${SERVICE_LABEL}`,
  ];
}

function restartCommand(manager: RestartRuntimeInfo['manager']): string | null {
  switch (manager) {
    case 'launchd':
      return launchdKickstartCommand();
    case 'systemd-system':
      return `systemctl restart ${SYSTEMD_SERVICE}`;
    case 'systemd-user':
      return `systemctl --user restart ${SYSTEMD_SERVICE}`;
    case 'nohup':
      return path.join(process.cwd(), 'start-cnp-bot.sh');
    default:
      return null;
  }
}

export function getRestartRuntimeInfo(): RestartRuntimeInfo {
  const manager = detectRuntimeManager();
  return {
    manager,
    status: readRestartStatusRecord().status === 'healthy' ? 'running' : 'unknown',
    canRestart: manager !== 'unsupported',
  };
}

export function readRestartStatus(): { status: RestartStatus; message?: string | null } {
  const record = readRestartStatusRecord();
  return {
    status: record.status,
    message: record.message ?? null,
  };
}

export function requestServiceRestart(): RestartRuntimeInfo {
  const info = getRestartRuntimeInfo();
  if (!info.canRestart) {
    writeRestartStatusRecord('failed', 'unsupported_restart_manager', info.manager);
    return info;
  }

  writeRestartStatusRecord('requested', null, info.manager);

  const command = restartCommand(info.manager);
  if (!command) {
    writeRestartStatusRecord('failed', 'unsupported_restart_manager', info.manager);
    return info;
  }

  try {
    execSync(command, { stdio: 'ignore' });
  } catch {
    if (info.manager === 'launchd') {
      let fallbackSucceeded = true;
      for (const fallbackCommand of launchdFallbackCommands()) {
        try {
          execSync(fallbackCommand, { stdio: 'ignore' });
        } catch {
          fallbackSucceeded = false;
          break;
        }
      }
      if (fallbackSucceeded) {
        return info;
      }
    }
    writeRestartStatusRecord('failed', 'restart_command_failed', info.manager);
    return info;
  }

  return info;
}

export function markRestartStatusHealthy(): void {
  try {
    const record = readRestartStatusRecord();
    writeRestartStatusRecord('healthy', null, record.manager);
  } catch {
    // Startup should not fail just because the status file cannot be updated.
  }
}
