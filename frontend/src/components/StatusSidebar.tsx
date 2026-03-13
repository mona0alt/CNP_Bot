import { useEffect, useState } from "react";
import { Folder, Cpu, Activity, Circle, DollarSign } from "lucide-react";

interface StatusSidebarProps {
  jid: string | null;
  apiBase: string;
  token: string | null;
}

interface ModelUsageEntry {
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  contextWindow?: number;
  costUSD?: number;
}

interface GroupStatus {
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

export function StatusSidebar({ jid, apiBase, token }: StatusSidebarProps) {
  const [status, setStatus] = useState<GroupStatus | null>(null);
  const effectiveToken =
    token ?? (typeof window !== "undefined" ? localStorage.getItem("auth_token") : null);

  useEffect(() => {
    if (!jid || !effectiveToken) {
      return;
    }

    const fetchStatus = async () => {
      try {
        const res = await fetch(`${apiBase}/api/groups/${encodeURIComponent(jid)}/status`, {
          headers: {
            Authorization: `Bearer ${effectiveToken}`,
          },
        });
        if (res.ok) {
          const data = await res.json();
          setStatus(data);
        }
      } catch (error) {
        console.error("Failed to fetch status", error);
      }
    };

    fetchStatus();
    // Poll status every 10 seconds
    const interval = setInterval(fetchStatus, 10000);
    return () => clearInterval(interval);
  }, [jid, apiBase, effectiveToken]);

  // Early return when jid is null - no need to set state
  if (!jid || !status) return null;

  // Derive actual model names from modelUsage keys, fallback to configured model
  const modelUsage = status.usage.model_usage;
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

  const totalTokens = status.usage.input_tokens + status.usage.output_tokens;
  const contextUsed = status.usage.input_tokens;
  const contextFill = contextWindow ? Math.min(contextUsed / contextWindow, 1) : null;

  return (
    <div className="w-72 border-l bg-card/50 backdrop-blur-sm flex flex-col h-full">
      <div className="h-[60px] flex items-center px-4 border-b shrink-0 gap-2">
        <Activity className="w-4 h-4 text-blue-500" />
        <h3 className="font-semibold text-lg">状态</h3>
        <span className={`ml-auto px-2 py-0.5 text-xs rounded-full ${
          status.isActive
            ? 'bg-blue-500/20 text-blue-600 dark:text-blue-400'
            : status.processReady
            ? 'bg-green-500/20 text-green-600 dark:text-green-400'
            : 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400'
        }`}>
          {status.isActive ? '运行中' : status.processReady ? '空闲' : '初始化'}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="bg-muted/30 rounded-lg p-3">
          <div className="flex items-center gap-2 text-muted-foreground mb-2">
            <Circle size={14} className={status.isActive ? 'text-blue-500' : status.processReady ? 'text-green-500' : 'text-yellow-500'} />
            <span className="text-xs font-medium uppercase tracking-wide">进程状态</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${
              status.isActive
                ? 'bg-blue-500 shadow-lg shadow-blue-500/50'
                : status.processReady
                ? 'bg-green-500'
                : 'bg-yellow-500 animate-pulse'
            }`} />
            <span className="text-sm font-medium">
              {status.isActive ? '运行中' : status.processReady ? '已就绪' : '初始化中'}
            </span>
          </div>
        </div>

        {status.workingDirectory && (
          <div className="bg-muted/30 rounded-lg p-3">
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <Folder size={14} />
              <span className="text-xs font-medium uppercase tracking-wide">工作目录</span>
            </div>
            <div className="font-mono text-xs break-all text-foreground/80 bg-card px-2 py-1.5 rounded border">
              {status.workingDirectory}
            </div>
          </div>
        )}

        {(modelNames && modelNames.length > 0 || status.model) && (
          <div className="bg-muted/30 rounded-lg p-3">
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <Cpu size={14} />
              <span className="text-xs font-medium uppercase tracking-wide">模型</span>
            </div>
            {modelNames && modelNames.length > 0 ? (
              <div className="space-y-1">
                <div className="text-xs font-mono break-all font-medium text-foreground/90">{modelNames[0]}</div>
                {modelNames.length > 1 && (
                  <div className="mt-1.5 pt-1.5 border-t border-border/50 space-y-0.5">
                    {modelNames.slice(1).map((m) => (
                      <div key={m} className="text-xs font-mono break-all text-muted-foreground pl-2 border-l-2 border-muted">
                        {m}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono break-all text-muted-foreground">{status.model}</span>
                <span className="text-xs text-muted-foreground/50">(已配置)</span>
              </div>
            )}
          </div>
        )}

        <div className="bg-muted/30 rounded-lg p-3">
          <div className="flex items-center gap-2 text-muted-foreground mb-3">
            <Activity size={14} />
            <span className="text-xs font-medium uppercase tracking-wide">Token 使用</span>
          </div>
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div className="bg-card rounded-md p-2 border">
              <div className="text-xs text-muted-foreground mb-0.5">输入</div>
              <div className="text-sm font-mono font-semibold">{fmt(status.usage.input_tokens)}</div>
            </div>
            <div className="bg-card rounded-md p-2 border">
              <div className="text-xs text-muted-foreground mb-0.5">输出</div>
              <div className="text-sm font-mono font-semibold">{fmt(status.usage.output_tokens)}</div>
            </div>
          </div>
          {(totalCacheRead > 0 || totalCacheWrite > 0) && (
            <div className="flex gap-3 mb-3 text-xs">
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
          <div className="flex justify-between text-xs font-medium pt-2 border-t border-border">
            <span>总计:</span>
            <span className="font-mono text-blue-600 dark:text-blue-400">{fmt(totalTokens)}</span>
          </div>
        </div>

        {contextWindow && (
          <div className="bg-muted/30 rounded-lg p-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
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
            <div className="flex justify-between mt-1.5 text-xs text-muted-foreground">
              <span>已使用</span>
              <span className="font-mono">{((contextFill! * 100)).toFixed(1)}%</span>
            </div>
          </div>
        )}

        {(status.usage.cost_usd !== undefined && status.usage.cost_usd > 0) && (
          <div className="bg-muted/30 rounded-lg p-3">
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <DollarSign size={14} />
              <span className="text-xs font-medium uppercase tracking-wide">费用</span>
            </div>
            <div className="text-lg font-mono font-semibold text-green-600 dark:text-green-400">
              ${status.usage.cost_usd.toFixed(4)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
