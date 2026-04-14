import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, RotateCcw, Save } from "lucide-react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ConfigForm } from "@/components/settings/ConfigForm";
import { ConfigSectionNav } from "@/components/settings/ConfigSectionNav";
import { RestartBanner } from "@/components/settings/RestartBanner";
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
  canCopySecret?: boolean;
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
  restart?: RestartRuntimeInfo;
  pendingRestart?: boolean;
  changedKeys?: string[];
  restartRequired?: boolean;
  success?: boolean;
  error?: string;
};

type RestartRuntimeInfo = {
  manager: "launchd" | "systemd-user" | "systemd-system" | "nohup" | "unsupported";
  status: "running" | "stopped" | "unknown";
  canRestart: boolean;
};

type RestartStatusValue = "idle" | "requested" | "stopping" | "starting" | "healthy" | "failed";

type RestartStatusResponse = {
  status: RestartStatusValue;
  message?: string | null;
  error?: string;
};

type SubmitMode = "save" | "saveAndRestart";

function isRestartPending(status: RestartStatusValue): boolean {
  return status === "requested" || status === "stopping" || status === "starting";
}

function normalizeRestartInfo(value: unknown): RestartRuntimeInfo | null {
  if (!value || typeof value !== "object") return null;

  const candidate = value as Partial<RestartRuntimeInfo>;
  if (
    (candidate.manager === "launchd" ||
      candidate.manager === "systemd-user" ||
      candidate.manager === "systemd-system" ||
      candidate.manager === "nohup" ||
      candidate.manager === "unsupported") &&
    (candidate.status === "running" ||
      candidate.status === "stopped" ||
      candidate.status === "unknown") &&
    typeof candidate.canRestart === "boolean"
  ) {
    return candidate as RestartRuntimeInfo;
  }

  return null;
}

function normalizeRestartStatus(value: unknown): RestartStatusResponse {
  if (!value || typeof value !== "object") {
    return { status: "idle", message: null };
  }

  const candidate = value as Partial<RestartStatusResponse>;
  if (
    candidate.status === "idle" ||
    candidate.status === "requested" ||
    candidate.status === "stopping" ||
    candidate.status === "starting" ||
    candidate.status === "healthy" ||
    candidate.status === "failed"
  ) {
    return {
      status: candidate.status,
      message: typeof candidate.message === "string" ? candidate.message : null,
    };
  }

  return { status: "idle", message: null };
}

function normalizeFailureMessage(message?: string | null): string {
  if (!message) {
    return "服务重启失败";
  }

  if (message === "restart_command_failed") {
    return "重启命令执行失败";
  }

  if (message === "unsupported_restart_manager") {
    return "当前环境不支持自动重启";
  }

  return message;
}

function toStringValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function normalizeSections(sections: SystemConfigSection[], canCopySecret: boolean): SystemConfigSection[] {
  return sections.map((section) => ({
    ...section,
    fields: Array.isArray(section.fields)
      ? section.fields.map((field) => ({
          ...field,
          canCopySecret: field.secret || field.type === "secret" ? canCopySecret : field.canCopySecret,
        }))
      : [],
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

function pickPreferredSectionId(
  sections: SystemConfigSection[],
  currentSectionId?: string,
): string {
  if (currentSectionId && sections.some((section) => section.id === currentSectionId)) {
    return currentSectionId;
  }

  const preferredAgentSection = sections.find((section) => section.id === "agent");
  if (preferredAgentSection) {
    return preferredAgentSection.id;
  }

  const firstVisibleSection = sections.find((section) =>
    section.fields.some((field) => !(field.secret || field.type === "secret")),
  );
  if (firstVisibleSection) {
    return firstVisibleSection.id;
  }

  return sections[0]?.id || "";
}

export function Settings() {
  const { token, logout, user } = useAuth();
  const canCopySecret = user?.role === "admin";
  const [sections, setSections] = useState<SystemConfigSection[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [savedValues, setSavedValues] = useState<Record<string, string>>({});
  const [activeSectionId, setActiveSectionId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [confirmMode, setConfirmMode] = useState<SubmitMode | null>(null);
  const [error, setError] = useState("");
  const [restartInfo, setRestartInfo] = useState<RestartRuntimeInfo | null>(null);
  const [restartStatus, setRestartStatus] = useState<RestartStatusResponse>({
    status: "idle",
    message: null,
  });
  const [pendingRestart, setPendingRestart] = useState(false);
  const restartPollTimeoutRef = useRef<number | null>(null);

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

  const clearRestartPoll = useCallback(() => {
    if (restartPollTimeoutRef.current !== null) {
      window.clearTimeout(restartPollTimeoutRef.current);
      restartPollTimeoutRef.current = null;
    }
  }, []);

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

      const nextSections = normalizeSections(Array.isArray(payload.sections) ? payload.sections : [], canCopySecret);
      const nextValues = buildValuesMap(nextSections, payload.values);
      const nextRestartInfo = normalizeRestartInfo(payload.restart);
      const nextPendingRestart = payload.pendingRestart === true;
      setSections(nextSections);
      setValues(nextValues);
      setSavedValues(nextValues);
      setRestartInfo(nextRestartInfo);
      setPendingRestart(nextPendingRestart);
      setRestartStatus((current) => {
        if (nextPendingRestart) {
          return isRestartPending(current.status) || current.status === "failed" || current.status === "healthy"
            ? current
            : { status: "requested", message: null };
        }
        if (current.status === "failed" || current.status === "healthy") {
          return current;
        }
        return { status: "idle", message: null };
      });
      setActiveSectionId((current) => pickPreferredSectionId(nextSections, current));
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载系统配置失败");
    } finally {
      setIsLoading(false);
    }
  }, [authHeaders, canCopySecret, handleUnauthorized, token]);

  useEffect(() => {
    void loadSystemConfig();
  }, [loadSystemConfig]);

  const pollRestartStatus = useCallback(async () => {
    if (!token) return;

    try {
      const response = await fetch("/api/system-config/restart-status", {
        headers: authHeaders,
      });

      if (response.status === 401 || response.status === 403) {
        await handleUnauthorized();
        return;
      }

      const payload = (await response.json().catch(() => ({}))) as RestartStatusResponse;
      if (!response.ok) {
        throw new Error(payload.error || "获取重启状态失败");
      }

      const nextStatus = normalizeRestartStatus(payload);
      setRestartStatus(nextStatus);

      if (isRestartPending(nextStatus.status)) {
        setPendingRestart(true);
        restartPollTimeoutRef.current = window.setTimeout(() => {
          void pollRestartStatus();
        }, 2000);
        return;
      }

      clearRestartPoll();
      setPendingRestart(false);

    } catch {
      setRestartStatus({
        status: "starting",
        message: "重启状态查询失败，正在重试",
      });
      setPendingRestart(true);
      restartPollTimeoutRef.current = window.setTimeout(() => {
        void pollRestartStatus();
      }, 3000);
    }
  }, [authHeaders, clearRestartPoll, handleUnauthorized, token]);

  useEffect(() => {
    if (!pendingRestart) {
      clearRestartPoll();
      return;
    }

    if (restartPollTimeoutRef.current === null) {
      restartPollTimeoutRef.current = window.setTimeout(() => {
        void pollRestartStatus();
      }, 2000);
    }

    return clearRestartPoll;
  }, [clearRestartPoll, pendingRestart, pollRestartStatus]);

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

  const performSave = useCallback(async () => {
    if (!token) {
      setError("未登录");
      return null;
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
        ? normalizeSections(payload.sections, canCopySecret)
        : sections;
      const nextValues = buildValuesMap(nextSections, payload.values ?? values);
      const nextRestartInfo = normalizeRestartInfo(payload.restart) ?? restartInfo;
      const nextPendingRestart = payload.pendingRestart === true;
      setSections(nextSections);
      setValues(nextValues);
      setSavedValues(nextValues);
      setRestartInfo(nextRestartInfo);
      setPendingRestart(nextPendingRestart);
      setRestartStatus((current) => {
        if (nextPendingRestart) {
          return isRestartPending(current.status) ? current : { status: "requested", message: null };
        }
        if (current.status === "failed" || current.status === "healthy") {
          return current;
        }
        return { status: "idle", message: null };
      });
      setActiveSectionId((current) => {
        return pickPreferredSectionId(nextSections, current);
      });
      return payload;
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存系统配置失败");
      return null;
    } finally {
      setIsSaving(false);
    }
  }, [authHeaders, canCopySecret, handleUnauthorized, restartInfo, sections, token, values]);

  const performSaveAndRestart = useCallback(async () => {
    const saved = await performSave();
    if (!saved || !token) {
      return;
    }

    try {
      const response = await fetch("/api/system-config/restart", {
        method: "POST",
        headers: authHeaders,
      });

      if (response.status === 401 || response.status === 403) {
        await handleUnauthorized();
        return;
      }

      const payload = (await response.json().catch(() => ({}))) as SystemConfigResponse;
      if (!response.ok) {
        throw new Error(payload.error || "服务重启失败");
      }

      setError("");
      setRestartInfo(normalizeRestartInfo(payload.restart) ?? restartInfo);
      setPendingRestart(payload.pendingRestart === true);
      setRestartStatus({ status: "requested", message: null });
    } catch (err) {
      clearRestartPoll();
      setPendingRestart(false);
      setRestartStatus({
        status: "failed",
        message: `配置已保存，但服务重启失败：${normalizeFailureMessage(
          err instanceof Error ? err.message : "未知错误",
        )}`,
      });
    }
  }, [authHeaders, clearRestartPoll, handleUnauthorized, performSave, restartInfo, token]);

  const handleSave = useCallback(async (mode: SubmitMode) => {
    const hasJwtSecretField =
      Object.prototype.hasOwnProperty.call(values, "JWT_SECRET") ||
      Object.prototype.hasOwnProperty.call(savedValues, "JWT_SECRET");

    if (hasJwtSecretField && values.JWT_SECRET !== (savedValues.JWT_SECRET ?? "")) {
      setConfirmMode(mode);
      return;
    }

    if (mode === "saveAndRestart") {
      await performSaveAndRestart();
      return;
    }

    await performSave();
  }, [performSave, performSaveAndRestart, savedValues.JWT_SECRET, values.JWT_SECRET]);

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
        <div className="rounded-xl border bg-card/60 px-4 py-3.5 backdrop-blur-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="font-brand text-base font-semibold tracking-tight">系统设置</h1>
              <p className="app-caption mt-0.5 text-muted-foreground">
                按 schema 分组加载真实配置项，编辑后直接保存到系统配置。
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => void handleSave("save")}
                disabled={isSaving || sections.length === 0}
                className="app-control inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-background px-3 py-1.5 text-[13px] font-medium text-foreground disabled:opacity-60"
              >
                {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                {isSaving ? "保存中..." : "保存配置"}
              </button>
              <button
                type="button"
                onClick={() => void handleSave("saveAndRestart")}
                disabled={isSaving || sections.length === 0 || restartInfo?.canRestart === false}
                className="app-control inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground disabled:opacity-60"
              >
                {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                {isSaving ? "保存中..." : "保存并重启"}
              </button>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="rounded-full bg-muted/50 px-2 py-0.5">分组 {sections.length}</span>
            <span className="rounded-full bg-muted/50 px-2 py-0.5">字段 {totalFields}</span>
            {currentSection ? (
              <span className="rounded-full bg-muted/50 px-2 py-0.5">当前 {currentSection.title}</span>
            ) : null}
          </div>
        </div>

        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-600">
            {error}
          </div>
        ) : null}

        <RestartBanner
          restart={restartInfo}
          pendingRestart={pendingRestart}
          restartStatus={restartStatus}
        />

        <div className="grid min-h-0 gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
          <ConfigSectionNav
            sections={sections}
            activeSectionId={activeSectionId}
            onSectionSelect={handleSectionSelect}
            className="sticky top-4 self-start"
          />

          <div className="min-h-0 rounded-xl border bg-card/50 p-1.5 shadow-sm">
            <ConfigForm
              sections={sections}
              values={values}
              onFieldChange={handleFieldChange}
              activeSectionId={activeSectionId}
            />
          </div>
        </div>

        <ConfirmDialog
          open={confirmMode !== null}
          title="确认修改 JWT_SECRET"
          message="修改 JWT_SECRET 后，重启会导致现有登录失效并需要重新登录。是否继续保存？"
          confirmLabel={confirmMode === "saveAndRestart" ? "继续保存并重启" : "继续保存"}
          cancelLabel="取消"
          destructive
          onConfirm={async () => {
            const mode = confirmMode;
            setConfirmMode(null);
            if (!mode) return;
            if (mode === "saveAndRestart") {
              await performSaveAndRestart();
              return;
            }
            await performSave();
          }}
          onCancel={() => setConfirmMode(null)}
        />
      </div>
    </div>
  );
}
