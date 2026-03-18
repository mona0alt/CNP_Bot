export interface DangerousCommandPattern {
  re: RegExp;
  reason: string;
  severity: 'high' | 'medium';
}

export const DANGEROUS_PATTERNS: DangerousCommandPattern[] = [
  // ── High severity ─────────────────────────────────────────────────────────
  { re: /rm\s+-[rRfF]*[rR][fF]*\s+\/(?!\s*tmp\/)/, reason: '递归删除根目录路径', severity: 'high' },
  { re: /rm\s+-[rRfF]*[rR][fF]* /, reason: '递归强制删除文件', severity: 'high' },
  { re: /\bfind\b[\s\S]*\s-delete\b/, reason: '删除文件/目录（find -delete）', severity: 'high' },
  { re: /(?:^|[;&|]\s*)unlink\s+(?!-h\b|--help\b|--version\b)[^\s].*/, reason: '删除文件（unlink）', severity: 'high' },
  { re: /git\s+clean\s+-[a-zA-Z]*f/, reason: '删除 Git 未跟踪文件', severity: 'high' },
  {
    re: /\bpython(?:\d+(?:\.\d+)?)?\b[\s\S]*(?:os\.(?:remove|unlink|rmdir)\(|shutil\.rmtree\(|pathlib\.Path\([^)]*\)\.(?:unlink|rmdir)\()/,
    reason: '通过 Python 删除文件/目录',
    severity: 'high',
  },
  {
    re: /\bnode\b[\s\S]*\.(?:unlinkSync|unlink|rmSync|rm|rmdirSync|rmdir)\(/,
    reason: '通过 Node.js 删除文件/目录',
    severity: 'high',
  },
  { re: /\bdd\b.*\bof=\/dev\//, reason: '写入磁盘设备', severity: 'high' },
  { re: /\bmkfs\b/, reason: '格式化文件系统', severity: 'high' },
  { re: />[\s]*\/etc\/(passwd|shadow|sudoers)/, reason: '覆盖系统敏感文件', severity: 'high' },
  { re: /curl\s+.*\|\s*(ba)?sh/, reason: '远程代码执行（curl | sh）', severity: 'high' },
  { re: /wget\s+.*\|\s*(ba)?sh/, reason: '远程代码执行（wget | sh）', severity: 'high' },
  { re: /\b(shutdown|reboot|halt|poweroff)\b/, reason: '系统关机/重启', severity: 'high' },
  { re: /git\s+push\s+.*--force/, reason: '强制推送（可能覆盖远程历史）', severity: 'high' },
  { re: /\bdrop\s+(database|table)\b/i, reason: '删除数据库/表', severity: 'high' },
  { re: /truncate\s+table\b/i, reason: '清空数据表', severity: 'high' },
  { re: /\b(shred|wipe)\b.*\s+\//, reason: '安全擦除文件/分区', severity: 'high' },
  { re: /chmod\s+[0-7]*7[0-7][0-7]\s+\/(?!\s*tmp)/, reason: '对根路径设置宽泛权限', severity: 'high' },
  { re: /iptables\s+-F\b/, reason: '清空防火墙规则（iptables -F）', severity: 'high' },
  {
    re: /(?:^|[;&|]\s*)rm(?:\s+-[-\w]+)*\s+(?:--\s+)?(?!(?:-h|--help|--version)\b)[^\s].*/,
    reason: '删除文件/目录',
    severity: 'high',
  },

  // ── Medium severity ────────────────────────────────────────────────────────
  { re: /git\s+reset\s+--hard/, reason: '强制重置 Git 历史（可能丢失本地提交）', severity: 'medium' },
  {
    re: /(?:^|[;&|]\s*)rmdir(?:\s+-[-\w]+)*\s+(?!-h\b|--help\b|--version\b)[^\s].*/,
    reason: '删除目录（rmdir）',
    severity: 'medium',
  },
];

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
