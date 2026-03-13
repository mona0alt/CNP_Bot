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
  const displayModel = modelNames && modelNames.length > 0 ? modelNames[0] : status.model;

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
    <div className="w-64 border-l bg-card p-4 flex flex-col gap-6 text-sm">
      <h3 className="font-semibold mb-2">Status</h3>

      <div className="space-y-4">
        <div>
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <Circle size={16} />
            <span className="text-xs font-medium">Process</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <span className={`w-2 h-2 rounded-full ${
              status.isActive
                ? 'bg-blue-500 animate-pulse'
                : status.processReady
                ? 'bg-green-500'
                : 'bg-yellow-500'
            }`} />
            <span>
              {status.isActive ? 'Running' : status.processReady ? 'Idle' : 'Initializing'}
            </span>
          </div>
        </div>

        {status.workingDirectory && (
        <div>
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <Folder size={16} />
            <span className="text-xs font-medium">Working Directory</span>
          </div>
          <div className="font-mono text-xs break-all bg-muted p-2 rounded">
            {status.workingDirectory}
          </div>
        </div>
        )}

        <div>
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <Cpu size={16} />
            <span className="text-xs font-medium">Model</span>
          </div>
          <div className="text-xs font-mono break-all">
            {displayModel}
          </div>
          {modelNames && modelNames.length > 1 && (
            <div className="mt-1 space-y-0.5">
              {modelNames.slice(1).map((m) => (
                <div key={m} className="text-xs font-mono break-all text-muted-foreground">
                  {m}
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <Activity size={16} />
            <span className="text-xs font-medium">Token Usage</span>
          </div>
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Input:</span>
              <span className="font-mono">{fmt(status.usage.input_tokens)}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Output:</span>
              <span className="font-mono">{fmt(status.usage.output_tokens)}</span>
            </div>
            {totalCacheRead > 0 && (
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Cache Read:</span>
                <span className="font-mono">{fmt(totalCacheRead)}</span>
              </div>
            )}
            {totalCacheWrite > 0 && (
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Cache Write:</span>
                <span className="font-mono">{fmt(totalCacheWrite)}</span>
              </div>
            )}
            <div className="flex justify-between text-xs font-medium pt-1 border-t">
              <span>Total:</span>
              <span className="font-mono">{fmt(totalTokens)}</span>
            </div>
          </div>
        </div>

        {contextWindow && (
          <div>
            <div className="flex justify-between text-xs text-muted-foreground mb-1">
              <span className="font-medium">Context Window</span>
              <span className="font-mono">{fmt(contextUsed)} / {fmt(contextWindow)}</span>
            </div>
            <div className="w-full bg-muted rounded-full h-1.5">
              <div
                className={`h-1.5 rounded-full transition-all ${
                  contextFill! > 0.9 ? 'bg-red-500' : contextFill! > 0.7 ? 'bg-yellow-500' : 'bg-blue-500'
                }`}
                style={{ width: `${(contextFill! * 100).toFixed(1)}%` }}
              />
            </div>
          </div>
        )}

        {(status.usage.cost_usd !== undefined && status.usage.cost_usd > 0) && (
          <div>
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <DollarSign size={16} />
              <span className="text-xs font-medium">Cost</span>
            </div>
            <div className="text-xs font-mono">
              ${status.usage.cost_usd.toFixed(4)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
