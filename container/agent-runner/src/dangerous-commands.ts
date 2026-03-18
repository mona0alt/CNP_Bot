export interface DangerousCommandPattern {
  re: RegExp;
  reason: string;
}

export const DANGEROUS_PATTERNS: DangerousCommandPattern[] = [
  { re: /rm\s+-[rRfF]*[rR][fF]*\s+\/(?!\s*tmp\/)/, reason: '递归删除根目录路径' },
  { re: /rm\s+-[rRfF]*[rR][fF]* /, reason: '递归强制删除文件' },
  { re: /\bfind\b[\s\S]*\s-delete\b/, reason: '删除文件/目录（find -delete）' },
  { re: /(?:^|[;&|]\s*)unlink\s+(?!-h\b|--help\b|--version\b)[^\s].*/, reason: '删除文件（unlink）' },
  { re: /(?:^|[;&|]\s*)rmdir(?:\s+-[-\w]+)*\s+(?!-h\b|--help\b|--version\b)[^\s].*/, reason: '删除目录（rmdir）' },
  { re: /git\s+clean\s+-[^\n]*\bf\b/, reason: '删除 Git 未跟踪文件' },
  {
    re: /\bpython(?:\d+(?:\.\d+)?)?\b[\s\S]*(?:os\.(?:remove|unlink|rmdir)\(|shutil\.rmtree\(|pathlib\.Path\([^)]*\)\.(?:unlink|rmdir)\()/,
    reason: '通过 Python 删除文件/目录',
  },
  {
    re: /\bnode\b[\s\S]*(?:fs\.(?:unlinkSync|unlink|rmSync|rm|rmdirSync|rmdir)\()/,
    reason: '通过 Node.js 删除文件/目录',
  },
  { re: /\bdd\b.*\bof=\/dev\//, reason: '写入磁盘设备' },
  { re: /\bmkfs\b/, reason: '格式化文件系统' },
  { re: />[\s]*\/etc\/(passwd|shadow|sudoers)/, reason: '覆盖系统敏感文件' },
  { re: /curl\s+.*\|\s*(ba)?sh/, reason: '远程代码执行（curl | sh）' },
  { re: /wget\s+.*\|\s*(ba)?sh/, reason: '远程代码执行（wget | sh）' },
  { re: /\b(shutdown|reboot|halt|poweroff)\b/, reason: '系统关机/重启' },
  { re: /git\s+reset\s+--hard/, reason: '强制重置 Git 历史（可能丢失提交）' },
  { re: /git\s+push\s+.*--force/, reason: '强制推送（可能覆盖远程历史）' },
  { re: /\bdrop\s+(database|table)\b/i, reason: '删除数据库/表' },
  { re: /truncate\s+table\b/i, reason: '清空数据表' },
  {
    re: /(?:^|[;&|]\s*)rm(?:\s+-[-\w]+)*\s+(?:--\s+)?(?!(?:-h|--help|--version)\b)[^\s].*/,
    reason: '删除文件/目录',
  },
];

export function findDangerousCommandReason(command: string): string | null {
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.re.test(command)) {
      return pattern.reason;
    }
  }

  return null;
}
