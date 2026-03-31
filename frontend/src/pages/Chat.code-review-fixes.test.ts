import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Chat.tsx code review regressions', () => {
  const source = fs.readFileSync(new URL('./Chat.tsx', import.meta.url), 'utf8');

  it('does not use an unsafe GroupStatus type assertion when storing fetched status', () => {
    expect(source).not.toContain('data as GroupStatus');
  });

  it('cleans orphaned groupStatusMap entries when deleting a chat', () => {
    expect(source).toMatch(
      /setGroupStatusMap\(\(prev\) => \{\s*if \(!\(jid in prev\)\) return prev;\s*const next = \{ \.\.\.prev \};\s*delete next\[jid\];\s*return next;\s*\}\);/s,
    );
  });
});
