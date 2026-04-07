import { useCallback, useState } from "react";
import { Upload, X, FileArchive, CheckCircle2, AlertCircle } from "lucide-react";

interface ZipUploadDialogProps {
  open: boolean;
  onClose: () => void;
  onUpload: (file: File) => Promise<void>;
}

export function ZipUploadDialog({ open, onClose, onUpload }: ZipUploadDialogProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const handleClose = useCallback(() => {
    if (!isUploading) {
      setSelectedFile(null);
      setError("");
      onClose();
    }
  }, [isUploading, onClose]);

  const handleSubmit = async () => {
    if (!selectedFile) {
      setError("请先选择 zip 文件");
      return;
    }

    setError("");
    setIsUploading(true);
    try {
      await onUpload(selectedFile);
      setSelectedFile(null);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "上传失败");
    } finally {
      setIsUploading(false);
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.zip')) {
      setSelectedFile(file);
      setError("");
    } else {
      setError("请上传 zip 格式的文件");
    }
  }, []);

  if (!open) return null;

  return (
    <div
      className="rename-dialog-overlay"
      onClick={(e) => e.target === e.currentTarget && handleClose()}
    >
      <div className="rename-dialog" role="dialog" aria-modal="true" aria-labelledby="upload-title">
        {/* Header */}
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
              <Upload size={20} className="text-primary" />
            </div>
            <div>
              <h2 id="upload-title" className="font-brand text-lg font-semibold tracking-tight">
                上传 ZIP 技能包
              </h2>
              <p className="text-xs text-muted-foreground">支持 .zip 格式压缩包</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={isUploading}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50"
            aria-label="关闭"
          >
            <X size={18} />
          </button>
        </div>

        {/* Drop zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
          className={`
            relative rounded-2xl border-2 border-dashed p-8 text-center transition-all duration-200
            ${isDragOver
              ? 'border-primary bg-primary/5'
              : selectedFile
                ? 'border-green-400/50 bg-green-500/5'
                : 'border-muted hover:border-muted-foreground/30'
            }
          `}
        >
          <input
            type="file"
            accept=".zip,application/zip"
            id="zip-upload-input"
            className="absolute inset-0 cursor-pointer opacity-0"
            onChange={(event) => {
              setError("");
              const file = event.target.files?.[0] ?? null;
              setSelectedFile(file);
              if (file && !file.name.endsWith('.zip')) {
                setError("请上传 zip 格式的文件");
                setSelectedFile(null);
              }
            }}
            disabled={isUploading}
          />

          {selectedFile ? (
            <div className="flex flex-col items-center gap-3">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-green-500/10">
                <FileArchive size={28} className="text-green-500" />
              </div>
              <div>
                <p className="font-medium text-foreground">{selectedFile.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {(selectedFile.size / 1024).toFixed(1)} KB
                </p>
              </div>
              <div className="flex items-center gap-1.5 rounded-full bg-green-500/10 px-3 py-1">
                <CheckCircle2 size={14} className="text-green-500" />
                <span className="text-xs font-medium text-green-600 dark:text-green-400">已选择文件</span>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
                <Upload size={28} className="text-muted-foreground" />
              </div>
              <div>
                <p className="font-medium text-foreground">点击或拖拽上传</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  压缩包需包含 SKILL.md 文件
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Helper text */}
        <p className="mt-3 text-center text-xs text-muted-foreground">
          若压缩包没有顶层目录，系统会自动使用 zip 文件名作为技能名称
        </p>

        {/* Error */}
        {error && (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-red-200/50 bg-red-500/10 px-4 py-3">
            <AlertCircle size={16} className="text-red-500 shrink-0" />
            <p className="text-sm text-red-500">{error}</p>
          </div>
        )}

        {/* Actions */}
        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={handleClose}
            disabled={isUploading}
            className="rounded-xl border px-5 py-2.5 text-sm font-medium transition-all hover:bg-muted disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!selectedFile || isUploading}
            className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-all hover:shadow-xl hover:shadow-primary/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isUploading ? (
              <span className="flex items-center gap-2">
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                上传中...
              </span>
            ) : (
              "确认上传"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
