export interface AskUserRequest {
  requestId: string;
  question: string;
  answered?: boolean;
  answer?: string;
  submitting?: boolean;
}

export interface ConfirmBashRequest {
  requestId: string;
  command: string;
  reason: string;
  responded?: boolean;
  approved?: boolean;
  submitting?: boolean;
}

interface AskUserPayload {
  type?: string;
  chat_jid?: string;
  requestId?: string;
  question?: string;
}

interface ConfirmBashPayload {
  type?: string;
  chat_jid?: string;
  requestId?: string;
  command?: string;
  reason?: string;
}

export function extractAskUserRequest(
  payload: AskUserPayload,
  currentJid: string | null,
): AskUserRequest | null {
  if (
    payload.type !== 'ask_user' ||
    !currentJid ||
    payload.chat_jid !== currentJid ||
    !payload.requestId ||
    !payload.question
  ) {
    return null;
  }

  return {
    requestId: payload.requestId,
    question: payload.question,
  };
}

export function extractConfirmBashRequest(
  payload: ConfirmBashPayload,
  currentJid: string | null,
): ConfirmBashRequest | null {
  if (
    payload.type !== 'confirm_bash' ||
    !currentJid ||
    payload.chat_jid !== currentJid ||
    !payload.requestId ||
    !payload.command
  ) {
    return null;
  }

  return {
    requestId: payload.requestId,
    command: payload.command,
    reason: payload.reason || '危险命令',
  };
}

export function appendPendingAsk(
  prev: AskUserRequest[],
  next: AskUserRequest,
): AskUserRequest[] {
  const index = prev.findIndex((item) => item.requestId === next.requestId);
  if (index === -1) {
    return [...prev, next];
  }

  const merged = [...prev];
  merged[index] = { ...merged[index], ...next };
  return merged;
}

export function appendPendingConfirm(
  prev: ConfirmBashRequest[],
  next: ConfirmBashRequest,
): ConfirmBashRequest[] {
  const index = prev.findIndex((item) => item.requestId === next.requestId);
  if (index === -1) {
    return [...prev, next];
  }

  const merged = [...prev];
  merged[index] = { ...merged[index], ...next };
  return merged;
}

export function getNextPendingConfirm(
  requests: ConfirmBashRequest[],
): ConfirmBashRequest | null {
  return requests.find((request) => !request.responded) ?? null;
}
