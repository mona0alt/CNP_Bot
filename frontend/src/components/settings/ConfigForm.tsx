import { ConfigField } from "@/components/settings/ConfigField";

type SystemConfigField = {
  key: string;
  section: string;
  label: string;
  type: "text" | "number" | "toggle" | "select" | "secret";
  required: boolean;
  secret: boolean;
  restartRequired: boolean;
  defaultValue?: string;
  options?: Array<{ label: string; value: string }> | string[];
  dangerLevel?: "normal" | "warning" | "danger";
  dangerMessage?: string;
};

type SystemConfigSection = {
  id: string;
  title: string;
  fields: SystemConfigField[];
};

interface ConfigFormProps {
  sections: SystemConfigSection[];
  values: Record<string, string>;
  onFieldChange: (key: string, value: string) => void;
  activeSectionId?: string;
}

export function ConfigForm({
  sections,
  values,
  onFieldChange,
  activeSectionId,
}: ConfigFormProps) {
  if (sections.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border/50 bg-card/40 px-5 py-10 text-sm text-muted-foreground">
        当前没有可配置项。
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {sections.map((section) => {
        const isActive = section.id === activeSectionId;

        return (
          <section
            key={section.id}
            id={`system-config-section-${section.id}`}
            data-testid={`config-section-${section.id}`}
            className={`overflow-hidden rounded-2xl border bg-card/50 shadow-sm ${
              isActive ? "border-primary/30 ring-1 ring-primary/10" : "border-border/50"
            }`}
          >
            <div className="flex items-start justify-between gap-3 border-b border-border/40 px-5 py-4">
              <div className="min-w-0">
                <h3 className="font-brand text-base font-semibold tracking-tight text-foreground">
                  {section.title}
                </h3>
                <p className="mt-1 text-[12px] text-muted-foreground">
                  {section.fields.length} 个字段
                </p>
              </div>
            </div>

            <div>
              {section.fields.map((field) => (
                <ConfigField
                  key={field.key}
                  field={field}
                  value={values[field.key] ?? ""}
                  onChange={onFieldChange}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
