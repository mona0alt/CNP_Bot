interface SkillMarkdownPreviewProps {
  title: string;
  content: string;
}

export function SkillMarkdownPreview({ title, content }: SkillMarkdownPreviewProps) {
  return (
    <article className="rounded-lg border bg-card p-4">
      <h3 className="text-base font-semibold">{title}</h3>
      <div className="mt-3 rounded-md border bg-background p-3">
        {content.trim() ? (
          <pre className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{content}</pre>
        ) : (
          <p className="text-sm text-muted-foreground">暂无预览内容</p>
        )}
      </div>
    </article>
  );
}
