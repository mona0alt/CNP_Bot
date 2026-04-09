import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, FileText, Loader2, Sparkles, X } from 'lucide-react';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useAuth } from '@/contexts/AuthContext';
import type { Chat, Message } from '@/lib/types';

interface KBExtractDialogProps {
  open: boolean;
  onClose: () => void;
  onSaved?: (uri: string) => void | Promise<void>;
  chatJid?: string | null;
}

type DraftSource = {
  chatJid?: string;
  chatName?: string;
  messageCount: number;
  generatedAt: string;
};

type DialogStep = 'form' | 'review';

const DEFAULT_KB_ROOT_URI = 'viking://resources/cnp-kb/';

export function KBExtractDialog({ open, onClose, onSaved, chatJid }: KBExtractDialogProps) {
  const { token, logout } = useAuth();
  const [step, setStep] = useState<DialogStep>('form');
  const [chats, setChats] = useState<Chat[]>([]);
  const [selectedChatJid, setSelectedChatJid] = useState(chatJid ?? '');
  const [title, setTitle] = useState('');
  const [preview, setPreview] = useState<Message[]>([]);
  const [draftContent, setDraftContent] = useState('');
  const [draftUri, setDraftUri] = useState('');
  const [draftSource, setDraftSource] = useState<DraftSource | null>(null);
  const [generatedTitle, setGeneratedTitle] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loadingChats, setLoadingChats] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [showOverwriteConfirm, setShowOverwriteConfirm] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [showBackConfirm, setShowBackConfirm] = useState(false);
  const [showRegenerateConfirm, setShowRegenerateConfirm] = useState(false);

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

  const currentDraftUri = useMemo(() => {
    if (step !== 'review') return '';
    return updateUriFilename(draftUri || `${DEFAULT_KB_ROOT_URI}draft.md`, title || generatedTitle);
  }, [draftUri, generatedTitle, step, title]);

  const hasUnsavedDraft = useMemo(() => {
    if (step !== 'review') return false;
    return title !== generatedTitle || draftContent.trim().length > 0;
  }, [draftContent, generatedTitle, step, title]);

  useEffect(() => {
    if (!open) return;
    setStep('form');
    setError('');
    setWarnings([]);
    setDraftContent('');
    setDraftUri('');
    setDraftSource(null);
    setGeneratedTitle('');
    setSelectedChatJid(chatJid ?? '');
    setTitle('');
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
    if (!selectedChat || step !== 'form') return;
    const today = new Date().toISOString().slice(0, 10);
    setTitle((currentTitle) => currentTitle || `${selectedChat.name || selectedChat.jid}-${today}`);
  }, [selectedChat, step]);

  useEffect(() => {
    if (!open || !selectedChatJid || !token || step !== 'form') {
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
  }, [apiBase, authHeaders, handleUnauthorized, open, selectedChatJid, step, token]);

  const handleDialogClose = useCallback(() => {
    if (hasUnsavedDraft) {
      setShowCloseConfirm(true);
      return;
    }
    onClose();
  }, [hasUnsavedDraft, onClose]);

  const handleGenerateDraft = useCallback(async () => {
    if (!selectedChatJid || !token) return;
    setIsGenerating(true);
    setError('');
    try {
      const response = await fetch(`${apiBase}/api/kb/extract-draft`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatJid: selectedChatJid,
          title: title.trim() || undefined,
          chatName: selectedChat?.name || undefined,
        }),
      });
      if (response.status === 401 || response.status === 403) {
        await handleUnauthorized();
        return;
      }
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || '草稿生成失败');
      }
      const nextTitle = typeof payload.draftTitle === 'string' && payload.draftTitle.trim()
        ? payload.draftTitle.trim()
        : title.trim();
      setGeneratedTitle(nextTitle);
      setTitle(nextTitle);
      setDraftContent(typeof payload.content === 'string' ? payload.content : '');
      setDraftUri(typeof payload.suggestedUri === 'string' ? payload.suggestedUri : '');
      setDraftSource(payload.source ?? null);
      setWarnings(Array.isArray(payload.warnings) ? payload.warnings.filter((item: unknown): item is string => typeof item === 'string') : []);
      setStep('review');
    } catch (err) {
      setError(err instanceof Error ? err.message : '草稿生成失败');
    } finally {
      setIsGenerating(false);
    }
  }, [apiBase, authHeaders, handleUnauthorized, selectedChat, selectedChatJid, title, token]);

  const handleBackToForm = useCallback(() => {
    if (hasUnsavedDraft) {
      setShowBackConfirm(true);
      return;
    }
    setStep('form');
    setError('');
  }, [hasUnsavedDraft]);

  const handleRegenerate = useCallback(async () => {
    if (hasUnsavedDraft) {
      setShowRegenerateConfirm(true);
      return;
    }
    await handleGenerateDraft();
  }, [handleGenerateDraft, hasUnsavedDraft]);

  const submitSave = useCallback(async (overwrite = false): Promise<boolean> => {
    const response = await fetch(`${apiBase}/api/kb/save-draft`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uri: currentDraftUri,
        content: draftContent,
        overwrite,
      }),
    });
    if (response.status === 401 || response.status === 403) {
      await handleUnauthorized();
      return false;
    }
    const payload = await response.json().catch(() => ({}));
    if (response.status === 409 && payload.code === 'KB_FILE_EXISTS') {
      setShowOverwriteConfirm(true);
      return false;
    }
    if (!response.ok) {
      throw new Error(payload.error || '保存失败');
    }
    const savedUri = typeof payload.uri === 'string' ? payload.uri : currentDraftUri;
    await onSaved?.(savedUri);
    onClose();
    return true;
  }, [apiBase, authHeaders, currentDraftUri, draftContent, handleUnauthorized, onClose, onSaved]);

  const handleSaveDraft = useCallback(async () => {
    if (!currentDraftUri || !draftContent.trim()) return;
    setIsSaving(true);
    setError('');
    try {
      await submitSave(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setIsSaving(false);
    }
  }, [currentDraftUri, draftContent, submitSave]);

  if (!open) return null;

  return (
    <div
      className="kb-extract-dialog-overlay"
      onClick={(event) => event.target === event.currentTarget && handleDialogClose()}
    >
      <div className="absolute left-0 right-0 top-0 h-1 bg-gradient-to-r from-teal-400 via-cyan-400 to-sky-500" />

      <div className="kb-extract-dialog" role="dialog" aria-modal="true" aria-labelledby="kb-extract-title">
        <div className="border-b border-border/60 px-6 pb-4 pt-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-teal-500/30 bg-gradient-to-br from-teal-400/20 to-cyan-500/20">
                {step === 'review'
                  ? <FileText size={20} className="text-teal-500" />
                  : <BookOpen size={20} className="text-teal-500" />}
              </div>
              <div>
                <h2 id="kb-extract-title" className="text-lg font-semibold tracking-tight">
                  {step === 'review' ? '审核知识草稿' : '提取到知识库'}
                </h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {step === 'review'
                    ? '确认并编辑草稿后，再保存到知识库根目录。'
                    : '从历史会话中生成一份待审核知识草稿。'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleDialogClose}
              className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="关闭"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="px-6 py-5">
          {step === 'form' ? (
            <div className="grid gap-5 md:grid-cols-[1.3fr_1fr]">
              <div className="space-y-4">
                <div>
                  <label className="mb-2 block text-sm font-medium text-muted-foreground">
                    选择会话
                  </label>
                  <select
                    value={selectedChatJid}
                    onChange={(event) => setSelectedChatJid(event.target.value)}
                    className="w-full rounded-xl border border-border/80 bg-background px-4 py-3 text-sm transition-colors focus:border-teal-500/60 focus:outline-none focus:ring-2 focus:ring-teal-500/20 disabled:opacity-50"
                    disabled={loadingChats || isGenerating}
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
                    className="w-full rounded-xl border border-border/80 bg-background px-4 py-3 text-sm transition-colors focus:border-teal-500/60 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                    placeholder="会话标题"
                    disabled={isGenerating}
                  />
                </div>

                <div className="rounded-2xl border border-teal-500/20 bg-teal-500/5 px-4 py-3 text-sm text-muted-foreground">
                  提取只会生成草稿，不会直接写入知识库。你确认内容后再保存。
                </div>

                {error ? (
                  <div className="rounded-xl border border-red-200/60 bg-red-50/80 px-4 py-3 text-sm text-red-600 backdrop-blur-sm">
                    {error}
                  </div>
                ) : null}
              </div>

              <div className="rounded-2xl border border-border/60 bg-muted/20 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sparkles size={14} className="text-teal-500" />
                    <h3 className="text-sm font-semibold">最近 5 条消息预览</h3>
                  </div>
                  {loadingPreview ? (
                    <Loader2 size={16} className="animate-spin text-muted-foreground" />
                  ) : null}
                </div>
                <div className="space-y-2.5 text-sm">
                  {preview.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border/60 px-4 py-5 text-center text-muted-foreground">
                      暂无可预览消息
                    </div>
                  ) : (
                    preview.map((message) => (
                      <div
                        key={message.id}
                        className="rounded-xl border border-border/50 bg-background/80 px-3 py-2 backdrop-blur-sm"
                      >
                        <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="font-medium">{message.sender_name}</span>
                          <span>·</span>
                          <span>{new Date(message.timestamp).toLocaleString()}</span>
                        </div>
                        <div className="line-clamp-4 whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground/80">
                          {message.content}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-[1.1fr_1fr]">
                <div>
                  <label className="mb-2 block text-sm font-medium text-muted-foreground">
                    标题
                  </label>
                  <input
                    type="text"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    className="w-full rounded-xl border border-border/80 bg-background px-4 py-3 text-sm transition-colors focus:border-teal-500/60 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                    placeholder="知识草稿标题"
                    disabled={isSaving}
                  />
                </div>
                <div className="rounded-xl border border-border/70 bg-muted/20 px-4 py-3">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    保存位置
                  </div>
                  <div className="mt-2 break-all text-sm font-medium text-foreground">
                    {currentDraftUri}
                  </div>
                </div>
              </div>

              {draftSource ? (
                <div className="rounded-xl border border-border/70 bg-background/70 px-4 py-3 text-sm text-muted-foreground">
                  <div>会话：{draftSource.chatName || draftSource.chatJid || '未知会话'}</div>
                  <div>消息数：{draftSource.messageCount}</div>
                  <div>提取时间：{new Date(draftSource.generatedAt).toLocaleString()}</div>
                </div>
              ) : null}

              {warnings.length > 0 ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                  {warnings.join(' ')}
                </div>
              ) : null}

              {error ? (
                <div className="rounded-xl border border-red-200/60 bg-red-50/80 px-4 py-3 text-sm text-red-600 backdrop-blur-sm">
                  {error}
                </div>
              ) : null}

              <div>
                <label className="mb-2 block text-sm font-medium text-muted-foreground">
                  草稿正文
                </label>
                <textarea
                  value={draftContent}
                  onChange={(event) => setDraftContent(event.target.value)}
                  className="min-h-[360px] w-full rounded-2xl border border-border/80 bg-background px-4 py-4 text-sm leading-6 transition-colors focus:border-teal-500/60 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                  disabled={isSaving}
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-6 pb-6">
          {step === 'form' ? (
            <>
              <button
                type="button"
                onClick={handleDialogClose}
                className="rounded-xl border border-border/80 px-5 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                关闭
              </button>
              <button
                type="button"
                onClick={() => void handleGenerateDraft()}
                disabled={!selectedChatJid || isGenerating}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-teal-500 to-cyan-500 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:opacity-90 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isGenerating ? <Loader2 size={16} className="animate-spin" /> : null}
                {isGenerating ? '提取中...' : '提取草稿'}
              </button>
            </>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleBackToForm}
                  className="rounded-xl border border-border/80 px-5 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  disabled={isSaving}
                >
                  返回上一步
                </button>
                <button
                  type="button"
                  onClick={() => void handleRegenerate()}
                  className="rounded-xl border border-border/80 px-5 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  disabled={isSaving || isGenerating}
                >
                  重新提取
                </button>
              </div>
              <button
                type="button"
                onClick={() => void handleSaveDraft()}
                disabled={isSaving || !draftContent.trim() || !title.trim()}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-teal-500 to-cyan-500 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:opacity-90 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSaving ? <Loader2 size={16} className="animate-spin" /> : null}
                {isSaving ? '保存中...' : '保存到知识库'}
              </button>
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={showOverwriteConfirm}
        title="文件已存在"
        message="目标文件已存在，是否覆盖原内容？"
        confirmLabel="覆盖"
        cancelLabel="取消"
        destructive
        onConfirm={() => {
          setShowOverwriteConfirm(false);
          void submitSave(true);
        }}
        onCancel={() => setShowOverwriteConfirm(false)}
      />

      <ConfirmDialog
        open={showCloseConfirm}
        title="草稿未保存"
        message="当前草稿尚未保存，确认关闭？"
        confirmLabel="关闭"
        cancelLabel="取消"
        onConfirm={() => {
          setShowCloseConfirm(false);
          onClose();
        }}
        onCancel={() => setShowCloseConfirm(false)}
      />

      <ConfirmDialog
        open={showBackConfirm}
        title="放弃修改"
        message="返回上一步会放弃当前草稿修改，是否继续？"
        confirmLabel="继续"
        cancelLabel="取消"
        onConfirm={() => {
          setShowBackConfirm(false);
          setStep('form');
          setError('');
        }}
        onCancel={() => setShowBackConfirm(false)}
      />

      <ConfirmDialog
        open={showRegenerateConfirm}
        title="重新提取"
        message="重新提取会覆盖当前草稿内容，是否继续？"
        confirmLabel="重新提取"
        cancelLabel="取消"
        onConfirm={() => {
          setShowRegenerateConfirm(false);
          void handleGenerateDraft();
        }}
        onCancel={() => setShowRegenerateConfirm(false)}
      />
    </div>
  );
}

function updateUriFilename(uri: string, title: string): string {
  const cleanedTitle = sanitizeTitle(title) || '知识草稿';
  const normalizedUri = uri.trim() || `${DEFAULT_KB_ROOT_URI}${cleanedTitle}.md`;
  const lastSlashIndex = normalizedUri.lastIndexOf('/');
  const prefix = lastSlashIndex >= 0 ? normalizedUri.slice(0, lastSlashIndex + 1) : `${DEFAULT_KB_ROOT_URI}`;
  return `${prefix}${cleanedTitle}.md`;
}

function sanitizeTitle(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
