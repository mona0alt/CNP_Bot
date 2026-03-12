import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/contexts/ThemeContext";
import { ChevronDown, ChevronRight, Terminal, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";

export interface ToolCallCardProps {
  toolName: string;
  input: string | object;
  status: "calling" | "executed" | "error";
  result?: string | object | null;
  className?: string;
  defaultExpanded?: boolean;
}

export function ToolCallCard({
  toolName,
  input,
  status,
  result,
  className,
  defaultExpanded = false,
}: ToolCallCardProps) {
  const { theme } = useTheme();
  const [expanded, setExpanded] = useState(defaultExpanded);

  const inputString = useMemo(() => {
    if (typeof input === "string") return input;
    if (typeof input === "object" && input !== null && "command" in input) {
      return String((input as { command: unknown }).command);
    }
    return JSON.stringify(input, null, 2);
  }, [input]);

  const resultString = useMemo(() => {
    if (result === undefined || result === null) return null;
    if (typeof result === "string") return result;
    return JSON.stringify(result, null, 2);
  }, [result]);

  const StatusIcon = {
    calling: Loader2,
    executed: CheckCircle2,
    error: AlertCircle,
  }[status];

  const isLight = theme === "light";

  // 简洁的浅色主题配色 - 参考 minimax 风格
  const statusColor = {
    calling: isLight ? "text-blue-600" : "text-blue-400",
    executed: isLight ? "text-zinc-600" : "text-emerald-400",
    error: isLight ? "text-red-600" : "text-red-400",
  }[status];

  const borderColor = {
    calling: isLight ? "border-blue-200" : "border-blue-800/60",
    executed: isLight ? "border-zinc-200" : "border-emerald-800/60",
    error: isLight ? "border-red-200" : "border-red-800/60",
  }[status];

  // Add a helper to truncate long tool names
  const truncatedToolName = toolName.length > 30 ? `${toolName.substring(0, 30)}...` : toolName;

  // 浅色模式使用更简洁的背景
  const statusBgColor = isLight ? "bg-zinc-50" : {
    calling: "bg-blue-900/20",
    executed: "bg-emerald-900/20",
    error: "bg-red-900/20",
  }[status];

  return (
    <div
      className={cn(
        "border rounded-lg overflow-hidden bg-card transition-all my-2",
        borderColor,
        statusBgColor,
        className
      )}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 p-2 px-3 bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className={cn("p-1 rounded-md bg-background border", borderColor)}>
          <Terminal size={14} className={statusColor} />
        </div>
        <div className="flex-1 font-mono text-xs font-medium truncate">
          {truncatedToolName}
        </div>
        <div className="flex items-center gap-2">
          {status === "calling" && (
            <span className="text-[10px] text-muted-foreground animate-pulse">
              Calling...
            </span>
          )}
          <StatusIcon
            size={14}
            className={cn(statusColor, status === "calling" && "animate-spin")}
          />
          {expanded ? (
            <ChevronDown size={14} className="text-muted-foreground" />
          ) : (
            <ChevronRight size={14} className="text-muted-foreground" />
          )}
        </div>
      </div>

      {/* Content */}
      {expanded && (
        <div className="border-t bg-muted/10">
          <div className="p-3 space-y-3">
            {/* Input Section */}
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5 font-semibold">
                Input
              </div>
              <div className="relative group">
                <pre className="text-xs bg-muted/50 p-2 rounded-md overflow-x-auto font-mono text-foreground/80 whitespace-pre-wrap break-all">
                  {inputString || <span className="text-muted-foreground italic">No input</span>}
                </pre>
              </div>
            </div>

            {/* Result Section (only if exists) */}
            {resultString && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5 font-semibold flex items-center justify-between">
                  <span>Result</span>
                  {status === "error" && (
                    <span className="text-red-500 text-[10px]">Failed</span>
                  )}
                </div>
                <div className="relative group">
                  <pre className={cn(
                    "text-xs p-2 rounded-md overflow-x-auto font-mono whitespace-pre-wrap break-all",
                    isLight
                      ? (status === "error" ? "bg-red-100 text-red-800 border border-red-200" : "bg-blue-50 text-blue-800 border border-blue-100")
                      : (status === "error" ? "bg-red-900/30 text-red-300" : "bg-emerald-900/30 text-emerald-300")
                  )}>
                    {resultString}
                  </pre>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}