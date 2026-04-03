import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import type { SkillCatalogItem } from "@/lib/types";
import { SkillMarkdownPreview } from "@/components/skills/SkillMarkdownPreview";

export function SkillsCatalog() {
  const { token, logout } = useAuth();
  const [skills, setSkills] = useState<SkillCatalogItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const authHeaders = useMemo<HeadersInit | undefined>(() => {
    if (!token) return undefined;
    return { Authorization: `Bearer ${token}` };
  }, [token]);

  const handleUnauthorized = useCallback(async () => {
    await logout();
    window.location.href = "/login";
  }, [logout]);

  const loadCatalog = useCallback(async () => {
    if (!token) return;

    setError("");
    try {
      const res = await fetch("/api/skills/catalog", { headers: authHeaders });
      if (res.status === 401 || res.status === 403) {
        await handleUnauthorized();
        return;
      }
      if (!res.ok) {
        throw new Error("加载技能目录失败");
      }
      const data = await res.json();
      setSkills(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载技能目录失败");
    } finally {
      setIsLoading(false);
    }
  }, [authHeaders, handleUnauthorized, token]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  if (isLoading) {
    return <div className="p-6">加载技能目录中...</div>;
  }

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-2xl font-semibold">技能目录</h1>
        <p className="text-sm text-muted-foreground">只读浏览全局技能库，可用于会话技能选择</p>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </div>
      )}

      {skills.length === 0 ? (
        <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">暂无可用技能</div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {skills.map((skill) => (
            <SkillMarkdownPreview
              key={skill.name}
              title={`${skill.name} · ${new Date(skill.updated_at).toLocaleString()}`}
              content={`# ${skill.name}\n\n- 包含 SKILL.md: ${skill.has_skill_md ? "是" : "否"}\n- 仅支持只读浏览\n- 可在会话创建和会话设置中启用`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
