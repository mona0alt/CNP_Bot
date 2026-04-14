type RestartRuntimeInfo = {
  manager: "launchd" | "systemd-user" | "systemd-system" | "nohup" | "unsupported";
  status: "running" | "stopped" | "unknown";
  canRestart: boolean;
};

type RestartStatusValue = "idle" | "requested" | "stopping" | "starting" | "healthy" | "failed";

type RestartStatusSnapshot = {
  status: RestartStatusValue;
  message?: string | null;
};

interface RestartBannerProps {
  restart: RestartRuntimeInfo | null;
  pendingRestart: boolean;
  restartStatus: RestartStatusSnapshot;
}

function managerLabel(manager: RestartRuntimeInfo["manager"] | undefined): string {
  switch (manager) {
    case "launchd":
      return "launchd";
    case "systemd-user":
      return "systemd 用户服务";
    case "systemd-system":
      return "systemd 系统服务";
    case "nohup":
      return "nohup 脚本";
    default:
      return "未识别";
  }
}

function normalizeFailureMessage(message?: string | null): string {
  if (!message) {
    return "服务重启失败，请检查服务日志。";
  }

  if (message.startsWith("配置已保存，但服务重启失败")) {
    return message;
  }

  if (message === "restart_command_failed") {
    return "服务重启失败：重启命令执行失败。";
  }

  if (message === "unsupported_restart_manager") {
    return "当前运行环境不支持自动重启。";
  }

  return `服务重启失败：${message}`;
}

function renderStatusMessage(
  pendingRestart: boolean,
  restartStatus: RestartStatusSnapshot,
): string {
  if (restartStatus.status === "healthy") {
    return "服务已恢复，当前配置与服务状态已同步。";
  }

  if (restartStatus.status === "failed") {
    return normalizeFailureMessage(restartStatus.message);
  }

  if (
    pendingRestart ||
    restartStatus.status === "requested" ||
    restartStatus.status === "stopping" ||
    restartStatus.status === "starting"
  ) {
    return "服务重启中，页面会在恢复后自动更新状态。";
  }

  return "配置保存后可直接触发服务重启。";
}

function bannerTone(
  pendingRestart: boolean,
  restartStatus: RestartStatusSnapshot,
  canRestart: boolean,
): string {
  if (restartStatus.status === "failed" || !canRestart) {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }

  if (
    pendingRestart ||
    restartStatus.status === "requested" ||
    restartStatus.status === "stopping" ||
    restartStatus.status === "starting"
  ) {
    return "border-blue-200 bg-blue-50 text-blue-800";
  }

  if (restartStatus.status === "healthy") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }

  return "border-border/60 bg-card/70 text-foreground";
}

export function RestartBanner({
  restart,
  pendingRestart,
  restartStatus,
}: RestartBannerProps) {
  const canRestart = restart?.canRestart ?? false;
  const statusMessage = renderStatusMessage(pendingRestart, restartStatus);

  return (
    <div
      className={`rounded-2xl border px-4 py-3 ${bannerTone(
        pendingRestart,
        restartStatus,
        canRestart,
      )}`}
      data-testid="restart-banner"
    >
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <span className="rounded-full bg-background/70 px-2.5 py-1">
          服务管理器 {managerLabel(restart?.manager)}
        </span>
        <span className="rounded-full bg-background/70 px-2.5 py-1">
          {canRestart ? "支持自动重启" : "不支持自动重启"}
        </span>
      </div>

      <p className="mt-2 text-sm font-medium">{statusMessage}</p>
    </div>
  );
}
