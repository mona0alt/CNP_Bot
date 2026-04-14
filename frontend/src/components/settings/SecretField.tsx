import { useState } from "react";
import { Copy, Eye, EyeOff } from "lucide-react";

type SecretFieldProps = {
  fieldKey: string;
  label: string;
  value: string;
  onChange: (key: string, value: string) => void;
  canCopyRealValue: boolean;
};

export function SecretField({
  fieldKey,
  label,
  value,
  onChange,
  canCopyRealValue,
}: SecretFieldProps) {
  const [isVisible, setIsVisible] = useState(false);

  const handleCopy = async () => {
    if (!navigator.clipboard?.writeText) return;
    await navigator.clipboard.writeText(value);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-stretch gap-1.5">
        <input
          id={`system-config-field-${fieldKey}`}
          type={isVisible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(fieldKey, event.target.value)}
          className="app-control min-w-0 flex-1 rounded-lg border border-border/60 bg-background px-2.5 py-1.5 text-[13px] focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
          autoComplete="new-password"
          aria-label={label}
        />
        <button
          type="button"
          onClick={() => setIsVisible((current) => !current)}
          className="app-control inline-flex shrink-0 items-center gap-1 rounded-lg border border-border/60 bg-background px-2 py-1 text-[12px] text-foreground transition-colors hover:bg-muted/50"
        >
          {isVisible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          {isVisible ? "隐藏" : "显示"}
        </button>
        {canCopyRealValue ? (
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="app-control inline-flex shrink-0 items-center gap-1 rounded-lg border border-border/60 bg-background px-2 py-1 text-[12px] text-foreground transition-colors hover:bg-muted/50"
          >
            <Copy className="h-3.5 w-3.5" />
            复制
          </button>
        ) : null}
      </div>
    </div>
  );
}
