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
    <div className="border rounded-lg my-2 overflow-hidden bg-gradient-to-br from-amber-50 to-yellow-50 border-amber-200/60 shadow-sm">
      <div className="w-full flex items-center justify-between px-3 py-2 hover:bg-amber-100/50 transition-colors text-left">
        <div className="flex items-center gap-2 text-amber-700">
          <Brain size={16} className={!isComplete ? "text-amber-600 animate-pulse" : "text-amber-500"} />
          <span className="text-xs font-semibold uppercase tracking-wider text-amber-600">
            Thinking
          </span>
          {!isComplete && (
             <span className="ml-2 inline-flex items-center text-xs text-amber-600 font-medium">
               <Loader2 size={12} className="mr-1 animate-spin" />
               Generating...
             </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-ping" />
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
        </div>
      </div>

      <div className="px-4 py-2 text-sm border-t border-amber-200/60 bg-white/30">
        <div
          ref={lineRef}
          className="overflow-x-auto whitespace-nowrap scrollbar-none text-amber-900/90 leading-6"
        >
          <span className="inline-block min-w-full pr-6">
            {content || "Thinking..."}
          </span>
        </div>
      </div>
    </div>
  );
}
