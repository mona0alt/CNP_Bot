import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import type { SkillCatalogItem } from "@/lib/types";
import { SkillMarkdownPreview } from "@/components/skills/SkillMarkdownPreview";

function extractSummary(content: string | null | undefined): string {
  if (!content) return '';
  const lines = content.split('\n').filter(l => l.trim().length > 0).slice(0, 3);
  const text = lines.join(' ').trim();
  return text.length > 150 ? text.slice(0, 147) + '...' : text;
}

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
      const rawSkills: SkillCatalogItem[] = Array.isArray(data) ? data : [];

      // 并行预抓取每个 skill 的 SKILL.md 概要
      const summaryPromises = rawSkills.map(skill =>
        fetch(`/api/skills/catalog/file?path=${encodeURIComponent(skill.name + '/SKILL.md')}`, { headers: authHeaders })
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
    return <div className="p-5">加载技能目录中...</div>;
  }

  return (
    <div className="h-full overflow-y-auto bg-background px-4 py-4 lg:px-5 lg:py-5">
      <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-4">
        <div className="rounded-2xl border bg-card/60 px-5 py-5 backdrop-blur-sm">
          <h1 className="text-2xl font-semibold tracking-tight">技能目录</h1>
          <p className="app-caption mt-1 text-muted-foreground">只读浏览全局技能库，可用于会话技能选择</p>
        </div>

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </div>
        )}

        {skills.length === 0 ? (
          <div className="rounded-md border border-dashed p-5 text-sm text-muted-foreground">暂无可用技能</div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {skills.map((skill) => (
              <div
                key={skill.name}
                className="[&_article]:rounded-xl [&_article]:p-5 [&_h3]:text-lg [&_pre]:text-sm [&_pre]:leading-7 [&_p]:text-sm"
              >
                <SkillMarkdownPreview
                  title={`${skill.name} · ${new Date(skill.updated_at).toLocaleString()}`}
                  content={skill.summary ? `# ${skill.name}\n\n${skill.summary}` : `# ${skill.name}\n\n暂无概要`}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
