import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Module-level mock fn references ---
// These are stable references reused across vi.resetModules() cycles.
const mockClearMessages = vi.fn();
const mockDeleteSession = vi.fn();
const mockExistsSync = vi.fn();
const mockReaddirSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockUnlinkSync = vi.fn();

vi.mock('./logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('./db.js', () => ({
  clearMessages: (...args: unknown[]) => mockClearMessages(...args),
  deleteSession: (...args: unknown[]) => mockDeleteSession(...args),
}));

vi.mock('./config.js', () => ({
  DATA_DIR: '/tmp/test-data',
  GROUPS_DIR: '/tmp/test-groups',
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: (...args: unknown[]) => mockExistsSync(...args),
      readdirSync: (...args: unknown[]) => mockReaddirSync(...args),
      readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
      unlinkSync: (...args: unknown[]) => mockUnlinkSync(...args),
    },
  };
});

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  // Default: no directories exist → no custom commands
  mockExistsSync.mockReturnValue(false);
  mockReaddirSync.mockReturnValue([]);
});

// --- isSlashCommand ---

describe('isSlashCommand', () => {
  it('returns true for /-prefixed content', async () => {
    const { isSlashCommand } = await import('./slash-commands.js');
    expect(isSlashCommand('/help')).toBe(true);
    expect(isSlashCommand('/clear me')).toBe(true);
    expect(isSlashCommand('/')).toBe(true);
  });

  it('returns false for non-slash content', async () => {
    const { isSlashCommand } = await import('./slash-commands.js');
    expect(isSlashCommand('hello')).toBe(false);
    expect(isSlashCommand('')).toBe(false);
    expect(isSlashCommand('help')).toBe(false);
  });

  it('trims leading whitespace before checking', async () => {
    const { isSlashCommand } = await import('./slash-commands.js');
    // content.trim().startsWith('/') — leading space before slash is trimmed
    expect(isSlashCommand('  /help')).toBe(true);
  });
});

// --- mergeCommands ---

describe('mergeCommands', () => {
  it('returns default commands when no SDK or custom commands', async () => {
    const { mergeCommands } = await import('./slash-commands.js');
    const result = mergeCommands([]);
    const names = result.map((c) => c.command);
    expect(names).toContain('/help');
    expect(names).toContain('/clear');
    expect(names).toContain('/compact');
    expect(names).toContain('/status');
  });

  it('deduplicates: SDK command already in defaults is not added twice', async () => {
    const { mergeCommands } = await import('./slash-commands.js');
    const result = mergeCommands(['/help', '/clear']);
    const helpEntries = result.filter((c) => c.command === '/help');
    expect(helpEntries).toHaveLength(1);
  });

  it('normalizes SDK commands without / prefix', async () => {
    const { mergeCommands } = await import('./slash-commands.js');
    const result = mergeCommands(['newcmd']); // no leading slash
    const names = result.map((c) => c.command);
    expect(names).toContain('/newcmd');
  });

  it('custom commands override defaults with same name', async () => {
    // Mock fs so scanAllCustomCommands returns a custom /clear command
    mockExistsSync.mockImplementation((p: string) =>
      p.endsWith('.claude/commands'),
    );
    mockReaddirSync.mockReturnValue(['clear.md']);
    mockReadFileSync.mockReturnValue('Custom clear description\n');

    const { mergeCommands } = await import('./slash-commands.js');
    const result = mergeCommands([]);
    const clearCmd = result.find((c) => c.command === '/clear');
    expect(clearCmd).toBeDefined();
    expect(clearCmd!.source).toBe('custom');
    expect(clearCmd!.description).toBe('Custom clear description');
  });

  it('custom commands are added when not in defaults', async () => {
    mockExistsSync.mockImplementation((p: string) =>
      p.endsWith('.claude/commands'),
    );
    mockReaddirSync.mockReturnValue(['mytool.md']);
    mockReadFileSync.mockReturnValue('Does something useful\n');

    const { mergeCommands } = await import('./slash-commands.js');
    const result = mergeCommands([]);
    const custom = result.find((c) => c.command === '/mytool');
    expect(custom).toBeDefined();
    expect(custom!.source).toBe('custom');
  });
});

// --- executeSlashCommand ---

describe('executeSlashCommand', () => {
  it('/compact returns null (pass-through to SDK)', async () => {
    const { executeSlashCommand } = await import('./slash-commands.js');
    const result = await executeSlashCommand('/compact', 'chat@g.us', 'main');
    expect(result).toBeNull();
  });

  it('/clear calls clearMessages and returns success message', async () => {
    // Session file does not exist → no unlinkSync call needed
    mockExistsSync.mockReturnValue(false);

    const { executeSlashCommand } = await import('./slash-commands.js');
    const result = await executeSlashCommand('/clear', 'chat@g.us', 'main');

    expect(result).not.toBeNull();
    expect(result!.success).toBe(true);
    expect(result!.message).toContain('cleared');
    expect(mockClearMessages).toHaveBeenCalledWith('chat@g.us');
  });

  it('/clear also deletes session file when it exists', async () => {
    // existsSync: return true only for the session file path check
    mockExistsSync.mockReturnValue(true);

    const { executeSlashCommand } = await import('./slash-commands.js');
    const result = await executeSlashCommand('/clear', 'chat@g.us', 'main');

    expect(result!.success).toBe(true);
    expect(mockUnlinkSync).toHaveBeenCalledTimes(1);
  });

  it('unknown command returns error message', async () => {
    const { executeSlashCommand } = await import('./slash-commands.js');
    const result = await executeSlashCommand('/doesnotexist', 'chat@g.us', 'main');

    expect(result).not.toBeNull();
    expect(result!.success).toBe(false);
    expect(result!.message).toContain('Unknown command');
  });

  it('custom command returns null (delegates to agent)', async () => {
    // Set up a custom command in the fake fs
    mockExistsSync.mockImplementation((p: string) =>
      p.endsWith('.claude/commands'),
    );
    mockReaddirSync.mockReturnValue(['mytool.md']);
    mockReadFileSync.mockReturnValue('Does something useful\n');

    const { executeSlashCommand, getSlashCommands } = await import(
      './slash-commands.js'
    );
    // Prime the cache with the custom command
    await getSlashCommands(true);

    const result = await executeSlashCommand('/mytool', 'chat@g.us', 'main');
    expect(result).toBeNull();
  });
});
