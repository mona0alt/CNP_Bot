const SSHPASS_PASSWORD_RE =
  /(sshpass\s+-p\s+)(?:"[^"]*"|'[^']*'|[^\s]+)/g;

export function redactSensitiveToolText(value: string): string {
  if (!value) return value;

  return value.replace(SSHPASS_PASSWORD_RE, "$1'***'");
}
