import { useState } from "react";

interface ZipUploadDialogProps {
  open: boolean;
  onClose: () => void;
  onUpload: (file: File) => Promise<void>;
}

export function ZipUploadDialog({ open, onClose, onUpload }: ZipUploadDialogProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [isUploading, setIsUploading] = useState(false);

  if (!open) return null;

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-lg bg-background p-5 shadow-lg">
        <h2 className="text-lg font-semibold">上传 ZIP 技能包</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          需要包含 SKILL.md。若压缩包没有顶层目录，系统会自动使用 zip 文件名创建目录。
        </p>

        <input
          type="file"
          accept=".zip,application/zip"
          className="mt-4 block w-full text-sm"
          onChange={(event) => {
            setError("");
            setSelectedFile(event.target.files?.[0] ?? null);
          }}
        />

        {error && (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isUploading}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isUploading ? "上传中..." : "确认上传"}
          </button>
        </div>
      </div>
    </div>
  );
}
