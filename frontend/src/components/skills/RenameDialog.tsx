import { useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";

interface RenameDialogProps {
  open: boolean;
  title: string;
  label: string;
  placeholder: string;
  initialValue: string;
  onConfirm: (newName: string) => void;
  onCancel: () => void;
}

export function RenameDialog({
  open,
  title,
  label,
  placeholder,
  initialValue,
  onConfirm,
  onCancel,
}: RenameDialogProps) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setValue(initialValue);
      // Focus input after animation
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open, initialValue]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter' && value.trim()) onConfirm(value.trim());
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, value, onCancel, onConfirm]);

  if (!open) return null;

  return (
    <div
      className="rename-dialog-overlay"
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div className="rename-dialog" role="dialog" aria-modal="true" aria-labelledby="rename-title">
        {/* Header */}
        <div className="mb-5 flex items-center justify-between">
          <h2 id="rename-title" className="font-brand text-lg font-semibold tracking-tight">
            {title}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            aria-label="关闭"
          >
            <X size={18} />
          </button>
        </div>

        {/* Input */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-muted-foreground">
            {label}
          </label>
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            className="w-full rounded-xl border bg-background px-4 py-3 text-sm transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            autoComplete="off"
            spellCheck="false"
          />
        </div>

        {/* Actions */}
        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border px-5 py-2.5 text-sm font-medium transition-all duration-200 hover:bg-muted"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => value.trim() && onConfirm(value.trim())}
            disabled={!value.trim() || value.trim() === initialValue}
            className="rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-all duration-200 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="flex items-center gap-2">
              <Check size={16} />
              确认
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
