import { AlertTriangle, Check, X } from 'lucide-react';

import type { ConfirmBashRequest } from '@/lib/interactive-events';

interface ConfirmBashCardProps {
  request: ConfirmBashRequest;
  onRespond: (requestId: string, approved: boolean) => void;
}

export function ConfirmBashCard({
  request,
  onRespond,
}: ConfirmBashCardProps) {
  const isPending = !request.submitting;

  return (
    <div className="my-4 p-4 border-2 border-destructive/50 rounded-lg bg-destructive/5">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center shrink-0">
          <AlertTriangle className="w-5 h-5 text-destructive" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-destructive" />
            <span className="font-semibold text-destructive">危险命令确认</span>
          </div>
          <div className="mb-3">
            <p className="text-xs text-muted-foreground mb-1">命令:</p>
            <pre className="text-xs bg-background p-2 rounded border overflow-x-auto">
              <code>{request.command}</code>
            </pre>
          </div>
          <p className="text-sm text-destructive/80 mb-3">
            <span className="font-medium">原因:</span> {request.reason}
          </p>

          {isPending ? (
            <div className="flex gap-2">
              <button
                onClick={() => onRespond(request.requestId, true)}
                disabled={request.submitting}
                className="flex items-center gap-1 px-4 py-2 bg-destructive text-white rounded-md hover:bg-destructive/90 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
              >
                <Check className="w-4 h-4" />
                {request.submitting ? '处理中...' : '批准执行'}
              </button>
              <button
                onClick={() => onRespond(request.requestId, false)}
                disabled={request.submitting}
                className="flex items-center gap-1 px-4 py-2 bg-muted text-muted-foreground rounded-md hover:bg-muted/80 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
              >
                <X className="w-4 h-4" />
                {request.submitting ? '处理中...' : '拒绝'}
              </button>
            </div>
          ) : (
            <div className="p-2 rounded border text-sm bg-muted border-muted-foreground/20 text-muted-foreground">
              <span className="flex items-center gap-1">
                <AlertTriangle className="w-4 h-4" />
                正在提交你的选择...
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
