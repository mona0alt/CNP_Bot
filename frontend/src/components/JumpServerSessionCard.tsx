import { useState } from 'react';
import {
  Loader2,
  MonitorCog,
  Server,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';

import type { JumpServerBlock, JumpServerExecution } from '@/lib/types';
import { redactSensitiveToolText } from '@/lib/tool-redaction';
import { cn } from '@/lib/utils';
import { ToolCallCard } from '@/components/ToolCallCard';
import { useTheme } from '@/contexts/ThemeContext';

function stageLabel(stage: JumpServerBlock['stage'], targetHost?: string) {
  switch (stage) {
    case 'connecting_jumpserver': return '正在连接堡垒机…';
    case 'jumpserver_ready': return '堡垒机已就绪';
    case 'sending_target': return targetHost ? `正在选择目标 ${targetHost}` : '正在选择目标主机';
    case 'target_connecting': return targetHost ? `正在连接 ${targetHost}` : '正在连接目标主机';
    case 'target_connected': return targetHost ? `已连接 ${targetHost}` : '已连接目标主机';
    case 'running_remote_command': return '正在执行远端命令';
    case 'completed': return '已完成';
    case 'cancelled': return '已取消';
    case 'error': return '执行失败';
  }
}

function statusTone(stage: JumpServerBlock['stage'], isLight: boolean) {
  switch (stage) {
    case 'completed':
    case 'target_connected':
      return isLight
        ? 'border-emerald-200 bg-emerald-50 text-slate-900 shadow-sm'
        : 'border-emerald-500/30 bg-emerald-500/10 text-slate-50';
    case 'error':
      return isLight
        ? 'border-red-200 bg-red-50 text-slate-900 shadow-sm'
        : 'border-red-500/30 bg-red-500/10 text-slate-50';
    case 'cancelled':
      return isLight
        ? 'border-amber-200 bg-amber-50 text-slate-900 shadow-sm'
        : 'border-amber-500/30 bg-amber-500/10 text-slate-50';
    default:
      return isLight
        ? 'border-sky-200 bg-sky-50 text-slate-900 shadow-sm'
        : 'border-sky-500/30 bg-slate-950/70 text-slate-50';
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
  const { theme } = useTheme();
  const [expanded, setExpanded] = useState(true);
  const isLight = theme === 'light';
  const executions = block.executions ?? [];
  const badgeClass = isLight
    ? 'border-slate-200 bg-white/90 text-slate-700'
    : 'border-slate-800 bg-slate-950/60 text-slate-200';
  const iconWrapClass = isLight
    ? 'border-sky-200 bg-white/90'
    : 'border-slate-700/80 bg-slate-900/90';
  const sectionTitleClass = isLight ? 'text-slate-500' : 'text-slate-400';
  const toolCardClass = isLight
    ? 'my-0 border-slate-200 bg-white shadow-sm'
    : 'my-0 border-slate-700/80 bg-slate-900/70';

  return (
    <section
      className={cn(
        'my-1 overflow-hidden rounded-xl border shadow-sm shadow-black/5',
        'motion-reduce:transition-none',
        statusTone(block.stage, isLight),
      )}
    >
      <div
        className="flex items-center gap-2 px-2.5 py-2.5 cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className={cn('rounded-lg border p-1', iconWrapClass)}>
          {block.stage === 'running_remote_command' ? (
            <Loader2 size={13} className="animate-spin text-sky-400" />
          ) : (
            <MonitorCog size={13} className="text-sky-300" />
          )}
        </div>
        <div className="min-w-0 flex-1 flex items-center gap-2 flex-wrap">
          <span className="text-[12px] font-medium tracking-tight">JumpServer 远程会话</span>
          {block.target_host ? (
            <span className={cn('flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[9px] font-medium', badgeClass)}>
              <Server size={10} className="text-emerald-300" />
              <span>{block.target_host}</span>
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5">
          <div className={cn('text-[9px]', isLight ? 'text-slate-500' : 'text-slate-400')}>
            {stageLabel(block.stage, block.target_host)}
          </div>
          {expanded ? (
            <ChevronDown size={13} className="text-muted-foreground" />
          ) : (
            <ChevronRight size={13} className="text-muted-foreground" />
          )}
        </div>
      </div>

      {expanded && (
        <>
          {executions.length > 0 ? (
            <div className="space-y-1.5 px-2.5 pb-2.5">
              <div className={cn('text-[9px] font-medium uppercase tracking-[0.16em]', sectionTitleClass)}>
                执行记录
              </div>
              <div className="space-y-1.5">
                {executions.map((execution) => (
                  <ToolCallCard
                    key={execution.id}
                    toolName="Bash"
                    input={{ command: redact(execution.command) ?? execution.command }}
                    status={mapExecutionStatus(execution.status)}
                    result={redact(execution.output) ?? execution.error_message ?? null}
                    defaultExpanded={false}
                    showInputInTitle={true}
                    className={toolCardClass}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {block.stage === 'error' && block.error_message ? (
            <div className={cn(
              'mx-2.5 mb-2.5 rounded-lg border px-2.5 py-1.5 text-[10px]',
              isLight
                ? 'border-red-200 bg-red-50 text-red-700'
                : 'border-red-500/20 bg-red-500/10 text-red-200',
            )}>
              {block.error_message}
            </div>
          ) : null}
        </>
      )}

    </section>
  );
}
