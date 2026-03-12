import { useEffect, useRef } from 'react';
import { Brain, Loader2 } from 'lucide-react';

interface ThoughtProcessProps {
  content: string;
  isComplete: boolean;
  autoCollapse?: boolean;
}

export function ThoughtProcess({ content, isComplete }: ThoughtProcessProps) {
  const lineRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!lineRef.current) return;
    const element = lineRef.current;
    element.scrollTo({ left: element.scrollWidth, behavior: 'smooth' });
  }, [content, isComplete]);

  if (!content && isComplete) return null;

  return (
    <div className="border rounded-lg my-2 overflow-hidden bg-card border-amber-500/30">
      {/* Header - matches ToolCallCard header style */}
      <div className="w-full flex items-center justify-between px-3 py-2 bg-amber-500/10 dark:bg-amber-500/10 border-b border-amber-500/20 text-left">
        <div className="flex items-center gap-2 text-amber-600 dark:text-amber-200">
          <div className="p-1 rounded-md bg-amber-500/20 border border-amber-500/30">
            <Brain size={14} className={!isComplete ? "text-amber-500 dark:text-amber-400 animate-pulse" : "text-amber-600 dark:text-amber-300"} />
          </div>
          <span className="text-xs font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-200">
            Thinking
          </span>
          {!isComplete && (
             <span className="ml-2 inline-flex items-center text-xs text-amber-500 dark:text-amber-400 font-medium">
               <Loader2 size={12} className="mr-1 animate-spin" />
               Generating...
             </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {!isComplete && (
            <>
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-ping" />
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
            </>
          )}
        </div>
      </div>

      {/* Content - horizontal scroll for updates */}
      <div className="px-4 py-2 text-sm bg-muted/10">
        <div
          ref={lineRef}
          className="overflow-x-auto whitespace-nowrap scrollbar-none text-amber-800 dark:text-amber-100/90 leading-6"
        >
          <span className="inline-block min-w-full pr-6">
            {content || "Thinking..."}
          </span>
        </div>
      </div>
    </div>
  );
}
