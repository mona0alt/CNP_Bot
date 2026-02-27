import { useState, useEffect } from 'react';
import { Brain, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';

interface ThoughtProcessProps {
  content: string;
  isComplete: boolean;
  autoCollapse?: boolean; // Add prop to control auto-collapse behavior
}

export function ThoughtProcess({ content, isComplete, autoCollapse = true }: ThoughtProcessProps) {
  // Default open if not complete (streaming), closed if complete
  const [isOpen, setIsOpen] = useState(!isComplete);

  // Effect to handle auto-collapse when completion status changes
  useEffect(() => {
    if (isComplete && autoCollapse) {
      // Automatically collapse when thought process is complete
      setIsOpen(false);
    } else if (!isComplete) {
      // Expand when thought process starts
      setIsOpen(true);
    }
  }, [isComplete, autoCollapse]);

  if (!content && isComplete) return null;

  return (
    <div className="border rounded-md my-2 overflow-hidden bg-slate-50 border-slate-200/60 shadow-sm">
      <button
        className="w-full flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-slate-100/80 transition-colors text-left"
        onClick={() => setIsOpen(!isOpen)}
        type="button"
      >
        <div className="flex items-center gap-2 text-slate-600">
          <Brain size={16} className={!isComplete ? "text-blue-500 animate-pulse" : "text-slate-500"} />
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Thinking Process
          </span>
          {!isComplete && (
             <span className="ml-2 inline-flex items-center text-xs text-blue-500 font-medium">
               <Loader2 size={12} className="mr-1 animate-spin" />
               Thinking...
             </span>
          )}
        </div>
        <div className="text-slate-400">
          {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </button>

      {isOpen && (
        <div className="px-4 py-3 text-sm text-slate-600 border-t border-slate-200/60 bg-white/40">
          <MarkdownRenderer
            content={content || "(Empty thought process)"}
            className="prose-sm max-w-none text-slate-600 [&>p]:leading-relaxed [&>pre]:bg-slate-100 [&>pre]:border-slate-200"
          />
        </div>
      )}
    </div>
  );
}
