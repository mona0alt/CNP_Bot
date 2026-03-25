import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('shared dangerous-commands.json', () => {
  const jsonPath = path.resolve(__dirname, '../container/shared/dangerous-commands.json');

  it('exists and is valid JSON', () => {
    const raw = fs.readFileSync(jsonPath, 'utf-8');
    const rules = JSON.parse(raw);
    expect(Array.isArray(rules)).toBe(true);
    expect(rules.length).toBeGreaterThan(0);
  });

  it('each rule has pattern, severity, reason', () => {
    const rules = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    for (const rule of rules) {
      expect(rule).toHaveProperty('pattern');
      expect(rule).toHaveProperty('severity');
      expect(rule).toHaveProperty('reason');
      expect(['high', 'medium']).toContain(rule.severity);
      expect(() => new RegExp(rule.pattern, rule.flags ?? '')).not.toThrow();
    }
  });
});
