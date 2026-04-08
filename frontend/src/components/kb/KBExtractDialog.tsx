import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Loader2, X } from 'lucide-react';

import { useAuth } from '@/contexts/AuthContext';
import type { Chat, Message } from '@/lib/types';

interface KBExtractDialogProps {
  open: boolean;
  onClose: () => void;
  chatJid?: string | null;
}

export function KBExtractDialog({ open, onClose, chatJid }: KBExtractDialogProps) {
  const { token, logout } = useAuth();
  const [chats, setChats] = useState<Chat[]>([]);
  const [selectedChatJid, setSelectedChatJid] = useState(chatJid ?? '');
  const [title, setTitle] = useState('');
  const [preview, setPreview] = useState<Message[]>([]);
  const [loadingChats, setLoadingChats] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [resultText, setResultText] = useState('');

  const apiBase = import.meta.env.DEV
    ? `${location.protocol}//${location.hostname}:3000`
    : '';

  const authHeaders = useMemo<HeadersInit | undefined>(() => {
    if (!token) return undefined;
    return { Authorization: `Bearer ${token}` };
  }, [token]);

  const handleUnauthorized = useCallback(async () => {
    await logout();
    window.location.href = '/login';
  }, [logout]);

  const selectedChat = chats.find((item) => item.jid === selectedChatJid) ?? null;

  useEffect(() => {
    if (!open) return;
    setError('');
    setResultText('');
    setSelectedChatJid(chatJid ?? '');
  }, [chatJid, open]);

  useEffect(() => {
    if (!open || !token) return;

    const loadChats = async () => {
      setLoadingChats(true);
      try {
        const response = await fetch(`${apiBase}/api/chats`, { headers: authHeaders });
        if (response.status === 401 || response.status === 403) {
          await handleUnauthorized();
          return;
        }
        if (!response.ok) {
          throw new Error('加载会话列表失败');
        }
        const data = await response.json();
        const nextChats = Array.isArray(data) ? data as Chat[] : [];
        setChats(nextChats);
        const preferred = chatJid && nextChats.some((item) => item.jid === chatJid)
          ? chatJid
          : nextChats[0]?.jid ?? '';
        setSelectedChatJid(preferred);
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载会话列表失败');
      } finally {
        setLoadingChats(false);
      }
    };

    void loadChats();
  }, [apiBase, authHeaders, chatJid, handleUnauthorized, open, token]);

  useEffect(() => {
    if (!selectedChat) return;
    const today = new Date().toISOString().slice(0, 10);
    setTitle(`${selectedChat.name || selectedChat.jid}-${today}`);
  }, [selectedChat]);

  useEffect(() => {
    if (!open || !selectedChatJid || !token) {
      setPreview([]);
      return;
    }

    const loadPreview = async () => {
      setLoadingPreview(true);
      try {
        const response = await fetch(
          `${apiBase}/api/groups/${encodeURIComponent(selectedChatJid)}/messages?limit=5`,
          { headers: authHeaders },
        );
        if (response.status === 401 || response.status === 403) {
          await handleUnauthorized();
          return;
        }
        if (!response.ok) {
          throw new Error('加载会话预览失败');
        }
        const data = await response.json();
        setPreview(Array.isArray(data) ? data as Message[] : []);
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载会话预览失败');
      } finally {
        setLoadingPreview(false);
      }
    };

    void loadPreview();
  }, [apiBase, authHeaders, handleUnauthorized, open, selectedChatJid, token]);

  const handleSubmit = async () => {
    if (!selectedChatJid || !token) return;
    setSubmitting(true);
    setError('');
    setResultText('');

    try {
      const response = await fetch(`${apiBase}/api/kb/extract`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatJid: selectedChatJid,
          title: title.trim() || undefined,
        }),
      });
      if (response.status === 401 || response.status === 403) {
        await handleUnauthorized();
        return;
      }
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || '提取失败');
      }

      const count = typeof payload.count === 'number' ? payload.count : 0;
      const partial = Boolean(payload.partial);
      setResultText(partial ? `部分提取成功，新增 ${count} 条知识。` : `成功提取 ${count} 条知识。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '提取失败');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="rename-dialog-overlay"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="rename-dialog max-w-2xl" role="dialog" aria-modal="true" aria-labelledby="kb-extract-title">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h2 id="kb-extract-title" className="text-lg font-semibold tracking-tight">
              提取到知识库
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              从历史会话中提炼可复用知识并写入 OpenViking。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="关闭"
          >
            <X size={18} />
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-[1.2fr_1fr]">
          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-muted-foreground">
                选择会话
              </label>
              <select
                value={selectedChatJid}
                onChange={(event) => setSelectedChatJid(event.target.value)}
                className="w-full rounded-xl border bg-background px-4 py-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                disabled={loadingChats}
              >
                {loadingChats ? (
                  <option>加载中...</option>
                ) : (
                  chats.map((chat) => (
                    <option key={chat.jid} value={chat.jid}>
                      {chat.name || chat.jid}
                    </option>
                  ))
                )}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-muted-foreground">
                标题
              </label>
              <input
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="w-full rounded-xl border bg-background px-4 py-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder="会话标题"
              />
            </div>

            {error ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
                {error}
              </div>
            ) : null}

            {resultText ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                <span className="inline-flex items-center gap-2">
                  <Check size={16} />
                  {resultText}
                </span>
              </div>
            ) : null}
          </div>

          <div className="rounded-2xl border bg-muted/20 p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">最近 5 条消息预览</h3>
              {loadingPreview ? <Loader2 size={16} className="animate-spin text-muted-foreground" /> : null}
            </div>
            <div className="space-y-3 text-sm">
              {preview.length === 0 ? (
                <div className="rounded-xl border border-dashed px-4 py-6 text-center text-muted-foreground">
                  暂无可预览消息
                </div>
              ) : (
                preview.map((message) => (
                  <div key={message.id} className="rounded-xl border bg-background px-3 py-2">
                    <div className="mb-1 text-xs text-muted-foreground">
                      {message.sender_name} · {new Date(message.timestamp).toLocaleString()}
                    </div>
                    <div className="line-clamp-4 whitespace-pre-wrap break-words text-sm">
                      {message.content}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border px-5 py-2.5 text-sm font-medium transition-colors hover:bg-muted"
          >
            关闭
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!selectedChatJid || submitting}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? <Loader2 size={16} className="animate-spin" /> : null}
            提取
          </button>
        </div>
      </div>
    </div>
  );
}
