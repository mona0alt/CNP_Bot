import { describe, expect, it } from 'vitest';

import { findDangerousCommandReason } from '../container/agent-runner/src/dangerous-commands.js';
import {
  getDangerousCommandConfirmContext,
  isJumpServerRunRemoteCommand,
  parseJumpServerRunRemoteCommand,
} from '../container/agent-runner/src/jumpserver-dangerous-command.js';

describe('jumpserver dangerous command parsing', () => {
  it('识别 run-remote-command.sh 并提取真实远端命令和目标主机', () => {
    expect(
      parseJumpServerRunRemoteCommand(
        'bash /home/node/.claude/skills/jumpserver/scripts/run-remote-command.sh "rm -rf /tmp/a" 60 10.1.2.3',
      ),
    ).toEqual({
      remoteCommand: 'rm -rf /tmp/a',
      targetHost: '10.1.2.3',
    });
  });

  it('未传目标主机时只返回真实远端命令', () => {
    expect(
      parseJumpServerRunRemoteCommand(
        'bash /home/node/.claude/skills/jumpserver/scripts/run-remote-command.sh "git reset --hard HEAD~1" 60',
      ),
    ).toEqual({
      remoteCommand: 'git reset --hard HEAD~1',
      targetHost: undefined,
    });
  });

  it('支持带管道和 && 的复杂远端命令', () => {
    expect(
      parseJumpServerRunRemoteCommand(
        'bash /home/node/.claude/skills/jumpserver/scripts/run-remote-command.sh "export PAGER=cat && journalctl --no-pager -n 100 | tail -20" 120 10.2.3.4',
      ),
    ).toEqual({
      remoteCommand: 'export PAGER=cat && journalctl --no-pager -n 100 | tail -20',
      targetHost: '10.2.3.4',
    });
  });

  it('提取到的远端命令可直接复用危险命令规则', () => {
    const parsed = parseJumpServerRunRemoteCommand(
      'bash /home/node/.claude/skills/jumpserver/scripts/run-remote-command.sh "rm -rf /tmp/a" 60 10.1.2.3',
    );

    expect(parsed.remoteCommand).toBe('rm -rf /tmp/a');
    expect(findDangerousCommandReason(parsed.remoteCommand!)).toBeTruthy();
  });

  it('非 run-remote-command.sh 调用不应识别', () => {
    expect(isJumpServerRunRemoteCommand('bash /tmp/other.sh')).toBe(false);
    expect(parseJumpServerRunRemoteCommand('bash /tmp/other.sh')).toEqual({});
  });
});


describe('dangerous command confirm context', () => {
  it('对本地危险命令返回原始命令上下文', () => {
    expect(getDangerousCommandConfirmContext('rm -rf /tmp/local-test')).toEqual({
      confirmCommand: 'rm -rf /tmp/local-test',
      reason: '递归强制删除文件',
      isRemote: false,
    });
  });

  it('对 jumpserver 远端危险命令返回真实远端命令和目标主机', () => {
    expect(
      getDangerousCommandConfirmContext(
        'bash /home/node/.claude/skills/jumpserver/scripts/run-remote-command.sh "rm -rf /tmp/remote-test" 60 10.1.2.3',
      ),
    ).toEqual({
      confirmCommand: 'rm -rf /tmp/remote-test',
      reason: '递归强制删除文件',
      targetHost: '10.1.2.3',
      isRemote: true,
    });
  });

  it('对 jumpserver 非危险远端命令不返回确认上下文', () => {
    expect(
      getDangerousCommandConfirmContext(
        'bash /home/node/.claude/skills/jumpserver/scripts/run-remote-command.sh "ls -la" 60 10.1.2.3',
      ),
    ).toBeNull();
  });

  it('命中 jumpserver 包装脚本但无法解析远端命令时不误拦截', () => {
    expect(
      getDangerousCommandConfirmContext(
        'bash /home/node/.claude/skills/jumpserver/scripts/run-remote-command.sh',
      ),
    ).toBeNull();
  });
});
