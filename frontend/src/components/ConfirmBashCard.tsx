import { AlertTriangle, Check, ShieldAlert, X } from 'lucide-react';

import type { ConfirmBashRequest } from '@/lib/interactive-events';
import { cn } from '@/lib/utils';

interface ConfirmBashCardProps {
  request: ConfirmBashRequest;
  onRespond: (requestId: string, approved: boolean) => void;
}

export function ConfirmBashCard({
  request,
  onRespond,
}: ConfirmBashCardProps) {
  const isSubmitting = !!request.submitting;

  return (
    <div className="my-4 flex items-start gap-3">
      <div className="w-8 h-8 rounded-full bg-amber-500/10 flex items-center justify-center shrink-0">
        <ShieldAlert className="w-4 h-4 text-amber-600 dark:text-amber-400" />
      </div>

      <div className="flex-1 max-w-[80%]">
        <div className="rounded-2xl rounded-bl-sm border border-border bg-card px-4 py-3 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-700 dark:text-amber-300">
              <AlertTriangle className="h-3.5 w-3.5" />
              危险命令确认
            </span>
            <span className="text-xs text-muted-foreground">
              请确认是否继续执行
            </span>
          </div>

          <div className="space-y-3">
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                命令
              </p>
              <pre className="overflow-x-auto rounded-xl border border-border bg-muted/40 px-3 py-2 text-xs text-foreground">
                <code>{request.command}</code>
              </pre>
            </div>

            <div className="rounded-xl bg-muted/40 px-3 py-2">
              <p className="text-xs font-medium text-muted-foreground">风险原因</p>
              <p className="mt-1 text-sm text-foreground/90">{request.reason}</p>
            </div>
          </div>

          {!isSubmitting ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                onClick={() => onRespond(request.requestId, true)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition-colors',
                  'border-amber-500/30 bg-amber-500/10 text-amber-700 hover:bg-amber-500/15',
                  'dark:text-amber-300',
                )}
              >
                <Check className="h-4 w-4" />
                仍要执行
              </button>
              <button
                onClick={() => onRespond(request.requestId, false)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground transition-colors',
                  'hover:bg-muted/80',
                )}
              >
                <X className="h-4 w-4" />
                拒绝
              </button>
            </div>
          ) : (
            <div className="mt-4 flex items-center gap-2 rounded-xl border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              正在提交你的选择...
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
