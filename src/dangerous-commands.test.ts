import { describe, expect, it } from 'vitest';

import { findDangerousCommandReason } from './dangerous-commands.js';

describe('dangerous command detection', () => {
  it('detects recursive delete', () => {
    expect(findDangerousCommandReason('rm -rf /tmp/test')).toBeTruthy();
  });

  it('detects find -delete', () => {
    expect(
      findDangerousCommandReason('find /tmp/test -type f -delete'),
    ).toContain('find -delete');
  });

  it('detects unlink/rmdir/git clean deletes', () => {
    expect(findDangerousCommandReason('unlink /tmp/a.txt')).toContain('unlink');
    expect(findDangerousCommandReason('rmdir /tmp/test-dir')).toContain('rmdir');
    expect(findDangerousCommandReason('git clean -fd')).toContain('Git 未跟踪文件');
  });

  it('detects runtime-based deletes', () => {
    expect(
      findDangerousCommandReason(
        "python -c \"import os; os.remove('/tmp/a.txt')\"",
      ),
    ).toContain('Python');
    expect(
      findDangerousCommandReason(
        "node -e \"require('fs').rmSync('/tmp/test', { recursive: true, force: true })\"",
      ),
    ).toContain('Node.js');
  });

  it('detects force reset', () => {
    expect(findDangerousCommandReason('git reset --hard HEAD~1')).toContain(
      '强制重置',
    );
  });

  it('returns null for safe commands', () => {
    expect(findDangerousCommandReason('ls -la')).toBeNull();
  });
});
