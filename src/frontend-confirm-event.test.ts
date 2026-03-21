import { describe, expect, it } from 'vitest';

import {
  appendPendingAsk,
  appendPendingConfirm,
  extractAskUserRequest,
  extractConfirmBashRequest,
} from '../frontend/src/lib/interactive-events.js';

describe('frontend interactive event handling', () => {
  it('应把 ask_user websocket 消息转换成前端追问卡片数据', () => {
    const request = extractAskUserRequest(
      {
        type: 'ask_user',
        chat_jid: 'web:test',
        requestId: 'ask-1',
        question: '请提供环境名称',
      },
      'web:test',
    );

    expect(request).toEqual({
      requestId: 'ask-1',
      question: '请提供环境名称',
    });
  });

  it('应把 confirm_bash websocket 消息转换成前端确认卡片数据', () => {
    const request = extractConfirmBashRequest(
      {
        type: 'confirm_bash',
        chat_jid: 'web:test',
        requestId: 'req-1',
        command: 'rm -rf /tmp/cnp-danger-test',
        reason: '递归强制删除文件',
        targetHost: '10.1.2.3',
      },
      'web:test',
    );

    expect(request).toEqual({
      requestId: 'req-1',
      command: 'rm -rf /tmp/cnp-danger-test',
      reason: '递归强制删除文件',
      targetHost: '10.1.2.3',
    });
  });

  it('缺少 reason 时应使用默认文案，并加入待确认卡片列表', () => {
    const request = extractConfirmBashRequest(
      {
        type: 'confirm_bash',
        chat_jid: 'web:test',
        requestId: 'req-2',
        command: 'git reset --hard',
      },
      'web:test',
    );

    expect(request).toEqual({
      requestId: 'req-2',
      command: 'git reset --hard',
      reason: '危险命令',
    });

    const prev = [
      {
        requestId: 'existing',
        command: 'rm -rf /tmp/old',
        reason: '递归强制删除文件',
      },
    ];

    expect(appendPendingConfirm(prev, request!)).toEqual([
      prev[0],
      {
        requestId: 'req-2',
        command: 'git reset --hard',
        reason: '危险命令',
      },
    ]);
  });

  it('同一 requestId 的 ask 请求应合并状态', () => {
    expect(
      appendPendingAsk(
        [{ requestId: 'ask-2', question: 'Q', answered: true, answer: 'A' }],
        { requestId: 'ask-2', question: 'Q' },
      ),
    ).toEqual([{ requestId: 'ask-2', question: 'Q', answered: true, answer: 'A' }]);
  });

  it('非当前会话或字段不完整时，不应生成交互卡片', () => {
    expect(
      extractAskUserRequest(
        {
          type: 'ask_user',
          chat_jid: 'web:other',
          requestId: 'ask-3',
          question: 'Q',
        },
        'web:test',
      ),
    ).toBeNull();

    expect(
      extractConfirmBashRequest(
        {
          type: 'confirm_bash',
          chat_jid: 'web:test',
          requestId: 'req-4',
        },
        'web:test',
      ),
    ).toBeNull();
  });
});
