import { SecretField } from "@/components/settings/SecretField";

type SystemConfigField = {
  key: string;
  section: string;
  label: string;
  type: "text" | "number" | "toggle" | "select" | "secret";
  required: boolean;
  secret: boolean;
  restartRequired: boolean;
  canCopySecret?: boolean;
  defaultValue?: string;
  options?: Array<{ label: string; value: string }> | string[];
  dangerLevel?: "normal" | "warning" | "danger";
  dangerMessage?: string;
};

interface ConfigFieldProps {
  field: SystemConfigField;
  value: string;
  onChange: (key: string, value: string) => void;
}

function resolveOptions(options: SystemConfigField["options"]): Array<{ label: string; value: string }> {
  if (!options) return [];
  return options.map((option) => (typeof option === "string" ? { label: option, value: option } : option));
}

export function ConfigField({ field, value, onChange }: ConfigFieldProps) {
  const inputId = `system-config-field-${field.key}`;
  const options = resolveOptions(field.options);
  const isSecret = field.secret || field.type === "secret";
  const isToggleOn = value === "true";

  return (
    <div
      className="grid gap-2 border-b border-border/40 px-4 py-3 last:border-b-0 md:grid-cols-[minmax(0,1fr)_280px]"
      data-testid={`config-field-${field.key}`}
    >
      <div className="min-w-0">
        <label htmlFor={inputId} className="block text-[13px] font-medium text-foreground">
          {field.label}
          {field.required ? <span className="ml-1 text-red-500">*</span> : null}
        </label>
        {field.dangerMessage ? (
          <p className="mt-0.5 text-[11px] leading-4 text-amber-600">{field.dangerMessage}</p>
        ) : isSecret ? (
          <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">该项以密码输入展示。</p>
        ) : null}
      </div>

      <div className="min-w-0">
        {field.type === "select" ? (
          <select
            id={inputId}
            value={value}
            onChange={(event) => onChange(field.key, event.target.value)}
            className="app-control w-full rounded-lg border border-border/60 bg-background px-2.5 py-1.5 text-[13px] focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            <option value="" disabled>
              请选择
            </option>
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : field.type === "toggle" ? (
          <button
            id={inputId}
            type="button"
            role="switch"
            aria-checked={isToggleOn}
            aria-label={field.label}
            onClick={() => onChange(field.key, isToggleOn ? "false" : "true")}
            className={`inline-flex h-7 w-12 items-center rounded-full px-0.5 transition-colors ${
              isToggleOn ? "bg-primary" : "bg-muted"
            }`}
          >
            <span
              className={`h-5 w-5 rounded-full bg-background shadow-sm transition-transform ${
                isToggleOn ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        ) : isSecret ? (
          <SecretField
            fieldKey={field.key}
            label={field.label}
            value={value}
            onChange={onChange}
            canCopyRealValue={field.canCopySecret ?? false}
          />
        ) : (
          <input
            id={inputId}
            type={isSecret ? "password" : field.type === "number" ? "number" : "text"}
            inputMode={field.type === "number" ? "numeric" : undefined}
            value={value}
            onChange={(event) => onChange(field.key, event.target.value)}
            className="app-control w-full rounded-lg border border-border/60 bg-background px-2.5 py-1.5 text-[13px] focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
            autoComplete={isSecret ? "new-password" : "off"}
          />
        )}
      </div>
    </div>
  );
}
