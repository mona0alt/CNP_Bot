import { useCallback, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";

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
    setSkills(Array.isArray(data) ? data : []);
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
    if (!allowDirtyDiscard && isDirty && !window.confirm("有未保存修改，确认退出吗？")) {
      return;
    }
    setDrawerOpen(false);
    setActiveSkill(null);
    setTree([]);
    resetEditorState();
  };

  const handleOpenSkill = useCallback(
    async (skillName: string) => {
      if (isDirty && !window.confirm("当前有未保存修改，确认切换技能吗？")) {
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
    if (!window.confirm(`确认删除 ${selectedPath} 吗？`)) return;
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

  const handleNodeSelect = (node: SkillTreeNode) => {
    setSelectedPath(node.path);
    if (node.type === "directory") {
      setFileContent("");
      setOriginContent("");
      setSelectedEditable(false);
      setFileError("");
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
    <div className="relative h-full overflow-y-auto p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">技能</h1>
          <p className="text-sm text-muted-foreground">
            双击技能进入详情侧栏，{isAdmin ? "可进行增删改查" : "普通用户仅可查看文件列表与内容"}
          </p>
        </div>
        {isAdmin && (
          <button
            type="button"
            onClick={() => setShowUploadDialog(true)}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            上传 ZIP
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </div>
      )}

      {skills.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          当前没有可用技能
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {skills.map((skill) => (
            <button
              key={skill.name}
              type="button"
              data-testid={`skill-card-${skill.name}`}
              onDoubleClick={() => void handleOpenSkill(skill.name)}
              className={`cursor-pointer rounded-lg border p-4 text-left transition-colors ${
                activeSkill === skill.name ? "border-primary bg-primary/5" : "hover:bg-muted/70"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{skill.name}</span>
                <span className="text-xs text-muted-foreground">
                  {new Date(skill.updated_at).toLocaleDateString()}
                </span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                双击进入技能详情
              </p>
            </button>
          ))}
        </div>
      )}

      {drawerOpen && (
        <>
          <button
            type="button"
            aria-label="close-skill-drawer-backdrop"
            className="fixed inset-0 z-40 bg-black/20"
            onClick={() => closeDrawer(false)}
          />
          <aside className="fixed inset-y-0 right-0 z-50 flex h-screen w-full flex-col border-l bg-background shadow-2xl lg:w-[calc(100vw-72px)]">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div>
                <h2 className="text-lg font-semibold">技能详情 · {activeSkill}</h2>
                <p className="text-xs text-muted-foreground">
                  {isAdmin ? "管理员模式：可编辑" : "只读模式"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => void handleSaveAndClose()}
                    disabled={isSaving}
                    className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
                  >
                    保存并退出
                  </button>
                )}
                <button
                  type="button"
                  data-testid="skill-drawer-exit"
                  onClick={() => closeDrawer(false)}
                  className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
                >
                  退出
                </button>
                <button
                  type="button"
                  aria-label="关闭技能详情"
                  onClick={() => closeDrawer(false)}
                  className="rounded-md border p-1.5 hover:bg-muted"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className="grid min-h-0 flex-1 gap-4 p-4 lg:grid-cols-[380px_minmax(0,1fr)]">
              <section className="flex min-h-0 flex-col gap-3 rounded-lg border bg-card p-3">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">文件列表</h3>
                <div className="min-h-0 flex-1 overflow-auto rounded-md border p-2">
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
                    className="rounded-md border px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-60"
                  >
                    删除当前节点
                  </button>
                )}
              </section>

              <section className="min-h-0 rounded-lg border bg-card p-3">
                {selectedNode?.type === "directory" ? (
                  <div className="h-full rounded-md border border-dashed p-6 text-sm text-muted-foreground">
                    当前选中目录：<span className="font-mono">{selectedNode.path}</span>
                    <p className="mt-2">双击目录可尝试打开该目录下的 SKILL.md。</p>
                  </div>
                ) : (
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
    </div>
  );
}
