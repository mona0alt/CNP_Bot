import { useState, useRef, useEffect } from 'react';
import { Brain, Loader2, ChevronDown, ChevronRight } from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';

interface ThoughtProcessProps {
  content: string;
  isComplete: boolean;
  autoCollapse?: boolean;
}

export function ThoughtProcess({ content, isComplete, autoCollapse }: ThoughtProcessProps) {
  const { theme } = useTheme();
  const isLight = theme === "light";
  const [manualExpanded, setManualExpanded] = useState<boolean | null>(null);
  const isExpanded = manualExpanded ?? (!isComplete || !autoCollapse);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [content]);

  const toggleExpansion = () => {
    setManualExpanded(!isExpanded);
  };

  if (!content && isComplete) return null;

  // Collapse multiple newlines into single newline (removes blank lines), let natural wrap handle it
  const processedContent = content.replace(/\n\n+/g, '\n');

  return (
    <div className="border rounded-lg my-1 overflow-hidden bg-card border-amber-500/30">
      {/* Header - matches ToolCallCard header style */}
      <div
        className={`${isLight
          ? "w-full flex items-center justify-between px-2 py-1.5 bg-amber-50 border-b border-amber-100 text-left"
          : "w-full flex items-center justify-between px-2 py-1.5 bg-amber-500/10 border-b border-amber-500/20 text-left"
        } cursor-pointer hover:opacity-80 transition-opacity`}
        onClick={toggleExpansion}
      >
        <div className={`flex items-center gap-1.5 ${isLight ? "text-amber-700" : "text-amber-200"}`}>
          <div className={`p-1 rounded ${isLight ? "bg-amber-100 border-amber-200" : "bg-amber-500/20 border-amber-500/30"}`}>
            <Brain size={12} className={!isComplete
              ? (isLight ? "text-amber-500 animate-pulse" : "text-amber-400 animate-pulse")
              : (isLight ? "text-amber-600" : "text-amber-300")
            } />
          </div>
          <span className={`text-[10px] font-semibold uppercase tracking-wider ${isLight ? "text-amber-700" : "text-amber-200"}`}>
            Thinking
          </span>
          {!isComplete && (
             <span className={`ml-1.5 inline-flex items-center text-[9px] font-medium ${isLight ? "text-amber-500" : "text-amber-400"}`}>
               <Loader2 size={9} className="mr-1 animate-spin" />
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
          {isExpanded ? (
            <ChevronDown size={14} className={isLight ? "text-amber-500" : "text-amber-400"} />
          ) : (
            <ChevronRight size={14} className={isLight ? "text-amber-500" : "text-amber-400"} />
          )}
        </div>
      </div>

      {/* Content - fixed height, scrollable, shows latest lines */}
      {isExpanded && (
        <div
          ref={contentRef}
          className="px-2.5 py-1.5 text-[10px] bg-muted/10 overflow-y-auto"
          style={{ maxHeight: '12em' }}
        >
          <div
            className={`whitespace-pre-wrap break-words leading-[1.45] ${isLight ? "text-amber-800" : "text-amber-100/90"}`}
          >
            {processedContent || "Thinking..."}
          </div>
        </div>
      )}
    </div>
  );
}
