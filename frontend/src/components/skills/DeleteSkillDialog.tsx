import { useEffect, useRef } from "react";
import { AlertTriangle } from "lucide-react";

interface DeleteSkillDialogProps {
  open: boolean;
  skillName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteSkillDialog({
  open,
  skillName,
  onConfirm,
  onCancel,
}: DeleteSkillDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) {
      // Focus cancel for safety
      setTimeout(() => cancelRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="rename-dialog-overlay"
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div className="rename-dialog max-w-sm" role="dialog" aria-modal="true" aria-labelledby="delete-title">
        {/* Warning icon */}
        <div className="mb-5 flex flex-col items-center text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-500/10">
            <AlertTriangle size={32} className="text-red-500" />
          </div>
          <h2 id="delete-title" className="font-brand text-xl font-semibold tracking-tight">
            删除技能
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            确定要删除技能 <span className="font-mono font-semibold text-foreground">{skillName}</span> 吗？
          </p>
          <p className="mt-1 text-xs text-red-500/80">
            此操作不可恢复，所有会话绑定将被解除
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="rounded-xl border px-5 py-2.5 text-sm font-medium transition-all hover:bg-muted"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-xl bg-red-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-red-500/20 transition-all hover:bg-red-600 hover:shadow-red-500/30"
          >
            确认删除
          </button>
        </div>
      </div>
    </div>
  );
}
