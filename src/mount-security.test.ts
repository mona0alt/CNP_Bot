import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Module-level mock fn references ---
const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockRealpathSync = vi.fn();

vi.mock('./config.js', () => ({
  MOUNT_ALLOWLIST_PATH: '/test/mount-allowlist.json',
}));

vi.mock('pino', () => ({
  default: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: (...args: unknown[]) => mockExistsSync(...args),
      readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
      realpathSync: (...args: unknown[]) => mockRealpathSync(...args),
    },
  };
});

const VALID_ALLOWLIST_JSON = JSON.stringify({
  allowedRoots: [
    { path: '/allowed', allowReadWrite: false },
    { path: '/writable', allowReadWrite: true },
  ],
  blockedPatterns: [],
  nonMainReadOnly: false,
});

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  // Default identity for realpathSync (path exists, returns itself)
  mockRealpathSync.mockImplementation((p: string) => p);
});

// --- generateAllowlistTemplate ---

describe('generateAllowlistTemplate', () => {
  it('returns valid JSON with required fields', async () => {
    const { generateAllowlistTemplate } = await import('./mount-security.js');
    const json = generateAllowlistTemplate();
    expect(() => JSON.parse(json)).not.toThrow();
    const parsed = JSON.parse(json);
    expect(Array.isArray(parsed.allowedRoots)).toBe(true);
    expect(Array.isArray(parsed.blockedPatterns)).toBe(true);
    expect(typeof parsed.nonMainReadOnly).toBe('boolean');
  });

  it('includes at least one example allowed root', async () => {
    const { generateAllowlistTemplate } = await import('./mount-security.js');
    const parsed = JSON.parse(generateAllowlistTemplate());
    expect(parsed.allowedRoots.length).toBeGreaterThan(0);
    const root = parsed.allowedRoots[0];
    expect(typeof root.path).toBe('string');
    expect(typeof root.allowReadWrite).toBe('boolean');
  });
});

// --- validateMount: no allowlist ---

describe('validateMount - no allowlist configured', () => {
  beforeEach(() => {
    mockExistsSync.mockReturnValue(false);
  });

  it('blocks all mounts when allowlist file does not exist', async () => {
    const { validateMount } = await import('./mount-security.js');
    const result = validateMount({ hostPath: '/some/valid/path' }, true);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/allowlist/i);
  });

  it('blocks mounts regardless of path content when no allowlist', async () => {
    const { validateMount } = await import('./mount-security.js');
    const result = validateMount({ hostPath: '/home/user/projects' }, false);
    expect(result.allowed).toBe(false);
  });
});

// --- validateMount: invalid container paths ---

describe('validateMount - invalid container paths', () => {
  beforeEach(() => {
    // Allowlist exists with a valid root
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(VALID_ALLOWLIST_JSON);
  });

  it('blocks mount with traversal in containerPath (..)', async () => {
    const { validateMount } = await import('./mount-security.js');
    const result = validateMount(
      { hostPath: '/allowed/data', containerPath: '../traversal' },
      true,
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/invalid container path/i);
  });

  it('blocks mount with absolute containerPath', async () => {
    const { validateMount } = await import('./mount-security.js');
    const result = validateMount(
      { hostPath: '/allowed/data', containerPath: '/etc/passwd' },
      true,
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/invalid container path/i);
  });

  it('blocks mount with empty containerPath', async () => {
    const { validateMount } = await import('./mount-security.js');
    const result = validateMount(
      { hostPath: '/allowed/data', containerPath: '   ' },
      true,
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/invalid container path/i);
  });
});

// --- validateMount: valid mount ---

describe('validateMount - valid mount', () => {
  beforeEach(() => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(VALID_ALLOWLIST_JSON);
    mockRealpathSync.mockImplementation((p: string) => p);
  });

  it('allows a mount under an allowed root', async () => {
    const { validateMount } = await import('./mount-security.js');
    const result = validateMount({ hostPath: '/allowed/data/foo' }, true);
    expect(result.allowed).toBe(true);
    expect(result.realHostPath).toBe('/allowed/data/foo');
    expect(result.resolvedContainerPath).toBe('foo');
  });

  it('blocks a mount not under any allowed root', async () => {
    const { validateMount } = await import('./mount-security.js');
    const result = validateMount({ hostPath: '/disallowed/path' }, true);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/not under any allowed root/i);
  });

  it('returns allowed:false when host path does not exist (realpathSync throws)', async () => {
    mockRealpathSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const { validateMount } = await import('./mount-security.js');
    const result = validateMount({ hostPath: '/allowed/missing' }, true);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/does not exist/i);
  });
});

// --- validateAdditionalMounts ---

describe('validateAdditionalMounts - mixed mounts', () => {
  beforeEach(() => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(VALID_ALLOWLIST_JSON);
    mockRealpathSync.mockImplementation((p: string) => p);
  });

  it('passes valid mounts and skips invalid ones', async () => {
    const { validateAdditionalMounts } = await import('./mount-security.js');

    const mounts = [
      // Valid: under /allowed, valid container path
      { hostPath: '/allowed/projects/foo', containerPath: 'foo' },
      // Invalid: bad container path (traversal)
      { hostPath: '/allowed/data', containerPath: '../bad' },
      // Invalid: not under any allowed root
      { hostPath: '/disallowed/stuff' },
    ];

    const result = validateAdditionalMounts(mounts, 'testgroup', true);

    expect(result).toHaveLength(1);
    expect(result[0].hostPath).toBe('/allowed/projects/foo');
    expect(result[0].containerPath).toBe('/workspace/extra/foo');
  });

  it('returns empty array when all mounts are invalid', async () => {
    const { validateAdditionalMounts } = await import('./mount-security.js');
    const mounts = [
      { hostPath: '/disallowed/a' },
      { hostPath: '/disallowed/b' },
    ];
    const result = validateAdditionalMounts(mounts, 'testgroup', true);
    expect(result).toHaveLength(0);
  });

  it('returns empty array when mounts list is empty', async () => {
    const { validateAdditionalMounts } = await import('./mount-security.js');
    const result = validateAdditionalMounts([], 'testgroup', true);
    expect(result).toHaveLength(0);
  });
});
