import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Save } from "lucide-react";

import { ConfigForm } from "@/components/settings/ConfigForm";
import { ConfigSectionNav } from "@/components/settings/ConfigSectionNav";
import { useAuth } from "@/contexts/AuthContext";

type SystemConfigOption = { label: string; value: string };

type SystemConfigField = {
  key: string;
  section: string;
  label: string;
  type: "text" | "number" | "toggle" | "select" | "secret";
  required: boolean;
  secret: boolean;
  restartRequired: boolean;
  defaultValue?: string;
  options?: Array<SystemConfigOption> | string[];
  dangerLevel?: "normal" | "warning" | "danger";
  dangerMessage?: string;
};

type SystemConfigSection = {
  id: string;
  title: string;
  fields: SystemConfigField[];
};

type SystemConfigResponse = {
  sections?: SystemConfigSection[];
  values?: Record<string, unknown>;
  restart?: unknown;
  pendingRestart?: boolean;
  error?: string;
};

function toStringValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function normalizeSections(sections: SystemConfigSection[]): SystemConfigSection[] {
  return sections.map((section) => ({
    ...section,
    fields: Array.isArray(section.fields) ? section.fields.map((field) => ({ ...field })) : [],
  }));
}

function buildValuesMap(sections: SystemConfigSection[], values: Record<string, unknown> | undefined) {
  const nextValues: Record<string, string> = {};
  for (const section of sections) {
    for (const field of section.fields) {
      nextValues[field.key] = toStringValue(values?.[field.key]);
    }
  }
  return nextValues;
}

export function Settings() {
  const { token, logout } = useAuth();
  const [sections, setSections] = useState<SystemConfigSection[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [activeSectionId, setActiveSectionId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  const authHeaders = useMemo<HeadersInit | undefined>(() => {
    if (!token) return undefined;
    return { Authorization: `Bearer ${token}` };
  }, [token]);

  const totalFields = useMemo(
    () => sections.reduce((count, section) => count + section.fields.length, 0),
    [sections],
  );

  const handleUnauthorized = useCallback(async () => {
    await logout();
    window.location.href = "/login";
  }, [logout]);

  const loadSystemConfig = useCallback(async () => {
    if (!token) {
      setError("未登录");
      setIsLoading(false);
      return;
    }

    setError("");
    setIsLoading(true);
    try {
      const response = await fetch("/api/system-config", {
        headers: authHeaders,
      });

      if (response.status === 401 || response.status === 403) {
        await handleUnauthorized();
        return;
      }

      const payload = (await response.json().catch(() => ({}))) as SystemConfigResponse;
      if (!response.ok) {
        throw new Error(payload.error || "加载系统配置失败");
      }

      const nextSections = normalizeSections(Array.isArray(payload.sections) ? payload.sections : []);
      setSections(nextSections);
      setValues(buildValuesMap(nextSections, payload.values));
      setActiveSectionId((current) => current || nextSections[0]?.id || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载系统配置失败");
    } finally {
      setIsLoading(false);
    }
  }, [authHeaders, handleUnauthorized, token]);

  useEffect(() => {
    void loadSystemConfig();
  }, [loadSystemConfig]);

  const handleFieldChange = useCallback((key: string, value: string) => {
    setValues((current) => ({
      ...current,
      [key]: value,
    }));
  }, []);

  const handleSectionSelect = useCallback((sectionId: string) => {
    setActiveSectionId(sectionId);
    const target = document.getElementById(`system-config-section-${sectionId}`);
    if (target && typeof target.scrollIntoView === "function") {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  const handleSave = useCallback(async () => {
    if (!token) {
      setError("未登录");
      return;
    }

    setError("");
    setIsSaving(true);
    try {
      const response = await fetch("/api/system-config", {
        method: "PUT",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ values }),
      });

      if (response.status === 401 || response.status === 403) {
        await handleUnauthorized();
        return;
      }

      const payload = (await response.json().catch(() => ({}))) as SystemConfigResponse;
      if (!response.ok) {
        throw new Error(payload.error || "保存系统配置失败");
      }

      const nextSections = Array.isArray(payload.sections) && payload.sections.length > 0
        ? normalizeSections(payload.sections)
        : sections;
      setSections(nextSections);
      setValues(buildValuesMap(nextSections, payload.values ?? values));
      setActiveSectionId((current) => {
        if (current && nextSections.some((section) => section.id === current)) {
          return current;
        }
        return nextSections[0]?.id || "";
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存系统配置失败");
    } finally {
      setIsSaving(false);
    }
  }, [authHeaders, handleUnauthorized, sections, token, values]);

  if (isLoading) {
    return (
      <div className="h-full min-h-0 overflow-y-auto bg-background px-4 py-4 lg:px-5 lg:py-5">
        <div className="mx-auto flex w-full max-w-[1680px] items-center justify-center rounded-2xl border bg-card/60 px-5 py-16 text-sm text-muted-foreground">
          加载系统配置中...
        </div>
      </div>
    );
  }

  const currentSection = sections.find((section) => section.id === activeSectionId) ?? sections[0];

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-background px-4 py-4 lg:px-5 lg:py-5">
      <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-4">
        <div className="rounded-2xl border bg-card/60 px-5 py-5 backdrop-blur-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="font-brand text-2xl font-semibold tracking-tight">系统设置</h1>
              <p className="app-caption mt-1 text-muted-foreground">
                按 schema 分组加载真实配置项，编辑后直接保存到系统配置。
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={isSaving || sections.length === 0}
              className="app-control inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {isSaving ? "保存中..." : "保存配置"}
            </button>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
            <span className="rounded-full bg-muted/50 px-2.5 py-1">分组 {sections.length}</span>
            <span className="rounded-full bg-muted/50 px-2.5 py-1">字段 {totalFields}</span>
            {currentSection ? (
              <span className="rounded-full bg-muted/50 px-2.5 py-1">当前 {currentSection.title}</span>
            ) : null}
          </div>
        </div>

        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-600">
            {error}
          </div>
        ) : null}

        <div className="grid min-h-0 gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
          <ConfigSectionNav
            sections={sections}
            activeSectionId={activeSectionId}
            onSectionSelect={handleSectionSelect}
            className="sticky top-4 self-start"
          />

          <div className="min-h-0 rounded-2xl border bg-card/50 p-2 shadow-sm">
            <ConfigForm
              sections={sections}
              values={values}
              onFieldChange={handleFieldChange}
              activeSectionId={activeSectionId}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
