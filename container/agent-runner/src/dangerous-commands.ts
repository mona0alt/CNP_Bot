import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface DangerousRule {
  pattern: string;
  severity: 'high' | 'medium';
  reason: string;
  flags?: string;
}

const rulesJson: DangerousRule[] = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../shared/dangerous-commands.json'), 'utf-8')
);

export interface DangerousCommandPattern {
  re: RegExp;
  reason: string;
  severity: 'high' | 'medium';
}

export const DANGEROUS_PATTERNS: DangerousCommandPattern[] = rulesJson.map((rule) => ({
  re: new RegExp(rule.pattern, rule.flags ?? ''),
  reason: rule.reason,
  severity: rule.severity,
}));

export function findDangerousCommand(command: string): DangerousCommandPattern | null {
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.re.test(command)) {
      return pattern;
    }
  }
  return null;
}

export function findDangerousCommandReason(command: string): string | null {
  return findDangerousCommand(command)?.reason ?? null;
}
