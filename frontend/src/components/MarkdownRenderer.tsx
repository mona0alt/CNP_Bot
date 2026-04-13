import { useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus, solarizedlight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Copy, Check, Terminal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from '@/contexts/ThemeContext';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  const { theme } = useTheme();

  const components: Components = {
    code(props) {
      const inline = 'inline' in props ? (props as { inline?: boolean }).inline : undefined;
      const className = props.className as string | undefined;
      const children = props.children;
      const rest = { ...props };
      delete (rest as { inline?: boolean }).inline;
      const match = /language-(\w+)/.exec(className || '');
      const language = match ? match[1] : '';

      if (!inline && match) {
        return (
          <CodeBlock language={language} value={String(children).replace(/\n$/, '')} theme={theme} />
        );
      }

      return (
        <code className={cn("bg-muted px-1 py-0.5 rounded text-[11px] font-mono", className)} {...rest}>
          {children}
        </code>
      );
    },
    li(props) {
      const checked = 'checked' in props ? (props as { checked?: boolean | null }).checked : undefined;
      const { children, ...rest } = props;
      if (checked !== null && checked !== undefined) {
        return (
          <li {...rest} className="flex items-start gap-2 list-none my-1">
            <div className="mt-1 shrink-0">
              <input
                type="checkbox"
                checked={checked}
                readOnly
                className="h-3.5 w-3.5 rounded border-primary/50 text-primary focus:ring-primary bg-background"
              />
            </div>
            <div className="flex-1">{children}</div>
          </li>
        );
      }
      return <li {...rest}>{children}</li>;
    },
    a(props) {
      return <a target="_blank" rel="noopener noreferrer" className="text-primary underline hover:opacity-80 font-medium" {...props} />;
    },
    pre({ children }) {
      return <div className="not-prose">{children}</div>;
    },
    table({ children }) {
      return (
        <div className="overflow-x-auto my-2 rounded-md border">
          <table className="w-full text-[11px] text-left">{children}</table>
        </div>
      );
    },
    thead({ children }) {
      return <thead className="bg-muted text-muted-foreground uppercase text-[10px]">{children}</thead>;
    },
    th({ children }) {
      return <th className="px-3 py-1.5 font-medium border-b">{children}</th>;
    },
    td({ children }) {
      return <td className="px-3 py-1.5 border-b last:border-0">{children}</td>;
    }
  };

  const proseClass = theme === "dark" ? "prose-invert" : "";

  return (
    <div className={cn("prose prose-xs max-w-none break-words leading-relaxed", proseClass, className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function CodeBlock({ language, value, theme }: { language: string; value: string; theme: "dark" | "light" }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const codeStyle = theme === "dark" ? vscDarkPlus : solarizedlight;
  const isLight = theme === "light";

  return (
    <div className={cn(
      "rounded-md border border-border my-2 overflow-hidden w-full shadow-sm",
      isLight ? "bg-zinc-50 text-zinc-900" : "bg-zinc-950 text-zinc-50"
    )}>
      <div className={cn(
        "flex items-center justify-between px-3 py-1.5 border-b",
        isLight ? "bg-zinc-100 border-zinc-200" : "bg-zinc-900 border-zinc-800"
      )}>
        <div className={cn(
          "flex items-center gap-2 text-xs font-medium font-mono",
          isLight ? "text-zinc-500" : "text-zinc-400"
        )}>
          <Terminal size={12} />
          <span className="uppercase">{language}</span>
        </div>
        <button
          onClick={handleCopy}
          className={cn(
            "p-1 rounded transition-colors",
            isLight
              ? "hover:bg-zinc-200 text-zinc-500 hover:text-zinc-900"
              : "hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100"
          )}
          title="Copy code"
        >
          {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
        </button>
      </div>
      <div className="overflow-x-auto">
        <SyntaxHighlighter
          language={language}
          style={codeStyle}
          customStyle={{ margin: 0, padding: '0.75rem', background: 'transparent', fontSize: '0.75rem', lineHeight: '1.4' }}
          wrapLines={true}
          PreTag="div"
        >
          {value}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}
