import { useEffect, useMemo, useState } from "react";
import type { ChatSkillSelectionResponse, SkillCatalogItem } from "@/lib/types";

interface ChatSkillsDialogProps {
  open: boolean;
  mode: "create" | "edit";
  apiBase: string;
  authHeaders?: HeadersInit;
  chatJid?: string | null;
  agentType?: "claude" | "deepagent";
  onClose: () => void;
  onUnauthorized: () => Promise<void>;
  onCreate: (skills: string[]) => Promise<void>;
  onUpdated: (state: ChatSkillSelectionResponse) => void;
}

export function ChatSkillsDialog({
  open,
  mode,
  apiBase,
  authHeaders,
  chatJid,
  agentType,
  onClose,
  onUnauthorized,
  onCreate,
  onUpdated,
}: ChatSkillsDialogProps) {
  const [catalog, setCatalog] = useState<SkillCatalogItem[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const previewSkill = selected[0] ?? null;

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setError("");
    setIsLoading(true);

    const load = async () => {
      try {
        const catalogRes = await fetch(`${apiBase}/api/skills/catalog`, {
          headers: authHeaders,
        });
        if (catalogRes.status === 401 || catalogRes.status === 403) {
          await onUnauthorized();
          return;
        }
        if (!catalogRes.ok) {
          throw new Error("加载技能目录失败");
        }
        const catalogData = await catalogRes.json();
        if (cancelled) return;
        const normalizedCatalog = Array.isArray(catalogData) ? catalogData : [];
        setCatalog(normalizedCatalog);

        if (mode === "edit" && chatJid) {
          const currentRes = await fetch(`${apiBase}/api/chats/${encodeURIComponent(chatJid)}/skills`, {
            headers: authHeaders,
          });
          if (currentRes.status === 401 || currentRes.status === 403) {
            await onUnauthorized();
            return;
          }
          if (!currentRes.ok) {
            throw new Error("加载会话技能失败");
          }
          const currentData = await currentRes.json();
          if (cancelled) return;
          setSelected(Array.isArray(currentData.selectedSkills) ? currentData.selectedSkills : []);
          onUpdated({
            selectedSkills: Array.isArray(currentData.selectedSkills) ? currentData.selectedSkills : [],
            syncStatus: currentData.syncStatus ?? "pending",
            lastSyncedAt: currentData.lastSyncedAt ?? null,
            errorMessage: currentData.errorMessage ?? null,
          });
        } else {
          setSelected([]);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "加载技能失败");
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [apiBase, authHeaders, chatJid, mode, onUnauthorized, open]);

  if (!open) return null;

  const toggleSkill = (skillName: string) => {
    setSelected((prev) => {
      if (prev.includes(skillName)) {
        return prev.filter((name) => name !== skillName);
      }
      return [...prev, skillName];
    });
  };

  const handleSubmit = async () => {
    setError("");
    setIsSubmitting(true);
    try {
      const normalizedSkills = [...new Set(selected)].sort((a, b) => a.localeCompare(b));
      if (mode === "create") {
        await onCreate(normalizedSkills);
        onClose();
        return;
      }
      if (!chatJid) {
        throw new Error("缺少会话标识");
      }
      const res = await fetch(`${apiBase}/api/chats/${encodeURIComponent(chatJid)}/skills`, {
        method: "PUT",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ skills: normalizedSkills }),
      });
      if (res.status === 401 || res.status === 403) {
        await onUnauthorized();
        return;
      }
      if (!res.ok) {
        const payload = await res.json().catch(() => ({ error: "保存会话技能失败" }));
        throw new Error(payload.error || "保存会话技能失败");
      }
      const data = await res.json();
      onUpdated({
        selectedSkills: Array.isArray(data.selectedSkills) ? data.selectedSkills : normalizedSkills,
        syncStatus: data.syncStatus ?? "pending",
        lastSyncedAt: data.lastSyncedAt ?? null,
        errorMessage: data.errorMessage ?? null,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45">
      <div className="w-full max-w-3xl rounded-xl bg-background p-5 shadow-lg">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {mode === "create" ? "创建会话并选择 Skills" : "会话 Skills 设置"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border px-2 py-1 text-sm hover:bg-muted"
          >
            关闭
          </button>
        </div>

        {agentType && mode === "create" && (
          <p className="mt-2 text-sm text-muted-foreground">Agent 类型：{agentType === "deepagent" ? "Deep Agent" : "Claude Agent"}</p>
        )}

        {error && (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </div>
        )}

        <div className="mt-4 grid gap-4 md:grid-cols-[1fr_260px]">
          <div className="rounded-md border p-3">
            <p className="mb-2 text-sm font-medium">可选技能</p>
            {isLoading ? (
              <p className="text-sm text-muted-foreground">加载中...</p>
            ) : catalog.length ? (
              <ul className="max-h-[320px] space-y-1 overflow-auto">
                {catalog.map((skill) => (
                  <li key={skill.name} className="rounded-md border px-2 py-1.5">
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={selectedSet.has(skill.name)}
                        onChange={() => toggleSkill(skill.name)}
                      />
                      <span className="font-medium">{skill.name}</span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">暂无可用技能</p>
            )}
          </div>

          <div className="rounded-md border p-3">
            <p className="text-sm font-medium">预览</p>
            {previewSkill ? (
              <div className="mt-2 space-y-2 text-sm">
                <p className="font-medium">{previewSkill}</p>
                <p className="text-muted-foreground">该技能已选中，保存后会用于当前会话。</p>
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">未选择技能，可直接创建/保存为空列表。</p>
            )}
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          {mode === "create" && (
            <button
              type="button"
              onClick={async () => {
                await onCreate([]);
                onClose();
              }}
              className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
            >
              无 Skills 创建
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={isSubmitting}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting
              ? "提交中..."
              : mode === "create"
                ? "创建会话"
                : "保存技能"}
          </button>
        </div>
      </div>
    </div>
  );
}
