import { useEffect, useMemo, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark, oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";

import { cn } from "@/lib/utils";

interface SkillFileEditorProps {
  path: string | null;
  content: string;
  editable: boolean;
  readOnly?: boolean;
  isDirty: boolean;
  isSaving: boolean;
  error: string;
  onChange: (next: string) => void;
  onSave: () => void;
}

type ViewMode = "edit" | "preview";

function extOf(path: string | null): string {
  if (!path) return "";
  const name = path.split("/").pop() ?? "";
  const idx = name.lastIndexOf(".");
  if (idx < 0 || idx === name.length - 1) return "";
  return name.slice(idx + 1).toLowerCase();
}

function isMarkdownExt(ext: string): boolean {
  return ext === "md" || ext === "markdown" || ext === "mdx";
}

function MarkdownPreview({ markdown }: { markdown: string }) {
  const components: Components = {
    pre({ children }) {
      return <div className="not-prose">{children}</div>;
    },
    code(props) {
      const inline = "inline" in props ? (props as { inline?: boolean }).inline : undefined;
      const className = props.className as string | undefined;
      const children = props.children;
      const match = /language-(\w+)/.exec(className || "");
      if (!inline && match) {
        return (
          <SyntaxHighlighter
            language={match[1]}
            style={oneDark}
            customStyle={{
              margin: "0.5rem 0",
              borderRadius: "0.5rem",
              padding: "0.75rem",
              fontSize: "0.85rem",
            }}
            wrapLines
            PreTag="div"
          >
            {String(children).replace(/\n$/, "")}
          </SyntaxHighlighter>
        );
      }
      return <code className={cn("rounded bg-muted px-1 py-0.5 font-mono text-sm", className)}>{children}</code>;
    },
    table({ children }) {
      return (
        <div className="my-3 overflow-x-auto rounded-md border">
          <table className="w-full text-left text-sm">{children}</table>
        </div>
      );
    },
    th({ children }) {
      return <th className="border-b bg-muted px-3 py-2 font-medium">{children}</th>;
    },
    td({ children }) {
      return <td className="border-b px-3 py-2 align-top">{children}</td>;
    },
  };

  return (
    <div className="prose prose-sm max-w-none dark:prose-invert">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

export function SkillFileEditor({
  path,
  content,
  editable,
  readOnly = false,
  isDirty,
  isSaving,
  error,
  onChange,
  onSave,
}: SkillFileEditorProps) {
  const ext = extOf(path);
  const canPrettyPreview = isMarkdownExt(ext) || ext === "json";
  const [mode, setMode] = useState<ViewMode>(editable && !readOnly ? "edit" : "preview");
  const syntaxStyle = document.documentElement.classList.contains("dark") ? oneDark : oneLight;

  useEffect(() => {
    setMode(editable && !readOnly ? "edit" : "preview");
  }, [editable, readOnly, path]);

  const renderedJson = useMemo(() => {
    if (ext !== "json") return content;
    try {
      return JSON.stringify(JSON.parse(content), null, 2);
    } catch {
      return content;
    }
  }, [content, ext]);

  if (!path) {
    return (
      <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
        请选择左侧文件进行查看或编辑
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-mono text-sm text-muted-foreground">{path}</p>
          <p className="text-xs text-muted-foreground">
            {readOnly
              ? "只读文本内容"
              : editable
                ? "可编辑文本文件"
                : "二进制文件，暂不支持在线编辑"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {editable && !readOnly && canPrettyPreview && (
            <div className="inline-flex rounded-md border p-0.5">
              <button
                type="button"
                onClick={() => setMode("edit")}
                className={cn(
                  "rounded px-2 py-1 text-xs transition-colors",
                  mode === "edit" ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                )}
              >
                编辑
              </button>
              <button
                type="button"
                onClick={() => setMode("preview")}
                className={cn(
                  "rounded px-2 py-1 text-xs transition-colors",
                  mode === "preview" ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                )}
              >
                预览
              </button>
            </div>
          )}
          {editable && !readOnly && (
            <button
              type="button"
              onClick={onSave}
              disabled={!isDirty || isSaving}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving ? "保存中..." : "保存"}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </div>
      )}

      {editable || readOnly ? (
        <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-background">
          {((readOnly || mode === "preview") && isMarkdownExt(ext)) ? (
            <div className="h-full overflow-auto p-4">
              <MarkdownPreview markdown={content} />
            </div>
          ) : ((readOnly || mode === "preview") && ext === "json") ? (
            <SyntaxHighlighter
              language="json"
              style={syntaxStyle}
              customStyle={{
                margin: 0,
                minHeight: "100%",
                borderRadius: 0,
                padding: "1rem",
                fontSize: "0.85rem",
              }}
              wrapLines
              showLineNumbers
              PreTag="div"
            >
              {renderedJson}
            </SyntaxHighlighter>
          ) : (
            <textarea
              value={content}
              onChange={(event) => onChange(event.target.value)}
              onInput={(event) => onChange((event.target as HTMLTextAreaElement).value)}
              readOnly={readOnly || !editable}
              className="h-full min-h-[60vh] w-full resize-none bg-background p-3 font-mono text-sm outline-none ring-primary/40 focus:ring-2"
            />
          )}
        </div>
      ) : (
        <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          当前文件不可编辑
        </div>
      )}
    </div>
  );
}
