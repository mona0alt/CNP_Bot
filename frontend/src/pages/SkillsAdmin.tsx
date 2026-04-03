import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import type { SkillCatalogItem, SkillTreeNode } from "@/lib/types";
import { SkillTree } from "@/components/skills/SkillTree";
import { SkillFileEditor } from "@/components/skills/SkillFileEditor";
import { ZipUploadDialog } from "@/components/skills/ZipUploadDialog";

function getParentPath(targetPath: string): string {
  const parts = targetPath.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

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

export function SkillsAdmin() {
  const { token, logout } = useAuth();
  const [skills, setSkills] = useState<SkillCatalogItem[]>([]);
  const [tree, setTree] = useState<SkillTreeNode[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState("");
  const [originContent, setOriginContent] = useState("");
  const [selectedEditable, setSelectedEditable] = useState(false);
  const [fileError, setFileError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isMutatingFs, setIsMutatingFs] = useState(false);
  const [entryName, setEntryName] = useState("");
  const [showUploadDialog, setShowUploadDialog] = useState(false);

  const authHeaders = useMemo<HeadersInit | undefined>(() => {
    if (!token) return undefined;
    return { Authorization: `Bearer ${token}` };
  }, [token]);

  const isDirty = selectedEditable && fileContent !== originContent;
  const nodeMap = useMemo(() => {
    const allNodes = flattenTree(tree);
    const map = new Map<string, SkillTreeNode>();
    for (const node of allNodes) map.set(node.path, node);
    return map;
  }, [tree]);
  const selectedNode = selectedPath ? nodeMap.get(selectedPath) ?? null : null;

  const handleUnauthorized = useCallback(async () => {
    await logout();
    window.location.href = "/login";
  }, [logout]);

  const loadAdminData = useCallback(async () => {
    if (!token) return;

    setError("");
    try {
      const [skillsRes, treeRes] = await Promise.all([
        fetch("/api/skills", { headers: authHeaders }),
        fetch("/api/skills/tree", { headers: authHeaders }),
      ]);
      if (skillsRes.status === 401 || skillsRes.status === 403 || treeRes.status === 401 || treeRes.status === 403) {
        await handleUnauthorized();
        return;
      }
      if (!skillsRes.ok || !treeRes.ok) {
        throw new Error("加载技能目录失败");
      }
      const [skillsData, treeData] = await Promise.all([skillsRes.json(), treeRes.json()]);
      setSkills(Array.isArray(skillsData) ? skillsData : []);
      setTree(Array.isArray(treeData) ? treeData : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载技能目录失败");
    } finally {
      setIsLoading(false);
    }
  }, [authHeaders, handleUnauthorized, token]);

  useEffect(() => {
    void loadAdminData();
  }, [loadAdminData]);

  const loadFile = useCallback(
    async (path: string) => {
      if (!token) return;
      setFileError("");
      try {
        const res = await fetch(`/api/skills/file?path=${encodeURIComponent(path)}`, {
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
      } catch (err) {
        setFileError(err instanceof Error ? err.message : "读取文件失败");
      }
    },
    [authHeaders, handleUnauthorized, token],
  );

  const handleNodeSelect = useCallback(
    async (node: SkillTreeNode) => {
      if (selectedPath === node.path) return;
      if (isDirty && !window.confirm("当前文件有未保存改动，确认切换吗？")) {
        return;
      }
      if (node.type === "directory") {
        setSelectedPath(node.path);
        setFileContent("");
        setOriginContent("");
        setSelectedEditable(false);
        setFileError("");
        return;
      }
      await loadFile(node.path);
    },
    [isDirty, loadFile, selectedPath],
  );

  const handleSave = useCallback(async () => {
    if (!token || !selectedPath || !selectedEditable) return;
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
        return;
      }
      if (!res.ok) {
        const payload = await res.json().catch(() => ({ error: "保存失败" }));
        throw new Error(payload.error || "保存失败");
      }
      setOriginContent(fileContent);
    } catch (err) {
      setFileError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setIsSaving(false);
    }
  }, [authHeaders, fileContent, handleUnauthorized, selectedEditable, selectedPath, token]);

  const handleCreateEntry = useCallback(
    async (type: "file" | "directory") => {
      if (!token) return;
      const name = entryName.trim();
      if (!name) {
        setError("请输入名称");
        return;
      }
      setError("");
      setIsMutatingFs(true);
      try {
        const parentPath = selectedNode
          ? selectedNode.type === "directory"
            ? selectedNode.path
            : getParentPath(selectedNode.path)
          : "";
        const res = await fetch("/api/skills/fs", {
          method: "POST",
          headers: { ...authHeaders, "Content-Type": "application/json" },
          body: JSON.stringify({ parentPath, name, type }),
        });
        if (res.status === 401 || res.status === 403) {
          await handleUnauthorized();
          return;
        }
        if (!res.ok) {
          const payload = await res.json().catch(() => ({ error: "创建失败" }));
          throw new Error(payload.error || "创建失败");
        }
        setEntryName("");
        await loadAdminData();
      } catch (err) {
        setError(err instanceof Error ? err.message : "创建失败");
      } finally {
        setIsMutatingFs(false);
      }
    },
    [authHeaders, entryName, handleUnauthorized, loadAdminData, selectedNode, token],
  );

  const handleRename = useCallback(async () => {
    if (!token || !selectedPath) return;
    const nextPath = window.prompt("请输入新路径", selectedPath)?.trim();
    if (!nextPath || nextPath === selectedPath) return;

    setError("");
    setIsMutatingFs(true);
    try {
      const res = await fetch("/api/skills/fs", {
        method: "PATCH",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ fromPath: selectedPath, toPath: nextPath }),
      });
      if (res.status === 401 || res.status === 403) {
        await handleUnauthorized();
        return;
      }
      if (!res.ok) {
        const payload = await res.json().catch(() => ({ error: "重命名失败" }));
        throw new Error(payload.error || "重命名失败");
      }
      setSelectedPath(null);
      setFileContent("");
      setOriginContent("");
      setSelectedEditable(false);
      await loadAdminData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "重命名失败");
    } finally {
      setIsMutatingFs(false);
    }
  }, [authHeaders, handleUnauthorized, loadAdminData, selectedPath, token]);

  const handleDelete = useCallback(async () => {
    if (!token || !selectedPath) return;
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
      setSelectedPath(null);
      setFileContent("");
      setOriginContent("");
      setSelectedEditable(false);
      await loadAdminData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    } finally {
      setIsMutatingFs(false);
    }
  }, [authHeaders, handleUnauthorized, loadAdminData, selectedPath, token]);

  const handleUploadZip = useCallback(
    async (file: File) => {
      if (!token) return;
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
      await loadAdminData();
    },
    [authHeaders, handleUnauthorized, loadAdminData, token],
  );

  if (isLoading) {
    return <div className="p-6">加载技能目录中...</div>;
  }

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">技能管理</h1>
          <p className="text-sm text-muted-foreground">全局技能库文件系统管理</p>
        </div>
        <button
          type="button"
          onClick={() => setShowUploadDialog(true)}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          上传 ZIP
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <section className="space-y-4 rounded-lg border bg-card p-4">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">可用 Skills</h2>
            <ul className="mt-2 space-y-1 text-sm">
              {skills.length ? (
                skills.map((skill) => (
                  <li key={skill.name} className="flex items-center justify-between rounded-md border px-2 py-1.5">
                    <span className="font-medium">{skill.name}</span>
                    <span className="text-xs text-muted-foreground">{new Date(skill.updated_at).toLocaleString()}</span>
                  </li>
                ))
              ) : (
                <li className="rounded-md border border-dashed px-2 py-2 text-muted-foreground">暂无 skill</li>
              )}
            </ul>
          </div>

          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">目录树</h2>
            <div className="mt-2 max-h-[460px] overflow-auto rounded-md border p-2">
              <SkillTree nodes={tree} selectedPath={selectedPath} onSelect={(node) => void handleNodeSelect(node)} />
            </div>
          </div>

          <div className="space-y-2 rounded-md border p-3">
            <p className="text-sm font-medium">文件操作</p>
            <input
              type="text"
              placeholder="名称，如 README.md"
              value={entryName}
              onChange={(event) => setEntryName(event.target.value)}
              className="w-full rounded-md border px-2 py-1.5 text-sm"
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleCreateEntry("file")}
                disabled={isMutatingFs}
                className="rounded-md border px-2 py-1 text-sm hover:bg-muted disabled:opacity-60"
              >
                新建文件
              </button>
              <button
                type="button"
                onClick={() => void handleCreateEntry("directory")}
                disabled={isMutatingFs}
                className="rounded-md border px-2 py-1 text-sm hover:bg-muted disabled:opacity-60"
              >
                新建目录
              </button>
              <button
                type="button"
                onClick={() => void handleRename()}
                disabled={!selectedPath || isMutatingFs}
                className="rounded-md border px-2 py-1 text-sm hover:bg-muted disabled:opacity-60"
              >
                重命名/移动
              </button>
              <button
                type="button"
                onClick={() => void handleDelete()}
                disabled={!selectedPath || isMutatingFs}
                className="rounded-md border px-2 py-1 text-sm text-red-600 hover:bg-red-50 disabled:opacity-60"
              >
                删除
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-lg border bg-card p-4">
          {selectedNode?.type === "directory" ? (
            <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
              当前选中目录：<span className="font-mono">{selectedNode.path}</span>
            </div>
          ) : (
            <SkillFileEditor
              path={selectedPath}
              content={fileContent}
              editable={selectedEditable}
              isDirty={isDirty}
              isSaving={isSaving}
              error={fileError}
              onChange={setFileContent}
              onSave={() => void handleSave()}
            />
          )}
        </section>
      </div>

      <ZipUploadDialog
        open={showUploadDialog}
        onClose={() => setShowUploadDialog(false)}
        onUpload={handleUploadZip}
      />
    </div>
  );
}
