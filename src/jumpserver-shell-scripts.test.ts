import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

import { afterEach, describe, expect, it } from 'vitest';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jumpserver-script-'));
  tempDirs.push(dir);
  return dir;
}

function writeExecutable(filePath: string, content: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, { mode: 0o755 });
}

function setupHarness() {
  const root = makeTempDir();
  const binDir = path.join(root, 'bin');
  const socketDir = path.join(root, 'cnpbot-tmux-sockets');
  const scriptDir = path.join(root, 'scripts');
  const stateDir = path.join(root, 'state');
  fs.mkdirSync(binDir, { recursive: true });
  fs.mkdirSync(socketDir, { recursive: true });
  fs.mkdirSync(scriptDir, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });

  writeExecutable(
    path.join(binDir, 'tmux'),
    `#!/usr/bin/env bash
set -euo pipefail
STATE_DIR="\${MOCK_TMUX_STATE_DIR:?}"
LOG_FILE="$STATE_DIR/tmux.log"
mkdir -p "$STATE_DIR"
echo "$*" >> "$LOG_FILE"

cmd=""
for arg in "$@"; do
  case "$arg" in
    has-session|new-session|display-message|send-keys|capture-pane|clear-history)
      cmd="$arg"
      break
      ;;
  esac
done

case "$cmd" in
  has-session)
    if [[ "\${MOCK_TMUX_HAS_SESSION:-0}" == "1" ]]; then
      exit 0
    fi
    exit 1
    ;;
  new-session)
    exit 0
    ;;
  display-message)
    printf '%s\\n' "\${MOCK_TMUX_PANE_COMMAND:-bash}"
    ;;
  clear-history)
    exit 0
    ;;
  send-keys)
    joined="$*"
    if [[ "$joined" == *" exit Enter"* ]]; then
      printf '%s\\n' "exit" >> "$STATE_DIR/send-keys.log"
      touch "$STATE_DIR/after-exit"
      exit 0
    fi
    if [[ -n "\${MOCK_TARGET_IP:-}" ]] && [[ "$joined" == *" -- \${MOCK_TARGET_IP} Enter"* ]]; then
      printf '%s\\n' "\${MOCK_TARGET_IP}" >> "$STATE_DIR/send-keys.log"
      touch "$STATE_DIR/after-target"
      exit 0
    fi
    if [[ "$joined" == *" -- "* ]]; then
      payload="\${joined##* -- }"
    else
      payload="\${joined##* send-keys }"
      payload="\${payload#* -t * }"
    fi
    payload="\${payload% Enter}"
    if [[ -n "$payload" ]]; then
      printf '%s\\n' "$payload" >> "$STATE_DIR/send-keys.log"
      if [[ "$payload" == *"\${MOCK_REMOTE_CMD_MATCH:-__never__}"* ]]; then
        attempts_file="$STATE_DIR/attempts"
        attempts=0
        if [[ -f "$attempts_file" ]]; then
          attempts="$(cat "$attempts_file")"
        fi
        attempts=$((attempts + 1))
        printf '%s' "$attempts" > "$attempts_file"
      fi
      if [[ "$payload" == "exit" ]]; then
        touch "$STATE_DIR/after-exit"
      fi
      if [[ "$payload" == "\${MOCK_TARGET_IP:-}" ]]; then
        touch "$STATE_DIR/after-target"
      fi
    fi
    exit 0
    ;;
  capture-pane)
    if [[ "\${MOCK_CAPTURE_MODE:-prompt}" == "remote-fail-once" ]]; then
      attempts=0
      if [[ -f "$STATE_DIR/attempts" ]]; then
        attempts="$(cat "$STATE_DIR/attempts")"
      fi
      if [[ "$attempts" -le 1 ]]; then
        printf '%s\\n' "BROKEN_OUTPUT"
      else
        printf '%s\\n' "done" "[root@test ~]#"
      fi
      exit 0
    fi
    if [[ "\${MOCK_CAPTURE_MODE:-prompt}" == "same-target-prompt-without-ip" ]]; then
      printf '%s\\n' "[root@bd-cnp-uat01-104-234 ~]#" 
      exit 0
    fi
    if [[ "\${MOCK_CAPTURE_MODE:-prompt}" == "connect-flow" ]]; then
      if [[ -f "$STATE_DIR/after-target" ]]; then
        printf '%s\\n' "[root@test ~]#"
      elif [[ -f "$STATE_DIR/after-exit" ]]; then
        printf '%s\\n' "[Host]>"
      else
        printf '%s\\n' "[root@bd-cnp-uat01-10-246-104-234 ~]#"
      fi
      exit 0
    fi
    printf '%s\\n' "[root@test ~]#"
    ;;
  *)
    exit 0
    ;;
esac
`,
  );

  const env = {
    ...process.env,
    PATH: `${binDir}:${process.env.PATH ?? ''}`,
    TMPDIR: root,
    MOCK_TMUX_STATE_DIR: stateDir,
    JUMPSERVER_HOST: 'jump.example.com',
    JUMPSERVER_USER: 'tester',
    JUMPSERVER_PASS: 'secret',
    JUMPSERVER_PORT: '2222',
    JUMPSERVER_CONNECT_TIMEOUT: '1',
  };

  return { root, binDir, socketDir, scriptDir, stateDir, env };
}

function copyRunRemoteScript(scriptDir: string) {
  const source = path.resolve(
    process.cwd(),
    'container/skills/jumpserver/scripts/run-remote-command.sh',
  );
  const target = path.join(scriptDir, 'run-remote-command.sh');
  fs.copyFileSync(source, target);
  fs.chmodSync(target, 0o755);
  return target;
}

function copyConnectScript(scriptDir: string) {
  const source = path.resolve(
    process.cwd(),
    'container/skills/jumpserver/scripts/connect-and-enter-target.sh',
  );
  const target = path.join(scriptDir, 'connect-and-enter-target.sh');
  fs.copyFileSync(source, target);
  fs.chmodSync(target, 0o755);
  return target;
}

function writeConnectStub(scriptDir: string, socketDir: string) {
  writeExecutable(
    path.join(scriptDir, 'connect-and-enter-target.sh'),
    `#!/usr/bin/env bash
set -euo pipefail
TARGET_IP="\${1:?missing target}"
SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
printf '%s\\n' "$TARGET_IP" > "${socketDir}/current_target"
printf '%s\\n' "$TARGET_IP" >> "$SCRIPT_DIR/connect.log"
`,
  );
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('jumpserver shell scripts', () => {
  it('run-remote-command.sh 未传 target_ip 时直接失败', () => {
    const { scriptDir, env, socketDir } = setupHarness();
    const scriptPath = copyRunRemoteScript(scriptDir);
    writeConnectStub(scriptDir, socketDir);

    const result = spawnSync('bash', [scriptPath, 'uname -a', '1'], {
      env,
      encoding: 'utf8',
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('target_ip');
  });

  it('current_target 相等时直接执行且不切换', () => {
    const { scriptDir, env, socketDir } = setupHarness();
    const scriptPath = copyRunRemoteScript(scriptDir);
    writeConnectStub(scriptDir, socketDir);
    fs.writeFileSync(path.join(socketDir, 'current_target'), '10.246.104.234');

    const result = spawnSync(
      'bash',
      [scriptPath, 'uname -a', '1', '10.246.104.234'],
      {
        env: {
          ...env,
          MOCK_TMUX_HAS_SESSION: '1',
          MOCK_CAPTURE_MODE: 'same-target-prompt-without-ip',
        },
        encoding: 'utf8',
      },
    );

    expect(result.status).toBe(0);
    expect(fs.existsSync(path.join(scriptDir, 'connect.log'))).toBe(false);
  });

  it('直接执行失败后会清空 current_target、重连并重试一次', () => {
    const { scriptDir, env, socketDir, stateDir } = setupHarness();
    const scriptPath = copyRunRemoteScript(scriptDir);
    writeConnectStub(scriptDir, socketDir);
    fs.writeFileSync(path.join(socketDir, 'current_target'), '10.246.104.234');

    const result = spawnSync(
      'bash',
      [scriptPath, 'uname -a', '1', '10.246.104.234'],
      {
        env: {
          ...env,
          MOCK_TMUX_HAS_SESSION: '1',
          MOCK_CAPTURE_MODE: 'remote-fail-once',
          MOCK_REMOTE_CMD_MATCH: 'uname -a',
        },
        encoding: 'utf8',
      },
    );

    expect(result.status).toBe(0);
    expect(fs.readFileSync(path.join(scriptDir, 'connect.log'), 'utf8')).toContain(
      '10.246.104.234',
    );
    expect(fs.readFileSync(path.join(stateDir, 'attempts'), 'utf8')).toBe('2');
  });

  it('connect-and-enter-target.sh 被调用时不再根据 prompt 直接复用当前目标连接', () => {
    const { scriptDir, env, socketDir, stateDir } = setupHarness();
    const scriptPath = copyConnectScript(scriptDir);

    const result = spawnSync('bash', [scriptPath, '10.246.104.234'], {
      env: {
        ...env,
        MOCK_TMUX_HAS_SESSION: '1',
        MOCK_TMUX_PANE_COMMAND: 'ssh',
        MOCK_CAPTURE_MODE: 'connect-flow',
        MOCK_TARGET_IP: '10.246.104.234',
      },
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(fs.readFileSync(path.join(stateDir, 'send-keys.log'), 'utf8')).toContain('exit');
    expect(fs.readFileSync(path.join(stateDir, 'send-keys.log'), 'utf8')).toContain(
      '10.246.104.234',
    );
    expect(fs.readFileSync(path.join(socketDir, 'current_target'), 'utf8').trim()).toBe(
      '10.246.104.234',
    );
  });

  it('JumpServer skill 文档中的 run-remote-command.sh 示例必须显式携带目标 IP', () => {
    const doc = fs.readFileSync(
      path.resolve(process.cwd(), 'container/skills/jumpserver/SKILL.md'),
      'utf8',
    );

    expect(doc).toContain('第 3 个参数必须始终传入目标 IP');
    expect(doc).not.toMatch(
      /run-remote-command\.sh "export SYSTEMD_PAGER=cat PAGER=cat && journalctl --no-pager -n 100"\s*$/m,
    );
    expect(doc).not.toMatch(
      /run-remote-command\.sh "tail -100 \/var\/log\/messages"\s*$/m,
    );
  });
});
