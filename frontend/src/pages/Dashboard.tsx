import { useEffect, useState } from "react";
import { Activity, Clock, CheckCircle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

interface Status {
  status: string;
  assistantName: string;
  uptime: number;
}

interface Task {
  id: string;
  prompt: string;
  schedule_type: string;
  schedule_value: string;
  next_run: string | null;
  status: string;
}

export function Dashboard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const { token } = useAuth();

  useEffect(() => {
    const apiBase = import.meta.env.DEV
      ? `${location.protocol}//${location.hostname}:3000`
      : "";

    fetch(`${apiBase}/api/status`)
      .then((res) => res.json())
      .then(setStatus)
      .catch(console.error);

    if (!token) return;
    const authHeaders = { Authorization: `Bearer ${token}` };

    fetch(`${apiBase}/api/tasks`, { headers: authHeaders })
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setTasks(Array.isArray(data) ? data : []))
      .catch(console.error);
  }, [token]);

  if (!status) return <div className="p-8">Loading...</div>;

  return (
    <div className="p-8 space-y-8">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
        <p className="text-muted-foreground">Overview of your CNP-Bot assistant.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="p-6 rounded-xl border bg-card text-card-foreground shadow">
          <div className="flex flex-row items-center justify-between space-y-0 pb-2">
            <div className="text-sm font-medium">Status</div>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="text-2xl font-bold">{status.status}</div>
        </div>
        <div className="p-6 rounded-xl border bg-card text-card-foreground shadow">
          <div className="flex flex-row items-center justify-between space-y-0 pb-2">
            <div className="text-sm font-medium">Uptime</div>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="text-2xl font-bold">{Math.floor(status.uptime / 60)}m</div>
        </div>
         <div className="p-6 rounded-xl border bg-card text-card-foreground shadow">
          <div className="flex flex-row items-center justify-between space-y-0 pb-2">
            <div className="text-sm font-medium">Tasks</div>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="text-2xl font-bold">{tasks.length}</div>
        </div>
      </div>
      
      <div className="space-y-4">
          <h3 className="text-xl font-semibold">Scheduled Tasks</h3>
          <div className="rounded-md border">
              <div className="relative w-full overflow-auto scrollbar-thin">
                <table className="w-full caption-bottom text-sm">
                    <thead className="[&_tr]:border-b">
                        <tr className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted">
                            <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">ID</th>
                            <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Prompt</th>
                            <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Schedule</th>
                            <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Next Run</th>
                            <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Status</th>
                        </tr>
                    </thead>
                    <tbody className="[&_tr:last-child]:border-0">
                        {tasks.map(task => (
                            <tr key={task.id} className="border-b transition-colors hover:bg-muted/50">
                                <td className="p-4 align-middle font-mono">{task.id.slice(0, 8)}</td>
                                <td className="p-4 align-middle">{task.prompt.slice(0, 50)}...</td>
                                <td className="p-4 align-middle">{task.schedule_type}: {task.schedule_value}</td>
                                <td className="p-4 align-middle">{task.next_run ? new Date(task.next_run).toLocaleString() : '-'}</td>
                                <td className="p-4 align-middle">{task.status}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
              </div>
          </div>
      </div>
    </div>
  );
}
