import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  FileText,
  Folder,
  FolderPlus,
  Loader2,
  Pencil,
  RefreshCcw,
  Save,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';

import { KBExtractDialog } from '@/components/kb/KBExtractDialog';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { useAuth } from '@/contexts/AuthContext';

type KBTreeNode = {
  uri: string;
  name: string;
  type: 'file' | 'directory';
  children?: KBTreeNode[];
};

type KBSearchResult = {
  uri: string;
  score?: number;
  abstract?: string;
  category?: string;
};

export function KnowledgeBase() {
  const { token, logout, user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [tree, setTree] = useState<KBTreeNode[]>([]);
  const [selectedUri, setSelectedUri] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<KBSearchResult[]>([]);
  const [kbConnected, setKbConnected] = useState<boolean | null>(null);
  const [showExtractDialog, setShowExtractDialog] = useState(false);
  const [loadingTree, setLoadingTree] = useState(false);
  const [loadingContent, setLoadingContent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  const selectedNode = useMemo(() => findNode(tree, selectedUri), [selectedUri, tree]);

  const loadTree = useCallback(async () => {
    if (!token) return;
    setLoadingTree(true);
    try {
      const response = await fetch(`${apiBase}/api/kb/tree`, { headers: authHeaders });
      if (response.status === 401 || response.status === 403) {
        await handleUnauthorized();
        return;
      }
      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: '加载知识库目录失败' }));
        throw new Error(payload.error || '加载知识库目录失败');
      }
      const data = await response.json();
      setTree(normalizeTree(data));
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载知识库目录失败');
    } finally {
      setLoadingTree(false);
    }
  }, [apiBase, authHeaders, handleUnauthorized, token]);

  const loadContent = useCallback(async (uri: string) => {
    if (!token) return;
    setLoadingContent(true);
    setError('');
    try {
      const response = await fetch(`${apiBase}/api/kb/read?uri=${encodeURIComponent(uri)}`, {
        headers: authHeaders,
      });
      if (response.status === 401 || response.status === 403) {
        await handleUnauthorized();
        return;
      }
      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: '读取知识内容失败' }));
        throw new Error(payload.error || '读取知识内容失败');
      }
      const data = await response.json();
      setContent(data.content ?? '');
      setSavedContent(data.content ?? '');
      setIsEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取知识内容失败');
    } finally {
      setLoadingContent(false);
    }
  }, [apiBase, authHeaders, handleUnauthorized, token]);

  useEffect(() => {
    if (!token) return;

    const bootstrap = async () => {
      try {
        const response = await fetch(`${apiBase}/api/kb/health`, { headers: authHeaders });
        if (response.status === 401 || response.status === 403) {
          await handleUnauthorized();
          return;
        }
        if (!response.ok) {
          throw new Error('无法检测知识库服务');
        }
        const data = await response.json();
        setKbConnected(Boolean(data.connected));
        if (data.connected) {
          await loadTree();
        }
      } catch (err) {
        setKbConnected(false);
        setError(err instanceof Error ? err.message : '无法检测知识库服务');
      }
    };

    void bootstrap();
  }, [apiBase, authHeaders, handleUnauthorized, loadTree, token]);

  useEffect(() => {
    if (!searchQuery.trim() || !token) {
      setSearchResults([]);
      return;
    }

    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`${apiBase}/api/kb/search`, {
          method: 'POST',
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: searchQuery.trim(), limit: 12 }),
        });
        if (response.status === 401 || response.status === 403) {
          await handleUnauthorized();
          return;
        }
        if (!response.ok) {
          throw new Error('语义搜索失败');
        }
        const data = await response.json();
        setSearchResults(Array.isArray(data) ? data : []);
      } catch (err) {
        setError(err instanceof Error ? err.message : '语义搜索失败');
      }
    }, 300);

    return () => window.clearTimeout(timer);
  }, [apiBase, authHeaders, handleUnauthorized, searchQuery, token]);

  const handleSelectUri = async (uri: string) => {
    setSelectedUri(uri);
    if (looksLikeDirectory(uri)) {
      setContent('');
      setSavedContent('');
      setIsEditing(false);
      return;
    }
    await loadContent(uri);
  };

  const handleSave = async () => {
    if (!selectedUri || !isAdmin) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`${apiBase}/api/kb/write`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ uri: selectedUri, content, mode: 'replace' }),
      });
      if (response.status === 401 || response.status === 403) {
        await handleUnauthorized();
        return;
      }
      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: '保存失败' }));
        throw new Error(payload.error || '保存失败');
      }
      setSavedContent(content);
      setIsEditing(false);
      await loadTree();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedUri || !isAdmin) return;
    try {
      const response = await fetch(`${apiBase}/api/kb?uri=${encodeURIComponent(selectedUri)}`, {
        method: 'DELETE',
        headers: authHeaders,
      });
      if (response.status === 401 || response.status === 403) {
        await handleUnauthorized();
        return;
      }
      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: '删除失败' }));
        throw new Error(payload.error || '删除失败');
      }
      setDeleteOpen(false);
      setSelectedUri(null);
      setContent('');
      setSavedContent('');
      await loadTree();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    }
  };

  const handleRename = async () => {
    if (!selectedUri || !isAdmin) return;
    const nextName = window.prompt('输入新名称', basenameFromUri(selectedUri));
    if (!nextName) return;
    const nextUri = renameUri(selectedUri, nextName.trim());
    try {
      const response = await fetch(`${apiBase}/api/kb/mv`, {
        method: 'PATCH',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: selectedUri, to: nextUri }),
      });
      if (response.status === 401 || response.status === 403) {
        await handleUnauthorized();
        return;
      }
      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: '重命名失败' }));
        throw new Error(payload.error || '重命名失败');
      }
      setSelectedUri(nextUri);
      await loadTree();
      if (!looksLikeDirectory(nextUri)) {
        await loadContent(nextUri);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '重命名失败');
    }
  };

  const handleCreateDir = async () => {
    if (!isAdmin) return;
    const nextName = window.prompt('新目录名称');
    if (!nextName) return;
    const base = selectedUri && looksLikeDirectory(selectedUri)
      ? selectedUri
      : 'viking://resources/cnp-kb/';
    const targetUri = ensureDirUri(`${base.replace(/\/?$/, '/')}${nextName.trim()}`);
    try {
      const response = await fetch(`${apiBase}/api/kb/mkdir`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ uri: targetUri }),
      });
      if (response.status === 401 || response.status === 403) {
        await handleUnauthorized();
        return;
      }
      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: '新建目录失败' }));
        throw new Error(payload.error || '新建目录失败');
      }
      await loadTree();
    } catch (err) {
      setError(err instanceof Error ? err.message : '新建目录失败');
    }
  };

  const handleUpload = async (file: File | null) => {
    if (!file || !isAdmin) return;
    const formData = new FormData();
    formData.append('file', file);
    if (selectedUri && looksLikeDirectory(selectedUri)) {
      formData.append('targetUri', selectedUri);
    }

    try {
      const response = await fetch(`${apiBase}/api/kb/upload`, {
        method: 'POST',
        headers: authHeaders,
        body: formData,
      });
      if (response.status === 401 || response.status === 403) {
        await handleUnauthorized();
        return;
      }
      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: '上传失败' }));
        throw new Error(payload.error || '上传失败');
      }
      await loadTree();
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败');
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleReindex = async () => {
    if (!selectedUri || !isAdmin) return;
    try {
      const response = await fetch(`${apiBase}/api/kb/reindex`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ uri: selectedUri }),
      });
      if (response.status === 401 || response.status === 403) {
        await handleUnauthorized();
        return;
      }
      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: '重建索引失败' }));
        throw new Error(payload.error || '重建索引失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '重建索引失败');
    }
  };

  const handleExtractSaved = useCallback(async (uri: string) => {
    setShowExtractDialog(false);
    await loadTree();
    await handleSelectUri(uri);
  }, [loadTree]);

  return (
    <div className="flex h-full bg-background">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="border-b bg-card/70 px-6 py-4 backdrop-blur-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background px-3 py-1 text-xs font-medium text-muted-foreground">
                <BookOpen size={14} />
                OpenViking Knowledge Base
              </div>
              <h1 className="mt-3 text-2xl font-semibold tracking-tight">知识库管理</h1>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[240px]">
                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
                <input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="语义搜索 SOP、事件记录、部署经验..."
                  className="w-full rounded-xl border bg-background py-2 pl-10 pr-4 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              {isAdmin ? (
                <>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm hover:bg-muted"
                  >
                    <Upload size={16} />
                    上传
                  </button>
                  <button
                    onClick={handleCreateDir}
                    className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm hover:bg-muted"
                  >
                    <FolderPlus size={16} />
                    新建目录
                  </button>
                </>
              ) : null}
              <button
                onClick={() => setShowExtractDialog(true)}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                <BookOpen size={16} />
                从会话导入
              </button>
            </div>
          </div>
        </div>

        {kbConnected === false ? (
          <div className="mx-6 mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            知识库服务未连接，请检查 OpenViking 配置。
          </div>
        ) : null}

        {error ? (
          <div className="mx-6 mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[320px_1fr]">
          <aside className="border-r bg-card/30 px-4 py-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-muted-foreground">
                {searchQuery.trim() ? '搜索结果' : '目录树'}
              </h2>
              {loadingTree ? <Loader2 size={16} className="animate-spin text-muted-foreground" /> : null}
            </div>
            <div className="max-h-[calc(100vh-220px)] overflow-y-auto pr-2">
              {searchQuery.trim() ? (
                <div className="space-y-2">
                  {searchResults.map((item) => (
                    <button
                      key={item.uri}
                      onClick={() => void handleSelectUri(item.uri)}
                      className={`w-full rounded-xl border px-3 py-3 text-left transition-colors hover:bg-muted ${
                        selectedUri === item.uri ? 'border-primary bg-primary/5' : 'border-border/70'
                      }`}
                    >
                      <div className="text-sm font-medium">{basenameFromUri(item.uri)}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {item.category ?? 'knowledge'} · {Math.round((item.score ?? 0) * 100)}%
                      </div>
                      <div className="mt-2 line-clamp-3 text-xs text-muted-foreground">
                        {item.abstract || item.uri}
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <TreeView nodes={tree} selectedUri={selectedUri} onSelect={handleSelectUri} />
              )}
            </div>
          </aside>

          <section className="min-w-0 px-6 py-5">
            {selectedUri ? (
              <div className="flex h-full flex-col">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                      {selectedNode?.type === 'directory' ? 'Directory' : 'Document'}
                    </div>
                    <h2 className="mt-1 text-xl font-semibold">{basenameFromUri(selectedUri)}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">{selectedUri}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {selectedNode?.type !== 'directory' && isAdmin ? (
                      isEditing ? (
                        <>
                          <button
                            onClick={() => {
                              setContent(savedContent);
                              setIsEditing(false);
                            }}
                            className="rounded-xl border px-3 py-2 text-sm hover:bg-muted"
                          >
                            取消
                          </button>
                          <button
                            onClick={() => void handleSave()}
                            className="inline-flex items-center gap-2 rounded-xl bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
                          >
                            <Save size={16} />
                            {saving ? '保存中...' : '保存'}
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => setIsEditing(true)}
                          className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm hover:bg-muted"
                        >
                          <Pencil size={16} />
                          编辑
                        </button>
                      )
                    ) : null}
                    {isAdmin ? (
                      <>
                        <button
                          onClick={() => void handleRename()}
                          className="rounded-xl border px-3 py-2 text-sm hover:bg-muted"
                        >
                          重命名
                        </button>
                        <button
                          onClick={() => void handleReindex()}
                          className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm hover:bg-muted"
                        >
                          <RefreshCcw size={16} />
                          重建索引
                        </button>
                        <button
                          onClick={() => setDeleteOpen(true)}
                          className="inline-flex items-center gap-2 rounded-xl border border-red-200 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                        >
                          <Trash2 size={16} />
                          删除
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-hidden rounded-3xl border bg-card/50">
                  {loadingContent ? (
                    <div className="flex h-full items-center justify-center text-muted-foreground">
                      <Loader2 className="animate-spin" size={18} />
                    </div>
                  ) : selectedNode?.type === 'directory' ? (
                    <div className="flex h-full items-center justify-center px-6 text-center text-muted-foreground">
                      目录节点当前不支持直接编辑，请选择具体文档或在该目录下上传资料。
                    </div>
                  ) : isEditing ? (
                    <textarea
                      value={content}
                      onChange={(event) => setContent(event.target.value)}
                      className="h-full min-h-[420px] w-full resize-none bg-transparent p-5 font-mono text-sm leading-6 outline-none"
                    />
                  ) : (
                    <div className="h-full overflow-y-auto p-5">
                      {content ? (
                        <MarkdownRenderer content={content} />
                      ) : (
                        <div className="text-muted-foreground">当前文档没有内容。</div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center rounded-3xl border border-dashed text-muted-foreground">
                <div className="text-center">
                  <FileText className="mx-auto mb-4" size={32} />
                  选择左侧目录或搜索结果查看内容
                </div>
              </div>
            )}
          </section>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={(event) => void handleUpload(event.target.files?.[0] ?? null)}
      />

      <KBExtractDialog
        open={showExtractDialog}
        onClose={() => setShowExtractDialog(false)}
        onSaved={handleExtractSaved}
      />

      <ConfirmDialog
        open={deleteOpen}
        title="删除知识节点"
        message="确定要删除当前知识节点吗？该操作无法撤销。"
        confirmLabel="删除"
        cancelLabel="取消"
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleteOpen(false)}
        destructive
      />
    </div>
  );
}

function TreeView({
  nodes,
  selectedUri,
  onSelect,
  depth = 0,
}: {
  nodes: KBTreeNode[];
  selectedUri: string | null;
  onSelect: (uri: string) => void | Promise<void>;
  depth?: number;
}) {
  return (
    <div className="space-y-1">
      {nodes.map((node) => (
        <div key={node.uri}>
          <button
            onClick={() => void onSelect(node.uri)}
            className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition-colors hover:bg-muted ${
              selectedUri === node.uri ? 'bg-primary/10 text-primary' : ''
            }`}
            style={{ paddingLeft: `${12 + depth * 14}px` }}
          >
            {node.type === 'directory' ? <Folder size={16} /> : <FileText size={16} />}
            <span className="truncate">{node.name}</span>
          </button>
          {node.children?.length ? (
            <TreeView
              nodes={node.children}
              selectedUri={selectedUri}
              onSelect={onSelect}
              depth={depth + 1}
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}

function normalizeTree(input: unknown): KBTreeNode[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((node) => normalizeNode(node))
    .filter((node): node is KBTreeNode => Boolean(node));
}

function normalizeNode(input: unknown): KBTreeNode | null {
  if (!input || typeof input !== 'object') return null;
  const record = input as Record<string, unknown>;
  const uri = typeof record.uri === 'string'
    ? record.uri
    : typeof record.path === 'string'
      ? record.path
      : null;
  if (!uri) return null;
  const childrenRaw = Array.isArray(record.children) ? record.children : [];
  const children = childrenRaw
    .map((item) => normalizeNode(item))
    .filter((item): item is KBTreeNode => Boolean(item));
  const explicitType = record.type === 'directory' || record.type === 'file'
    ? record.type
    : null;
  return {
    uri,
    name: typeof record.name === 'string' ? record.name : basenameFromUri(uri),
    type: explicitType ?? (looksLikeDirectory(uri) || children.length > 0 ? 'directory' : 'file'),
    children,
  };
}

function findNode(nodes: KBTreeNode[], targetUri: string | null): KBTreeNode | null {
  if (!targetUri) return null;
  for (const node of nodes) {
    if (node.uri === targetUri) return node;
    if (node.children?.length) {
      const nested = findNode(node.children, targetUri);
      if (nested) return nested;
    }
  }
  return null;
}

function looksLikeDirectory(uri: string): boolean {
  return /\/$/.test(uri);
}

function basenameFromUri(uri: string): string {
  const normalized = uri.replace(/\/+$/, '');
  const parts = normalized.split('/');
  return parts[parts.length - 1] || uri;
}

function ensureDirUri(uri: string): string {
  return uri.endsWith('/') ? uri : `${uri}/`;
}

function renameUri(uri: string, nextName: string): string {
  const normalized = uri.replace(/\/+$/, '');
  const parts = normalized.split('/');
  parts[parts.length - 1] = nextName;
  const rebuilt = parts.join('/');
  return looksLikeDirectory(uri) ? `${rebuilt}/` : rebuilt;
}
