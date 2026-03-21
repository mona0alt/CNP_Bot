import { findDangerousCommandReason } from './dangerous-commands.js';

function consumeShellWord(input: string): { word?: string; rest: string } {
  const text = input.trimStart();
  if (!text) return { rest: '' };

  const firstChar = text[0];
  if (firstChar === '"' || firstChar === "'") {
    const quote = firstChar;
    let value = '';
    for (let index = 1; index < text.length; index += 1) {
      const char = text[index];
      if (char === '\\' && index + 1 < text.length) {
        value += text[index + 1];
        index += 1;
        continue;
      }
      if (char === quote) {
        return { word: value, rest: text.slice(index + 1) };
      }
      value += char;
    }
    return { rest: '' };
  }

  let endIndex = text.length;
  for (let index = 0; index < text.length; index += 1) {
    if (/\s/.test(text[index])) {
      endIndex = index;
      break;
    }
  }

  return {
    word: text.slice(0, endIndex),
    rest: text.slice(endIndex),
  };
}

function sliceAfterScriptName(command: string, scriptName: string): string | undefined {
  const match = command.match(new RegExp(`${scriptName}(?:\\s|$)`));
  if (!match || match.index === undefined) return undefined;
  return command.slice(match.index + match[0].length);
}

export function isJumpServerRunRemoteCommand(command: string): boolean {
  return /(?:^|\s)(?:bash\s+)?[^\s]*jumpserver\/scripts\/run-remote-command\.sh(?:\s|$)/.test(
    command,
  );
}

export function parseJumpServerRunRemoteCommand(command: string): {
  remoteCommand?: string;
  targetHost?: string;
} {
  if (!isJumpServerRunRemoteCommand(command)) return {};

  const tail = sliceAfterScriptName(command, 'run-remote-command\\.sh');
  if (!tail) return {};

  const commandPart = consumeShellWord(tail);
  if (!commandPart.word) return {};

  const timeoutPart = consumeShellWord(commandPart.rest);
  const targetPart = consumeShellWord(timeoutPart.rest);

  return {
    remoteCommand: commandPart.word,
    targetHost: targetPart.word,
  };
}


export interface DangerousCommandConfirmContext {
  confirmCommand: string;
  reason: string;
  targetHost?: string;
  isRemote: boolean;
}

export function getDangerousCommandConfirmContext(
  command: string,
): DangerousCommandConfirmContext | null {
  if (isJumpServerRunRemoteCommand(command)) {
    const parsed = parseJumpServerRunRemoteCommand(command);
    if (!parsed.remoteCommand) return null;

    const reason = findDangerousCommandReason(parsed.remoteCommand);
    if (!reason) return null;

    return {
      confirmCommand: parsed.remoteCommand,
      reason,
      targetHost: parsed.targetHost,
      isRemote: true,
    };
  }

  const reason = findDangerousCommandReason(command);
  if (!reason) return null;

  return {
    confirmCommand: command,
    reason,
    isRemote: false,
  };
}
