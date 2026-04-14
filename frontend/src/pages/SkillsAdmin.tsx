import { useCallback, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DeleteSkillDialog } from "@/components/skills/DeleteSkillDialog";
import { SkillFileEditor } from "@/components/skills/SkillFileEditor";
import { SkillTree } from "@/components/skills/SkillTree";
import { ZipUploadDialog } from "@/components/skills/ZipUploadDialog";
import { useAuth } from "@/contexts/AuthContext";
import type { SkillCatalogItem, SkillTreeNode } from "@/lib/types";

function flattenTree(nodes: SkillTreeNode[]): SkillTreeNode[] {
  const result: SkillTreeNode[] = [];
  for (const node of nodes) {
    result.push(node);
    if (node.children?.length) {
      result.push(...flattenTree(node.children));
    }
  }
  return result;
}

function rootFromPath(targetPath: string): string {
  return targetPath.split("/").filter(Boolean)[0] ?? "";
}

function extractSummary(content: string | null | undefined): string {
  if (!content) return '';
  const lines = content.split('\n').filter(l => l.trim().length > 0).slice(0, 3);
  const text = lines.join(' ').trim();
  return text.length > 150 ? text.slice(0, 147) + '...' : text;
}

export function SkillsAdmin() {
  const { token, logout, user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [skills, setSkills] = useState<SkillCatalogItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeSkill, setActiveSkill] = useState<string | null>(null);
  const [tree, setTree] = useState<SkillTreeNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState("");
  const [originContent, setOriginContent] = useState("");
  const [selectedEditable, setSelectedEditable] = useState(false);
  const [fileError, setFileError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isMutatingFs, setIsMutatingFs] = useState(false);
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmSwitch, setConfirmSwitch] = useState(false);
  const [pendingSwitchSkill, setPendingSwitchSkill] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const authHeaders = useMemo<HeadersInit | undefined>(() => {
    if (!token) return undefined;
    return { Authorization: `Bearer ${token}` };
  }, [token]);

  const isDirty = isAdmin && selectedEditable && fileContent !== originContent;
  const nodeMap = useMemo(() => {
    const map = new Map<string, SkillTreeNode>();
    for (const node of flattenTree(tree)) map.set(node.path, node);
    return map;
  }, [tree]);
  const selectedNode = selectedPath ? nodeMap.get(selectedPath) ?? null : null;

  const handleUnauthorized = useCallback(async () => {
    await logout();
    window.location.href = "/login";
  }, [logout]);

  const resetEditorState = () => {
    setSelectedPath(null);
    setFileContent("");
    setOriginContent("");
    setSelectedEditable(false);
    setFileError("");
  };

  const loadSkillsList = useCallback(async () => {
    if (!token) return;
    const endpoint = isAdmin ? "/api/skills" : "/api/skills/catalog";
    const res = await fetch(endpoint, { headers: authHeaders });
    if (res.status === 401 || res.status === 403) {
      await handleUnauthorized();
      return;
    }
    if (!res.ok) {
      throw new Error("加载技能列表失败");
    }
    const data = await res.json();
    const rawSkills = Array.isArray(data) ? data : [];
    // 并行预抓取每个 skill 的 SKILL.md 概要
    const summaryPromises = rawSkills.map(skill =>
      fetch(`${isAdmin ? "/api/skills/file" : "/api/skills/catalog/file"}?path=${encodeURIComponent(skill.name + '/SKILL.md')}`, { headers: authHeaders })
        .then(r => r.ok ? r.json() : null)
        .then(data => ({
          name: skill.name,
          has_skill_md: skill.has_skill_md,
          updated_at: skill.updated_at,
          summary: extractSummary(data?.content)
        }))
        .catch(() => ({ ...skill, summary: '' }))
    );
    const skillsWithSummary = await Promise.all(summaryPromises);
    setSkills(skillsWithSummary);
  }, [authHeaders, handleUnauthorized, isAdmin, token]);

  const loadSkillTree = useCallback(
    async (skillName: string) => {
      if (!token) return;
      setTreeLoading(true);
      try {
        const endpoint = isAdmin ? "/api/skills/tree" : "/api/skills/catalog/tree";
        const res = await fetch(`${endpoint}?skill=${encodeURIComponent(skillName)}`, {
          headers: authHeaders,
        });
        if (res.status === 401 || res.status === 403) {
          await handleUnauthorized();
          return;
        }
        if (!res.ok) {
          const payload = await res.json().catch(() => ({ error: "加载技能文件树失败" }));
          throw new Error(payload.error || "加载技能文件树失败");
        }
        const data = await res.json();
        setTree(Array.isArray(data) ? data : []);
      } finally {
        setTreeLoading(false);
      }
    },
    [authHeaders, handleUnauthorized, isAdmin, token],
  );

  const loadFile = useCallback(
    async (path: string) => {
      if (!token) return;
      setFileError("");
      const endpoint = isAdmin ? "/api/skills/file" : "/api/skills/catalog/file";
      const res = await fetch(`${endpoint}?path=${encodeURIComponent(path)}`, {
        headers: authHeaders,
      });
      if (res.status === 401 || res.status === 403) {
        await handleUnauthorized();
        return;
      }
      if (!res.ok) {
        const payload = await res.json().catch(() => ({ error: "读取文件失败" }));
        throw new Error(payload.error || "读取文件失败");
      }
      const data = await res.json();
      setSelectedPath(data.path ?? path);
      setFileContent(data.content ?? "");
      setOriginContent(data.content ?? "");
      setSelectedEditable(Boolean(data.editable));
    },
    [authHeaders, handleUnauthorized, isAdmin, token],
  );

  const loadPageData = useCallback(async () => {
    if (!token) return;
    setError("");
    try {
      await loadSkillsList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载技能列表失败");
    } finally {
      setIsLoading(false);
    }
  }, [loadSkillsList, token]);

  useEffect(() => {
    void loadPageData();
  }, [loadPageData]);

  const closeDrawer = (allowDirtyDiscard = false) => {
    if (!allowDirtyDiscard && isDirty) {
      setConfirmClose(true);
      return;
    }
    setDrawerOpen(false);
    setActiveSkill(null);
    setTree([]);
    resetEditorState();
  };

  const handleOpenSkill = useCallback(
    async (skillName: string) => {
      if (isDirty) {
        setPendingSwitchSkill(skillName);
        setConfirmSwitch(true);
        return;
      }
      setError("");
      setDrawerOpen(true);
      setActiveSkill(skillName);
      resetEditorState();
      try {
        await loadSkillTree(skillName);
        await loadFile(`${skillName}/SKILL.md`);
      } catch (err) {
        setFileError(err instanceof Error ? err.message : "读取技能详情失败");
      }
    },
    [isDirty, loadFile, loadSkillTree],
  );

  const handleSave = useCallback(async (): Promise<boolean> => {
    if (!isAdmin || !token || !selectedPath || !selectedEditable) return true;
    setFileError("");
    setIsSaving(true);
    try {
      const res = await fetch("/api/skills/file", {
        method: "PUT",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ path: selectedPath, content: fileContent }),
      });
      if (res.status === 401 || res.status === 403) {
        await handleUnauthorized();
        return false;
      }
      if (!res.ok) {
        const payload = await res.json().catch(() => ({ error: "保存失败" }));
        throw new Error(payload.error || "保存失败");
      }
      setOriginContent(fileContent);
      return true;
    } catch (err) {
      setFileError(err instanceof Error ? err.message : "保存失败");
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [authHeaders, fileContent, handleUnauthorized, isAdmin, selectedEditable, selectedPath, token]);

  const handleSaveAndClose = useCallback(async () => {
    const ok = await handleSave();
    if (ok) {
      closeDrawer(true);
    }
  }, [handleSave]);

  const refreshCurrentSkill = useCallback(
    async (nextSkill?: string) => {
      await loadSkillsList();
      const targetSkill = nextSkill ?? activeSkill;
      if (targetSkill) {
        await loadSkillTree(targetSkill);
      }
    },
    [activeSkill, loadSkillTree, loadSkillsList],
  );

  const handleCreateEntry = useCallback(
    async (parentPath: string, type: "file" | "directory", name: string) => {
      if (!isAdmin || !token) return;
      const normalizedName = name.trim();
      if (!normalizedName) return;
      setError("");
      setIsMutatingFs(true);
      try {
        const res = await fetch("/api/skills/fs", {
          method: "POST",
          headers: { ...authHeaders, "Content-Type": "application/json" },
          body: JSON.stringify({ parentPath, name: normalizedName, type }),
        });
        if (res.status === 401 || res.status === 403) {
          await handleUnauthorized();
          return;
        }
        if (!res.ok) {
          const payload = await res.json().catch(() => ({ error: "创建失败" }));
          throw new Error(payload.error || "创建失败");
        }
        const payload = (await res.json().catch(() => ({}))) as { path?: string };
        const nextSkill = payload.path ? rootFromPath(payload.path) : activeSkill ?? undefined;
        if (nextSkill) setActiveSkill(nextSkill);
        await refreshCurrentSkill(nextSkill);
        if (payload.path) {
          setSelectedPath(payload.path);
          if (type === "file") {
            await loadFile(payload.path);
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "创建失败");
      } finally {
        setIsMutatingFs(false);
      }
    },
    [activeSkill, authHeaders, handleUnauthorized, isAdmin, loadFile, refreshCurrentSkill, token],
  );

  const handleMoveEntry = useCallback(
    async (fromPath: string, toPath: string) => {
      if (!isAdmin || !token || fromPath === toPath) return;
      setError("");
      setIsMutatingFs(true);
      try {
        const res = await fetch("/api/skills/fs", {
          method: "PATCH",
          headers: { ...authHeaders, "Content-Type": "application/json" },
          body: JSON.stringify({ fromPath, toPath }),
        });
        if (res.status === 401 || res.status === 403) {
          await handleUnauthorized();
          return;
        }
        if (!res.ok) {
          const payload = await res.json().catch(() => ({ error: "移动失败" }));
          throw new Error(payload.error || "移动失败");
        }
        const nextSkill = rootFromPath(toPath);
        if (nextSkill) setActiveSkill(nextSkill);
        await refreshCurrentSkill(nextSkill);
        if (selectedPath === fromPath) {
          setSelectedPath(toPath);
          await loadFile(toPath);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "移动失败");
      } finally {
        setIsMutatingFs(false);
      }
    },
    [authHeaders, handleUnauthorized, isAdmin, loadFile, refreshCurrentSkill, selectedPath, token],
  );

  const handleDeleteSelected = useCallback(async () => {
    if (!isAdmin || !token || !selectedPath) return;
    setConfirmDelete(true);
    setError("");
    setIsMutatingFs(true);
    try {
      const res = await fetch(`/api/skills/fs?path=${encodeURIComponent(selectedPath)}`, {
        method: "DELETE",
        headers: authHeaders,
      });
      if (res.status === 401 || res.status === 403) {
        await handleUnauthorized();
        return;
      }
      if (!res.ok) {
        const payload = await res.json().catch(() => ({ error: "删除失败" }));
        throw new Error(payload.error || "删除失败");
      }
      const deletedRoot = rootFromPath(selectedPath);
      if (deletedRoot && activeSkill === deletedRoot && selectedPath === deletedRoot) {
        await loadSkillsList();
        closeDrawer(true);
        return;
      }
      resetEditorState();
      await refreshCurrentSkill();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    } finally {
      setIsMutatingFs(false);
    }
  }, [activeSkill, authHeaders, handleUnauthorized, isAdmin, loadSkillsList, refreshCurrentSkill, selectedPath, token]);

  const handleUploadZip = useCallback(
    async (file: File) => {
      if (!isAdmin || !token) return;
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/skills/upload-zip", {
        method: "POST",
        headers: authHeaders,
        body: formData,
      });
      if (res.status === 401 || res.status === 403) {
        await handleUnauthorized();
        return;
      }
      if (!res.ok) {
        const payload = await res.json().catch(() => ({ error: "上传失败" }));
        throw new Error(payload.error || "上传失败");
      }
      await loadSkillsList();
    },
    [authHeaders, handleUnauthorized, isAdmin, loadSkillsList, token],
  );

  const handleDeleteSkill = useCallback(async () => {
    if (!isAdmin || !token || !activeSkill) return;
    try {
      const res = await fetch(`/api/skills/fs?path=${encodeURIComponent(activeSkill)}`, {
        method: "DELETE",
        headers: authHeaders,
      });
      if (res.status === 401 || res.status === 403) {
        await handleUnauthorized();
        return;
      }
      if (!res.ok) {
        const payload = await res.json().catch(() => ({ error: "删除失败" }));
        throw new Error(payload.error || "删除失败");
      }
      setShowDeleteDialog(false);
      closeDrawer(true);
      await loadSkillsList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    }
  }, [activeSkill, authHeaders, handleUnauthorized, isAdmin, loadSkillsList, token]);

  const handleNodeSelect = async (node: SkillTreeNode) => {
    setSelectedPath(node.path);
    if (node.type === "directory") {
      setFileContent("");
      setOriginContent("");
      setSelectedEditable(false);
      setFileError("");
    } else {
      // Single-click on file loads content into preview
      try {
        await loadFile(node.path);
      } catch (err) {
        setFileError(err instanceof Error ? err.message : "读取文件失败");
      }
    }
  };

  const handleNodeOpen = useCallback(
    async (node: SkillTreeNode) => {
      try {
        if (node.type === "directory") {
          await loadFile(`${node.path}/SKILL.md`);
          return;
        }
        await loadFile(node.path);
      } catch (err) {
        setFileError(err instanceof Error ? err.message : "读取文件失败");
      }
    },
    [loadFile],
  );

  if (isLoading) {
    return <div className="p-6">加载技能列表中...</div>;
  }

  return (
    <div className="h-full overflow-y-auto bg-background px-4 py-4 lg:px-5 lg:py-5">
      <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-4">
        <div className="rounded-2xl border bg-card/60 px-5 py-5 backdrop-blur-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">技能</h1>
              <p className="app-caption mt-1 text-muted-foreground">
                单击技能卡片进入详情侧栏，{isAdmin ? "可进行增删改查" : "普通用户仅可查看文件列表与内容"}
              </p>
            </div>
            {isAdmin && (
              <button
                type="button"
                onClick={() => setShowUploadDialog(true)}
                className="app-control rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground"
              >
                上传 ZIP
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-600">
            {error}
          </div>
        )}

        {skills.length === 0 ? (
          <div className="rounded-xl border border-dashed p-4 text-[13px] text-muted-foreground">
            当前没有可用技能
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {skills.map((skill, index) => (
              <button
                key={skill.name}
                type="button"
                data-testid={`skill-card-${skill.name}`}
                onClick={() => void handleOpenSkill(skill.name)}
                className="skill-card app-card-pad group relative cursor-pointer rounded-xl border bg-card text-left transition-all duration-300 ease-out"
                style={{ animationDelay: `${index * 50}ms` }}
              >
                <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-primary/5 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

                {activeSkill === skill.name && (
                  <div className="absolute inset-0 rounded-xl ring-2 ring-primary/30" />
                )}

                <div className="relative flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-primary/20 to-primary/5 text-primary">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polygon points="12 2 2 7 12 12 22 7 12 2" />
                          <polyline points="2 17 12 22 22 17" />
                          <polyline points="2 12 12 17 22 12" />
                        </svg>
                      </div>
                      <span className="font-brand truncate text-base font-semibold tracking-tight">{skill.name}</span>
                    </div>

                    <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground/80">
                      {skill.summary || '暂无概要'}
                    </p>
                  </div>

                  <div className="shrink-0">
                    <span className="inline-flex items-center rounded-full bg-muted/50 px-2 py-0.5 text-xs font-medium text-muted-foreground tabular-nums">
                      {new Date(skill.updated_at).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                </div>

                <div className="mt-3 h-px bg-gradient-to-r from-transparent via-border to-transparent opacity-60 transition-opacity duration-300 group-hover:opacity-100" />
              </button>
            ))}
          </div>
        )}
      </div>

      {drawerOpen && (
        <>
          <button
            type="button"
            aria-label="close-skill-drawer-backdrop"
            className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]"
            onClick={() => closeDrawer(false)}
          />
          <aside className="fixed inset-y-0 right-0 z-50 flex h-screen w-full flex-col border-l bg-background/95 shadow-2xl backdrop-blur-xl lg:w-[calc(100vw-72px)]">
            {/* Enhanced Header */}
            <div className="relative border-b">
              {/* Gradient accent bar */}
              <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary/50 via-primary to-primary/50" />

              <div className="flex items-center justify-between px-5 py-4">
                <div className="flex items-center gap-3">
                  {/* Skill icon */}
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-primary/20 to-primary/5 text-primary shadow-sm ring-1 ring-primary/10">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="12 2 2 7 12 12 22 7 12 2" />
                      <polyline points="2 17 12 22 22 17" />
                      <polyline points="2 12 12 17 22 12" />
                    </svg>
                  </div>
                  <div>
                    <h2 className="font-brand text-xl font-semibold tracking-tight">{activeSkill}</h2>
                    <p className="app-caption mt-1 flex items-center gap-1.5 text-muted-foreground">
                      {isAdmin ? (
                        <>
                          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                            管理员
                          </span>
                          <span className="text-muted-foreground/60">·</span>
                          <span>可编辑</span>
                        </>
                      ) : (
                        <>
                          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                            只读
                          </span>
                        </>
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {isAdmin && (
                    <>
                      <button
                        type="button"
                        onClick={() => setShowDeleteDialog(true)}
                        className="app-control rounded-xl border border-red-200/50 px-4 text-sm font-medium text-red-500 transition-all hover:bg-red-500/10"
                      >
                        <span className="flex items-center gap-2">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                          删除技能
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleSaveAndClose()}
                        disabled={isSaving}
                        className="app-control rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-all hover:shadow-xl hover:shadow-primary/30 disabled:opacity-50"
                      >
                        保存并退出
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    aria-label="关闭技能详情"
                    onClick={() => closeDrawer(false)}
                    className="rounded-xl border p-2 transition-all hover:bg-muted"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>
            </div>

            <div className="grid min-h-0 flex-1 gap-4 p-4 lg:grid-cols-[320px_minmax(0,1fr)]">
              <section className="app-card-pad flex min-h-0 flex-col gap-3 rounded-xl border bg-card/50 shadow-sm">
                <div className="flex items-center gap-1.5">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">文件列表</h3>
                </div>
                <div
                  data-testid="skills-tree-panel"
                  className="min-h-0 flex-1 overflow-auto rounded-lg border bg-background/80 p-3 [&_[data-node-path]]:min-h-10 [&_[data-node-path]]:text-sm [&_[data-node-path]]:py-2 [&_[data-node-path]_.font-mono]:text-sm"
                >
                  {treeLoading ? (
                    <div className="p-3 text-sm text-muted-foreground">加载文件树中...</div>
                  ) : (
                    <SkillTree
                      nodes={tree}
                      selectedPath={selectedPath}
                      editable={isAdmin}
                      onSelect={handleNodeSelect}
                      onOpen={(node) => void handleNodeOpen(node)}
                      onRename={async (fromPath, toPath) => {
                        await handleMoveEntry(fromPath, toPath);
                      }}
                      onCreate={async (parentPath, type, name) => {
                        await handleCreateEntry(parentPath, type, name);
                      }}
                      onMove={async (fromPath, toPath) => {
                        await handleMoveEntry(fromPath, toPath);
                      }}
                    />
                  )}
                </div>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => void handleDeleteSelected()}
                    disabled={!selectedPath || isMutatingFs}
                    className="app-control mt-1 flex w-full items-center justify-center gap-2 rounded-xl border border-red-200/50 px-4 text-sm font-medium text-red-500 transition-all hover:bg-red-500/10 disabled:opacity-50"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                    删除当前节点
                  </button>
                )}
              </section>

              <section className="app-card-pad min-h-0 rounded-xl border bg-card/50 shadow-sm">
                {selectedNode?.type === "directory" ? (
                  <div className="flex h-full flex-col items-center justify-center rounded-xl border border-dashed bg-muted/20 p-8 text-center">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="mb-4 text-muted-foreground/40">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                    </svg>
                    <p className="text-base font-medium text-muted-foreground">{selectedNode.path}</p>
                    <p className="app-caption mt-2 text-muted-foreground/60">双击目录可打开该目录下的 SKILL.md</p>
                  </div>
                ) : (
                  <div className="[&_textarea]:p-4 [&_textarea]:text-[15px] [&_textarea]:leading-6 [&_.prose]:text-[15px] [&_.prose]:leading-7 [&_pre]:text-sm [&_[class*='text-xs']]:text-sm">
                    <SkillFileEditor
                      path={selectedPath}
                      content={fileContent}
                      editable={selectedEditable}
                      readOnly={!isAdmin}
                      isDirty={isDirty}
                      isSaving={isSaving}
                      error={fileError}
                      onChange={setFileContent}
                      onSave={() => void handleSave()}
                    />
                  </div>
                )}
              </section>
            </div>
          </aside>
        </>
      )}

      <ZipUploadDialog
        open={showUploadDialog}
        onClose={() => setShowUploadDialog(false)}
        onUpload={handleUploadZip}
      />

      <DeleteSkillDialog
        open={showDeleteDialog}
        skillName={activeSkill ?? ""}
        onConfirm={() => void handleDeleteSkill()}
        onCancel={() => setShowDeleteDialog(false)}
      />

      <ConfirmDialog
        open={confirmClose}
        title="有未保存修改"
        message="当前有未保存修改，确认退出吗？"
        confirmLabel="退出"
        cancelLabel="取消"
        onConfirm={() => {
          setConfirmClose(false);
          setDrawerOpen(false);
          setActiveSkill(null);
          setTree([]);
          resetEditorState();
        }}
        onCancel={() => setConfirmClose(false)}
      />

      <ConfirmDialog
        open={confirmSwitch}
        title="有未保存修改"
        message="当前有未保存修改，确认切换技能吗？"
        confirmLabel="切换"
        cancelLabel="取消"
        onConfirm={() => {
          setConfirmSwitch(false);
          const skillName = pendingSwitchSkill;
          setPendingSwitchSkill(null);
          if (skillName) {
            setError("");
            setDrawerOpen(true);
            setActiveSkill(skillName);
            resetEditorState();
            void loadSkillTree(skillName);
            void loadFile(`${skillName}/SKILL.md`);
          }
        }}
        onCancel={() => {
          setConfirmSwitch(false);
          setPendingSwitchSkill(null);
        }}
      />

      <ConfirmDialog
        open={confirmDelete}
        title="确认删除"
        message={`确认删除 ${selectedPath} 吗？`}
        confirmLabel="删除"
        cancelLabel="取消"
        destructive
        onConfirm={() => {
          setConfirmDelete(false);
          setError("");
          setIsMutatingFs(true);
          void (async () => {
            try {
              const res = await fetch(`/api/skills/fs?path=${encodeURIComponent(selectedPath ?? '')}`, {
                method: "DELETE",
                headers: authHeaders,
              });
              if (res.status === 401 || res.status === 403) {
                await handleUnauthorized();
                return;
              }
              if (!res.ok) {
                const payload = await res.json().catch(() => ({}));
                throw new Error(payload.error || "删除失败");
              }
              setSelectedPath(null);
              resetEditorState();
              await loadSkillsList();
            } catch (err) {
              setError(err instanceof Error ? err.message : "删除失败");
            } finally {
              setIsMutatingFs(false);
            }
          })();
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
