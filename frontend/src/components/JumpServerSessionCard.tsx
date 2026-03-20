import {
  Loader2,
  MonitorCog,
  Server,
  Shield,
} from 'lucide-react';

import type { JumpServerBlock, JumpServerExecution } from '@/lib/types';
import { redactSensitiveToolText } from '@/lib/tool-redaction';
import { cn } from '@/lib/utils';
import { ToolCallCard } from '@/components/ToolCallCard';

function stageLabel(stage: JumpServerBlock['stage'], targetHost?: string) {
  switch (stage) {
    case 'connecting_jumpserver':
      return '正在连接堡垒机';
    case 'jumpserver_ready':
      return '已连接堡垒机';
    case 'sending_target':
      return targetHost ? `正在选择目标主机 ${targetHost}` : '正在选择目标主机';
    case 'target_connecting':
      return targetHost ? `正在连接目标主机 ${targetHost}` : '正在连接目标主机';
    case 'target_connected':
      return targetHost ? `已连接目标主机 ${targetHost}` : '已连接目标主机';
    case 'running_remote_command':
      return '正在执行远端命令';
    case 'completed':
      return '已完成';
    case 'cancelled':
      return '已取消';
    case 'error':
      return '执行失败';
  }
}

function statusTone(stage: JumpServerBlock['stage']) {
  switch (stage) {
    case 'completed':
    case 'target_connected':
      return 'border-emerald-500/30 bg-emerald-500/10';
    case 'error':
      return 'border-red-500/30 bg-red-500/10';
    case 'cancelled':
      return 'border-amber-500/30 bg-amber-500/10';
    default:
      return 'border-sky-500/30 bg-slate-950/70';
  }
}

function redact(value?: string): string | undefined {
  return value ? redactSensitiveToolText(value) : value;
}

function mapExecutionStatus(status: JumpServerExecution['status']) {
  switch (status) {
    case 'running':
      return 'calling';
    case 'completed':
      return 'executed';
    case 'error':
      return 'error';
    case 'cancelled':
      return 'cancelled';
  }
}

export function JumpServerSessionCard({ block }: { block: JumpServerBlock }) {
  const executions = block.executions ?? [];

  return (
    <section
      className={cn(
        'my-2 overflow-hidden rounded-2xl border p-4 text-slate-50 shadow-lg shadow-black/10',
        'space-y-4 motion-reduce:transition-none',
        statusTone(block.stage),
      )}
    >
      <div className="flex items-start gap-3">
        <div className="rounded-xl border border-slate-700/80 bg-slate-900/90 p-2">
          {block.stage === 'running_remote_command' ? (
            <Loader2 size={16} className="animate-spin text-sky-400" />
          ) : (
            <MonitorCog size={16} className="text-sky-300" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold tracking-wide">
            JumpServer 远程会话
          </div>
          <div className="mt-1 text-xs text-slate-300">
            {stageLabel(block.stage, block.target_host)}
          </div>
        </div>
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        {block.jumpserver_host ? (
          <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs text-slate-200">
            <Shield size={14} className="text-sky-300" />
            <span>堡垒机：{block.jumpserver_host}</span>
          </div>
        ) : null}
        {block.target_host ? (
          <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs text-slate-200">
            <Server size={14} className="text-emerald-300" />
            <span>目标主机：{block.target_host}</span>
          </div>
        ) : null}
      </div>

      {block.target_hint ? (
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs text-slate-300">
          目标提示：{block.target_hint}
        </div>
      ) : null}

      {executions.length > 0 ? (
        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
            执行记录
          </div>
          <div className="space-y-2">
            {executions.map((execution, index) => (
              <ToolCallCard
                key={execution.id}
                toolName="Bash"
                input={{ command: redact(execution.command) ?? execution.command }}
                status={mapExecutionStatus(execution.status)}
                result={redact(execution.output) ?? execution.error_message ?? null}
                defaultExpanded={index === executions.length - 1}
                className="my-0 border-slate-700/80 bg-slate-900/70"
              />
            ))}
          </div>
        </div>
      ) : null}

      {block.error_message ? (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {block.error_message}
        </div>
      ) : null}
    </section>
  );
}
