interface SkillFileEditorProps {
  path: string | null;
  content: string;
  editable: boolean;
  isDirty: boolean;
  isSaving: boolean;
  error: string;
  onChange: (next: string) => void;
  onSave: () => void;
}

export function SkillFileEditor({
  path,
  content,
  editable,
  isDirty,
  isSaving,
  error,
  onChange,
  onSave,
}: SkillFileEditorProps) {
  if (!path) {
    return (
      <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
        请选择左侧文件进行查看或编辑
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-mono text-sm text-muted-foreground">{path}</p>
          <p className="text-xs text-muted-foreground">{editable ? "可编辑文本文件" : "二进制文件，暂不支持在线编辑"}</p>
        </div>
        {editable && (
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

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </div>
      )}

      {editable ? (
        <textarea
          value={content}
          onChange={(event) => onChange(event.target.value)}
          onInput={(event) => onChange((event.target as HTMLTextAreaElement).value)}
          className="h-[520px] w-full rounded-md border bg-background p-3 font-mono text-sm outline-none ring-primary/40 focus:ring-2"
        />
      ) : (
        <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          当前文件不可编辑
        </div>
      )}
    </div>
  );
}
