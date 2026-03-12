import { useEffect, useRef } from 'react';
import { Brain, Loader2 } from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';

interface ThoughtProcessProps {
  content: string;
  isComplete: boolean;
  autoCollapse?: boolean;
}

export function ThoughtProcess({ content, isComplete }: ThoughtProcessProps) {
  const { theme } = useTheme();
  const isLight = theme === "light";
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
      <div className={isLight
        ? "w-full flex items-center justify-between px-3 py-2 bg-amber-50 border-b border-amber-100 text-left"
        : "w-full flex items-center justify-between px-3 py-2 bg-amber-500/10 border-b border-amber-500/20 text-left"
      }>
        <div className={`flex items-center gap-2 ${isLight ? "text-amber-700" : "text-amber-200"}`}>
          <div className={`p-1 rounded-md ${isLight ? "bg-amber-100 border-amber-200" : "bg-amber-500/20 border-amber-500/30"}`}>
            <Brain size={14} className={!isComplete
              ? (isLight ? "text-amber-500 animate-pulse" : "text-amber-400 animate-pulse")
              : (isLight ? "text-amber-600" : "text-amber-300")
            } />
          </div>
          <span className={`text-xs font-semibold uppercase tracking-wider ${isLight ? "text-amber-700" : "text-amber-200"}`}>
            Thinking
          </span>
          {!isComplete && (
             <span className={`ml-2 inline-flex items-center text-xs font-medium ${isLight ? "text-amber-500" : "text-amber-400"}`}>
               <Loader2 size={12} className="mr-1 animate-spin" />
               Generating...
             </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {!isComplete && (
            <>
              <span className={`h-1.5 w-1.5 rounded-full animate-ping ${isLight ? "bg-amber-500" : "bg-amber-500"}`} />
              <span className={`h-1.5 w-1.5 rounded-full animate-pulse ${isLight ? "bg-amber-400" : "bg-amber-400"}`} />
            </>
          )}
        </div>
      </div>

      {/* Content - horizontal scroll for updates */}
      <div className="px-4 py-2 text-sm bg-muted/10">
        <div
          ref={lineRef}
          className={`overflow-x-auto whitespace-nowrap scrollbar-none leading-6 ${isLight ? "text-amber-800" : "text-amber-100/90"}`}
        >
          <span className="inline-block min-w-full pr-6">
            {content || "Thinking..."}
          </span>
        </div>
      </div>
    </div>
  );
}
