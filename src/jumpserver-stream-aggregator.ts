const JUMPSERVER_SESSION_ID = 'jumpserver-session';
const REMOTE_SELECTION_STAGES = new Set([
  'connecting_jumpserver',
  'jumpserver_ready',
  'sending_target',
  'target_connecting',
]);

export interface JumpServerExecution {
  id: string;
  command: string;
  status: 'running' | 'completed' | 'error' | 'cancelled';
  output?: string;
  started_at?: string;
  finished_at?: string;
  error_message?: string;
}

export interface JumpServerBlock {
  type: 'jumpserver_session';
  id?: string;
  stage:
    | 'connecting_jumpserver'
    | 'jumpserver_ready'
    | 'sending_target'
    | 'target_connecting'
    | 'target_connected'
    | 'running_remote_command'
    | 'completed'
    | 'error'
    | 'cancelled';
  status?: 'calling' | 'executed' | 'error' | 'cancelled';
  jumpserver_host?: string;
  target_host?: string;
  target_hint?: string;
  latest_output?: string;
  executions?: JumpServerExecution[];
  error_message?: string;
}

export interface StreamToolEvent {
  type: 'tool_use' | 'tool_result';
  name?: string;
  toolUseId?: string;
  input?: { command?: string };
  content?: unknown;
  isError?: boolean;
}

export interface ConsumeResult {
  hiddenOriginalEvent: boolean;
  block?: JumpServerBlock;
}

type PendingToolKind = 'connect' | 'connect_and_enter' | 'run_remote' | 'send_keys' | 'capture' | 'other';

interface PendingToolRecord {
  command: string;
  kind: PendingToolKind;
}

function cloneBlock<T>(value: T): T {
  return structuredClone(value);
}

function normalizeContent(content: unknown): string {
  if (content === null || content === undefined) return '';
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') return item;
        if (
          typeof item === 'object' &&
          item !== null &&
          'text' in item &&
          typeof (item as { text?: unknown }).text === 'string'
        ) {
          return (item as { text: string }).text;
        }
        return JSON.stringify(item);
      })
      .join('\n');
  }
  if (typeof content === 'object') return JSON.stringify(content);
  return String(content);
}

export function isJumpServerConnectCommand(command: string): boolean {
  return /(?:^|\s)(?:bash\s+)?[^\s]*jumpserver\/scripts\/connect\.sh(?:\s|$)/.test(
    command,
  );
}

export function isConnectAndEnterTargetCommand(command: string): boolean {
  return /(?:^|\s)(?:bash\s+)?[^\s]*jumpserver\/scripts\/connect-and-enter-target\.sh(?:\s|$)/.test(
    command,
  );
}

function extractFirstShellWord(input: string): string | undefined {
  const text = input.trimStart();
  if (!text) return undefined;

  const firstChar = text[0];
  if (firstChar === '"' || firstChar === "'") {
    const quote = firstChar;
    let value = '';
    for (let index = 1; index < text.length; index += 1) {
      const char = text[index];
      if (char === '\\' && quote === '"' && index + 1 < text.length) {
        value += text[index + 1];
        index += 1;
        continue;
      }
      if (char === quote) {
        return value;
      }
      value += char;
    }
    return value;
  }

  let value = '';
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '\\' && index + 1 < text.length) {
      value += text[index + 1];
      index += 1;
      continue;
    }
    if (/\s/.test(char)) {
      break;
    }
    value += char;
  }
  return value || undefined;
}

function sliceAfterScriptName(command: string, scriptName: string): string | undefined {
  const match = command.match(new RegExp(`${scriptName}(?:\\s|$)`));
  if (!match?.index && match?.index !== 0) return undefined;
  return command.slice(match.index + scriptName.length);
}

export function extractConnectAndEnterTargetIp(command: string): string | undefined {
  const tail = sliceAfterScriptName(command, 'connect-and-enter-target\\.sh');
  return tail ? extractFirstShellWord(tail) : undefined;
}

export function isRunRemoteCommandCall(command: string): boolean {
  return /(?:^|\s)(?:bash\s+)?[^\s]*jumpserver\/scripts\/run-remote-command\.sh(?:\s|$)/.test(
    command,
  );
}

export function extractRunRemoteCommand(command: string): string | undefined {
  const tail = sliceAfterScriptName(command, 'run-remote-command\\.sh');
  return tail ? extractFirstShellWord(tail) : undefined;
}

export function isTmuxSendKeysCommand(command: string): boolean {
  return /\btmux\b[\s\S]*\bsend-keys\b/.test(command);
}

export function isTmuxCapturePaneCommand(command: string): boolean {
  return /\btmux\b[\s\S]*\bcapture-pane\b/.test(command);
}

function extractTmuxTarget(command: string): string | undefined {
  const match = command.match(/\s-t\s+([^\s]+)/);
  return match?.[1];
}

function isJumpServerPaneTarget(target: string | undefined): boolean {
  if (!target) return false;
  return /^jumpserver(?:[:.].*)?$/.test(target);
}

function looksLikeIpAddress(value: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value);
}

export function extractSendKeysPayload(command: string): string | undefined {
  const marker = command.indexOf(' -- ');
  const rest =
    marker !== -1
      ? command.slice(marker + 4).trim()
      : command.replace(/^.*?\bsend-keys\b/, '')
          .replace(/\s-t\s+[^\s]+/, '')
          .trim();

  if (!rest) return undefined;

  const quoted =
    rest.match(/^"((?:\\"|[^"])*)"/) ??
    rest.match(/^'((?:\\'|[^'])*)'/);
  if (quoted?.[1] !== undefined) {
    return quoted[1]
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'");
  }

  const tokens = rest.split(/\s+/).filter(Boolean);
  while (
    tokens.length > 1 &&
    /^(?:Enter|C-m|C-j|Space)$/i.test(tokens[tokens.length - 1] ?? '')
  ) {
    tokens.pop();
  }
  return tokens.join(' ');
}

export function looksLikeTargetSelection(payload: string): boolean {
  const value = payload.trim();
  if (!value) return false;
  if (looksLikeIpAddress(value)) return true;
  if (/^\d+$/.test(value)) return true;
  if (/^(?:q|quit|exit|:q)$/i.test(value)) return false;
  if (/^[A-Za-z]$/.test(value)) return false;
  return /^[A-Za-z0-9._:@/-]+$/.test(value) && !/[|&;$`]/.test(value);
}

export function looksLikeRemoteCommand(payload: string): boolean {
  const value = payload.trim();
  if (!value) return false;
  if (/^(?:C-c|Enter|Up|Down|Left|Right|Space)$/i.test(value)) return false;
  if (/^(?:q|quit|exit|:q)$/i.test(value)) return false;
  if (looksLikeTargetSelection(value)) return false;
  return /[\s/|&;$`=-]/.test(value) || /[A-Za-z]/.test(value);
}

export function summarizeTerminalOutput(content: unknown): string {
  const text = normalizeContent(content)
    .replace(/\r/g, '')
    .trim();
  if (!text) return '';

  const lines = text
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);

  const summary = lines.slice(-12).join('\n');
  return summary.slice(-1200);
}

export function looksLikeRemotePromptRecovered(output: string): boolean {
  if (!output.trim()) return false;
  const lastLine = output.split('\n').at(-1)?.trim() ?? '';
  if (!lastLine) return false;
  return (
    /\[[^\]]+@[^\]]+\]\$\s*$/.test(lastLine) ||
    /\[[^\]]+@[^\]]+\]#\s*$/.test(lastLine) ||
    /[A-Za-z0-9._-]+@[A-Za-z0-9._-]+(?::[^\s]*)?\$\s*$/.test(lastLine) ||
    /[A-Za-z0-9._-]+@[A-Za-z0-9._-]+(?::[^\s]*)?#\s*$/.test(lastLine) ||
    /(?:~|\/)[^\n]*\$\s*$/.test(lastLine) ||
    /(?:~|\/)[^\n]*#\s*$/.test(lastLine)
  );
}

function looksLikeTargetConnectingOutput(output: string): boolean {
  return /连接|connecting|login|logging|正在进入|entering/i.test(output);
}

function looksLikeJumpServerReadyOutput(output: string): boolean {
  return /Opt>|目标主机|请选择|jumpserver/i.test(output);
}

function extractHostFromText(output: string): string | undefined {
  const sshTargetMatch = output.match(
    /(?:sshpass\s+-p\s+'?\*+\s+'?\s+)?ssh\b[\s\S]*?\s([A-Za-z0-9._-]+)@([A-Za-z0-9.-]+)(?:\s+-p\d+|\s|$)/,
  );
  if (sshTargetMatch?.[2]) {
    return sshTargetMatch[2];
  }
  const ipMatch = output.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/);
  return ipMatch?.[0];
}

function nextExecutionId(executions: JumpServerExecution[]): string {
  return `jumpserver-exec-${executions.length + 1}`;
}

function canTreatAsRemoteCommand(
  current: JumpServerBlock,
  payload: string,
): boolean {
  if (!looksLikeRemoteCommand(payload)) return false;

  if (current.stage === 'target_connected' || current.stage === 'running_remote_command') {
    return true;
  }

  return (
    !!current.target_host &&
    current.stage !== 'connecting_jumpserver' &&
    current.stage !== 'jumpserver_ready'
  );
}

function canUpdateTargetHost(
  current: JumpServerBlock,
  payload: string,
): boolean {
  const candidate = extractHostFromText(payload) ?? payload.trim();
  if (!candidate) return false;

  if (!current.target_host) return true;

  if (looksLikeIpAddress(current.target_host)) {
    return looksLikeIpAddress(candidate) || /^\d+$/.test(candidate);
  }

  return candidate.length > 1 && !/^(?:q|quit|exit|:q)$/i.test(candidate);
}

function markRunningExecution(
  executions: JumpServerExecution[] | undefined,
  status: JumpServerExecution['status'],
  extras?: Partial<JumpServerExecution>,
): JumpServerExecution[] | undefined {
  if (!executions?.length) return executions;

  let changed = false;
  const nextExecutions = executions.map((execution) => {
    if (execution.status !== 'running') return execution;
    changed = true;
    return {
      ...execution,
      status,
      ...extras,
    };
  });

  return changed ? nextExecutions : executions;
}

export function createJumpServerStreamAggregator() {
  let block: JumpServerBlock | null = null;
  const pendingToolCommands = new Map<string, PendingToolRecord>();

  function emit(hiddenOriginalEvent: boolean): ConsumeResult {
    return {
      hiddenOriginalEvent,
      block: block ? cloneBlock(block) : undefined,
    };
  }

  function ensureBlock(): JumpServerBlock {
    if (!block) {
      block = {
        type: 'jumpserver_session',
        id: JUMPSERVER_SESSION_ID,
        stage: 'connecting_jumpserver',
        status: 'calling',
        executions: [],
      };
    }
    if (!block.id) {
      block.id = JUMPSERVER_SESSION_ID;
    }
    if (!block.executions) {
      block.executions = [];
    }
    return block;
  }

  function setError(message: string | undefined): void {
    const current = ensureBlock();
    current.stage = 'error';
    current.status = 'error';
    if (message) current.error_message = message;
    current.executions = markRunningExecution(current.executions, 'error', {
      finished_at: new Date().toISOString(),
      error_message: message,
    });
  }

  function handleToolUse(event: StreamToolEvent): ConsumeResult {
    const command = event.input?.command?.trim() ?? '';

    if (event.name !== 'Bash' || !command) {
      return emit(false);
    }

    if (isJumpServerConnectCommand(command)) {
      block = {
        type: 'jumpserver_session',
        id: block?.id ?? JUMPSERVER_SESSION_ID,
        stage: 'connecting_jumpserver',
        status: 'calling',
        executions: block?.executions ?? [],
      };
      if (event.toolUseId) {
        pendingToolCommands.set(event.toolUseId, { command, kind: 'connect' });
      }
      return emit(true);
    }

    if (isConnectAndEnterTargetCommand(command)) {
      const targetIp = extractConnectAndEnterTargetIp(command);
      block = {
        type: 'jumpserver_session',
        id: block?.id ?? JUMPSERVER_SESSION_ID,
        stage: 'connecting_jumpserver',
        status: 'calling',
        target_host: targetIp,
        executions: block?.executions ?? [],
      };
      if (event.toolUseId) {
        pendingToolCommands.set(event.toolUseId, { command, kind: 'connect_and_enter' });
      }
      return emit(true);
    }

    if (isRunRemoteCommandCall(command)) {
      const remoteCmd = extractRunRemoteCommand(command);
      if (remoteCmd) {
        const current = ensureBlock();
        current.executions = markRunningExecution(
          current.executions,
          'completed',
          { finished_at: new Date().toISOString() },
        ) ?? current.executions;
        const executions = current.executions ?? [];
        current.executions = [
          ...executions,
          {
            id: nextExecutionId(executions),
            command: remoteCmd,
            status: 'running',
            started_at: new Date().toISOString(),
          },
        ];
        current.stage = 'running_remote_command';
        current.status = 'calling';
        current.latest_output = undefined;
      }
      if (event.toolUseId) {
        pendingToolCommands.set(event.toolUseId, { command, kind: 'run_remote' });
      }
      return emit(true);
    }

    if (!block) {
      return emit(false);
    }

    const target = extractTmuxTarget(command);
    const isJumpServerPane = isJumpServerPaneTarget(target);

    if (isTmuxCapturePaneCommand(command) && isJumpServerPane) {
      if (event.toolUseId) {
        pendingToolCommands.set(event.toolUseId, { command, kind: 'capture' });
      }
      return emit(true);
    }

    if (isTmuxSendKeysCommand(command) && isJumpServerPane) {
      if (event.toolUseId) {
        pendingToolCommands.set(event.toolUseId, { command, kind: 'send_keys' });
      }

      const current = ensureBlock();
      const payload = extractSendKeysPayload(command)?.trim() ?? '';
      if (!payload) return emit(true);

      if (
        REMOTE_SELECTION_STAGES.has(current.stage) &&
        looksLikeTargetSelection(payload) &&
        canUpdateTargetHost(current, payload)
      ) {
        current.target_host = extractHostFromText(payload) ?? payload;
        current.stage = 'sending_target';
        current.status = 'calling';
        return emit(true);
      }

      if (
        canTreatAsRemoteCommand(current, payload)
      ) {
        current.executions = markRunningExecution(
          current.executions,
          'completed',
          {
            finished_at: new Date().toISOString(),
          },
        ) ?? current.executions;
        const executions = current.executions ?? [];
        current.executions = [
          ...executions,
          {
            id: nextExecutionId(executions),
            command: payload,
            status: 'running',
            started_at: new Date().toISOString(),
          },
        ];
        current.stage = 'running_remote_command';
        current.status = 'calling';
        current.latest_output = undefined;
        return emit(true);
      }

      return emit(true);
    }

    return emit(false);
  }

  function handleToolResult(event: StreamToolEvent): ConsumeResult {
    const pending = event.toolUseId
      ? pendingToolCommands.get(event.toolUseId)
      : undefined;

    if (!pending) {
      return emit(false);
    }

    pendingToolCommands.delete(event.toolUseId!);

    const shouldHide = pending.kind !== 'other';
    if (!block) {
      return emit(shouldHide);
    }

    if (event.isError) {
      setError(summarizeTerminalOutput(event.content) || 'JumpServer 操作失败');
      return emit(shouldHide);
    }

    const current = ensureBlock();
    const summary = summarizeTerminalOutput(event.content);

    if (pending.kind === 'connect') {
      if (summary) {
        current.latest_output = summary;
        current.jumpserver_host =
          current.jumpserver_host ?? extractHostFromText(summary);
        current.stage = looksLikeJumpServerReadyOutput(summary)
          ? 'jumpserver_ready'
          : current.stage;
      }
      return emit(true);
    }

    if (pending.kind === 'connect_and_enter') {
      if (summary) {
        current.latest_output = summary;
        current.jumpserver_host =
          current.jumpserver_host ?? extractHostFromText(summary);
        current.target_host =
          current.target_host ?? extractHostFromText(summary);
      }
      if (event.isError) {
        // already handled above
      } else if (looksLikeRemotePromptRecovered(summary)) {
        current.stage = 'target_connected';
        current.status = 'calling';
      } else {
        current.stage = 'target_connecting';
      }
      return emit(true);
    }

    if (pending.kind === 'run_remote') {
      if (summary) {
        current.latest_output = summary;
        current.executions = markRunningExecution(current.executions, 'completed', {
          output: summary,
          finished_at: new Date().toISOString(),
        });
      }
      current.stage = 'target_connected';
      current.status = 'calling';
      return emit(true);
    }

    if (pending.kind === 'capture') {
      if (summary) {
        current.latest_output = summary;
        if (current.stage === 'running_remote_command') {
          current.executions = markRunningExecution(current.executions, 'running', {
            output: summary,
          });
        }

        if (looksLikeRemotePromptRecovered(summary)) {
          if (current.stage === 'running_remote_command') {
            current.executions = markRunningExecution(
              current.executions,
              'completed',
              {
                output: summary,
                finished_at: new Date().toISOString(),
              },
            );
          }
          current.stage = 'target_connected';
          current.status = 'calling';
        } else if (looksLikeTargetConnectingOutput(summary)) {
          current.stage = 'target_connecting';
        } else if (
          current.target_host &&
          (summary.includes(current.target_host) || /welcome|last login/i.test(summary))
        ) {
          current.stage =
            current.stage === 'running_remote_command'
              ? current.stage
              : 'target_connected';
        } else if (
          current.stage === 'sending_target' &&
          !looksLikeJumpServerReadyOutput(summary)
        ) {
          current.stage = 'target_connecting';
        }
      }
      return emit(true);
    }

    if (pending.kind === 'send_keys') {
      return emit(true);
    }

    return emit(shouldHide);
  }

  function seed(next: JumpServerBlock): void {
    block = cloneBlock(next);
  }

  function consume(event: StreamToolEvent): ConsumeResult {
    if (event.type === 'tool_use') {
      return handleToolUse(event);
    }
    return handleToolResult(event);
  }

  function cancel(): JumpServerBlock | undefined {
    if (!block) return undefined;
    const current = ensureBlock();
    current.stage = 'cancelled';
    current.status = 'cancelled';
    current.executions = markRunningExecution(current.executions, 'cancelled', {
      finished_at: new Date().toISOString(),
    });
    return cloneBlock(current);
  }

  function complete(): JumpServerBlock | undefined {
    if (!block) return undefined;
    const current = ensureBlock();
    if (current.stage === 'running_remote_command') {
      current.executions = markRunningExecution(current.executions, 'completed', {
        finished_at: new Date().toISOString(),
      });
    }
    current.stage = 'completed';
    current.status = 'executed';
    return cloneBlock(current);
  }

  function fail(message?: string): JumpServerBlock | undefined {
    if (!block) return undefined;
    setError(message);
    return block ? cloneBlock(block) : undefined;
  }

  function getBlock(): JumpServerBlock | undefined {
    return block ? cloneBlock(block) : undefined;
  }

  return { consume, seed, cancel, complete, fail, getBlock };
}
