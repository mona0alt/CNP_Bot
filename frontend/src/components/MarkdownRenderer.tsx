import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Copy, Check, Terminal } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  return (
    <div className={cn("prose prose-sm max-w-none dark:prose-invert break-words leading-normal", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ inline, className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '');
            const language = match ? match[1] : '';

            if (!inline && match) {
              return (
                <CodeBlock language={language} value={String(children).replace(/\n$/, '')} />
              );
            }

            return (
              <code className={cn("bg-muted px-1.5 py-0.5 rounded text-sm font-mono", className)} {...props}>
                {children}
              </code>
            );
          },
          li(props) {
            const { children, checked, ...rest } = props;
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
                )
            }
            return <li {...props}>{children}</li>
          },
          a(props) {
              return <a target="_blank" rel="noopener noreferrer" className="text-primary underline hover:opacity-80 font-medium" {...props} />
          },
          pre({ children }) {
              return <div className="not-prose">{children}</div>
          },
          table({ children }) {
              return (
                  <div className="overflow-x-auto my-4 rounded-md border">
                      <table className="w-full text-sm text-left">{children}</table>
                  </div>
              )
          },
          thead({ children }) {
              return <thead className="bg-muted text-muted-foreground uppercase text-xs">{children}</thead>
          },
          th({ children }) {
              return <th className="px-4 py-2 font-medium border-b">{children}</th>
          },
          td({ children }) {
              return <td className="px-4 py-2 border-b last:border-0">{children}</td>
          }
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function CodeBlock({ language, value }: { language: string; value: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-md border border-border my-2 overflow-hidden w-full bg-zinc-950 text-zinc-50 shadow-sm">
      <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-900 border-b border-zinc-800">
        <div className="flex items-center gap-2 text-xs text-zinc-400 font-medium font-mono">
          <Terminal size={12} />
          <span className="uppercase">{language}</span>
        </div>
        <button
          onClick={handleCopy}
          className="p-1 hover:bg-zinc-800 rounded transition-colors text-zinc-400 hover:text-zinc-100"
          title="Copy code"
        >
          {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
        </button>
      </div>
      <div className="overflow-x-auto">
        <SyntaxHighlighter
          language={language}
          style={vscDarkPlus}
          customStyle={{ margin: 0, padding: '1rem', background: 'transparent', fontSize: '0.85rem', lineHeight: '1.5' }}
          wrapLines={true}
          PreTag="div"
        >
          {value}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}