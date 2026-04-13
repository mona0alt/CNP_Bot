import { useEffect } from "react";
import { Folder, Cpu, Activity, Circle, DollarSign, X } from "lucide-react";

interface StatusSidebarProps {
  status: GroupStatus | null;
  open: boolean;
  onClose: () => void;
}

export interface ModelUsageEntry {
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  contextWindow?: number;
  costUSD?: number;
}

export interface GroupStatus {
  workingDirectory: string | null;
  model: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    model_usage?: Record<string, ModelUsageEntry>;
    cost_usd?: number;
  };
  processReady: boolean;
  isActive: boolean;
}

function fmt(n: number): string {
  return n.toLocaleString();
}

export function StatusSidebar({ status, open, onClose }: StatusSidebarProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!open) return;
      if (e.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  // Derive actual model names from modelUsage keys, fallback to configured model
  const modelUsage = status?.usage.model_usage;
  const modelNames = modelUsage ? Object.keys(modelUsage) : null;

  // Aggregate cache tokens across all models
  let totalCacheRead = 0;
  let totalCacheWrite = 0;
  let contextWindow: number | undefined;

  if (modelUsage) {
    for (const entry of Object.values(modelUsage)) {
      totalCacheRead += entry.cacheReadInputTokens ?? 0;
      totalCacheWrite += entry.cacheCreationInputTokens ?? 0;
      if (entry.contextWindow) contextWindow = entry.contextWindow;
    }
  }

  const totalTokens = status ? status.usage.input_tokens + status.usage.output_tokens : 0;
  const contextUsed = status?.usage.input_tokens ?? 0;
  const contextFill = contextWindow ? Math.min(contextUsed / contextWindow, 1) : null;

  return (
    <>
      <div
        className={`absolute inset-0 z-30 bg-black/30 transition-opacity duration-300 ease-out ${
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
      />

      <div
        className={`absolute right-0 top-0 bottom-0 z-40 w-80 bg-card/95 backdrop-blur-sm border-l shadow-2xl flex flex-col transition-transform duration-300 ease-out ${
          open ? "translate-x-0" : "translate-x-full pointer-events-none"
        }`}
        role="dialog"
        aria-modal="true"
      >
        <div className="h-12 flex items-center px-3.5 border-b shrink-0 gap-2">
          <Activity className="w-4 h-4 text-blue-500" />
          <h3 className="font-medium text-[14px] tracking-tight">状态</h3>
          {status && (
            <span className={`mr-2 px-2 py-0.5 text-[10px] rounded-full ${
              status.isActive
                ? "bg-blue-500/20 text-blue-600 dark:text-blue-400"
                : status.processReady
                  ? "bg-green-500/20 text-green-600 dark:text-green-400"
                  : "bg-yellow-500/20 text-yellow-600 dark:text-yellow-400"
            }`}>
              {status.isActive ? "运行中" : status.processReady ? "空闲" : "初始化"}
            </span>
          )}
          <button
            onClick={onClose}
            className="ml-auto h-8 w-8 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="关闭状态面板"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3.5 space-y-3">
          {status ? (
            <>
              <div className="bg-muted/30 rounded-lg p-3">
                <div className="flex items-center gap-2 text-muted-foreground mb-2">
                  <Circle size={14} className={status.isActive ? 'text-blue-500' : status.processReady ? 'text-green-500' : 'text-yellow-500'} />
                  <span className="text-[10px] font-medium uppercase tracking-wide">进程状态</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`w-2.5 h-2.5 rounded-full ${
                    status.isActive
                      ? 'bg-blue-500 shadow-lg shadow-blue-500/50'
                      : status.processReady
                        ? 'bg-green-500'
                        : 'bg-yellow-500 animate-pulse'
                  }`} />
                  <span className="text-[13px] font-medium">
                    {status.isActive ? '运行中' : status.processReady ? '已就绪' : '初始化中'}
                  </span>
                </div>
              </div>

              {status.workingDirectory && (
                <div className="bg-muted/30 rounded-lg p-3">
                  <div className="flex items-center gap-2 text-muted-foreground mb-2">
                    <Folder size={14} />
                    <span className="text-[10px] font-medium uppercase tracking-wide">工作目录</span>
                  </div>
                  <div className="font-mono text-[10.5px] break-all text-foreground/80 bg-card px-2.5 py-2 rounded border">
                    {status.workingDirectory}
                  </div>
                </div>
              )}

              {((modelNames && modelNames.length > 0) || status.model) && (
                <div className="bg-muted/30 rounded-lg p-3">
                  <div className="flex items-center gap-2 text-muted-foreground mb-2">
                    <Cpu size={14} />
                    <span className="text-[10px] font-medium uppercase tracking-wide">模型</span>
                  </div>
                  {modelNames && modelNames.length > 0 ? (
                    <div className="space-y-1">
                      <div className="text-[11px] font-mono break-all font-medium text-foreground/90">{modelNames[0]}</div>
                      {modelNames.length > 1 && (
                        <div className="mt-1.5 pt-1.5 border-t border-border/50 space-y-0.5">
                          {modelNames.slice(1).map((m) => (
                            <div key={m} className="text-[10px] font-mono break-all text-muted-foreground pl-2 border-l-2 border-muted">
                              {m}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-mono break-all text-muted-foreground">{status.model}</span>
                      <span className="text-[10px] text-muted-foreground/50">(已配置)</span>
                    </div>
                  )}
                </div>
              )}

              <div className="bg-muted/30 rounded-lg p-3">
                <div className="flex items-center gap-2 text-muted-foreground mb-3">
                  <Activity size={14} />
                  <span className="text-[10px] font-medium uppercase tracking-wide">Token 使用</span>
                </div>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <div className="bg-card rounded-md p-2 border">
                    <div className="text-[10px] text-muted-foreground mb-0.5">输入</div>
                    <div className="text-[13px] font-mono font-semibold">{fmt(status.usage.input_tokens)}</div>
                  </div>
                  <div className="bg-card rounded-md p-2 border">
                    <div className="text-[10px] text-muted-foreground mb-0.5">输出</div>
                    <div className="text-[13px] font-mono font-semibold">{fmt(status.usage.output_tokens)}</div>
                  </div>
                </div>
                {(totalCacheRead > 0 || totalCacheWrite > 0) && (
                  <div className="flex gap-3 mb-3 text-[10px]">
                    {totalCacheRead > 0 && (
                      <div className="flex items-center gap-1">
                        <span className="text-muted-foreground">缓存读取:</span>
                        <span className="font-mono font-medium">{fmt(totalCacheRead)}</span>
                      </div>
                    )}
                    {totalCacheWrite > 0 && (
                      <div className="flex items-center gap-1">
                        <span className="text-muted-foreground">缓存写入:</span>
                        <span className="font-mono font-medium">{fmt(totalCacheWrite)}</span>
                      </div>
                    )}
                  </div>
                )}
                <div className="flex justify-between text-[10px] font-medium pt-2 border-t border-border">
                  <span>总计:</span>
                  <span className="font-mono text-blue-600 dark:text-blue-400">{fmt(totalTokens)}</span>
                </div>
              </div>

              {contextWindow && (
                <div className="bg-muted/30 rounded-lg p-3">
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-2">
                    <span className="font-medium uppercase tracking-wide">上下文窗口</span>
                    <span className="font-mono">{fmt(contextUsed)} / {fmt(contextWindow)}</span>
                  </div>
                  <div className="w-full bg-card rounded-full h-2.5 border">
                    <div
                      className={`h-2.5 rounded-full transition-all duration-500 ${
                        contextFill! > 0.9 ? 'bg-red-500' : contextFill! > 0.7 ? 'bg-yellow-500' : 'bg-blue-500'
                      }`}
                      style={{ width: `${(contextFill! * 100).toFixed(1)}%` }}
                    />
                  </div>
                  <div className="flex justify-between mt-1.5 text-[10px] text-muted-foreground">
                    <span>已使用</span>
                    <span className="font-mono">{((contextFill! * 100)).toFixed(1)}%</span>
                  </div>
                </div>
              )}

              {(status.usage.cost_usd !== undefined && status.usage.cost_usd > 0) && (
                <div className="bg-muted/30 rounded-lg p-3">
                  <div className="flex items-center gap-2 text-muted-foreground mb-2">
                    <DollarSign size={14} />
                    <span className="text-[10px] font-medium uppercase tracking-wide">费用</span>
                  </div>
                  <div className="text-[15px] font-mono font-semibold text-green-600 dark:text-green-400">
                    ${status.usage.cost_usd.toFixed(4)}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
              加载中...
            </div>
          )}
        </div>
      </div>
    </>
  );
}
