import { useEffect, useState } from "react";
import { Folder, Cpu, Activity } from "lucide-react";

interface StatusSidebarProps {
  jid: string | null;
  apiBase: string;
}

interface GroupStatus {
  workingDirectory: string;
  model: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export function StatusSidebar({ jid, apiBase }: StatusSidebarProps) {
  const [status, setStatus] = useState<GroupStatus | null>(null);

  useEffect(() => {
    if (!jid) {
      setStatus(null);
      return;
    }

    const fetchStatus = async () => {
      try {
        const res = await fetch(`${apiBase}/api/groups/${encodeURIComponent(jid)}/status`);
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
  }, [jid, apiBase]);

  if (!jid || !status) return null;

  return (
    <div className="w-64 border-l bg-card p-4 flex flex-col gap-6 text-sm">
      <h3 className="font-semibold mb-2">Status</h3>
      
      <div className="space-y-4">
        <div>
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <Folder size={16} />
            <span className="text-xs font-medium">Working Directory</span>
          </div>
          <div className="font-mono text-xs break-all bg-muted p-2 rounded">
            {status.workingDirectory}
          </div>
        </div>

        <div>
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <Cpu size={16} />
            <span className="text-xs font-medium">Model</span>
          </div>
          <div className="text-xs">
            {status.model}
          </div>
        </div>

        <div>
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <Activity size={16} />
            <span className="text-xs font-medium">Context Usage</span>
          </div>
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span>Input Tokens:</span>
              <span className="font-mono">{status.usage.input_tokens}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span>Output Tokens:</span>
              <span className="font-mono">{status.usage.output_tokens}</span>
            </div>
            <div className="flex justify-between text-xs font-medium pt-1 border-t">
              <span>Total:</span>
              <span className="font-mono">
                {status.usage.input_tokens + status.usage.output_tokens}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
