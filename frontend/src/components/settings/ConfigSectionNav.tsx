import { Layers3 } from "lucide-react";

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

interface ConfigSectionNavProps {
  sections: SystemConfigSection[];
  activeSectionId: string;
  onSectionSelect: (sectionId: string) => void;
  className?: string;
}

export function ConfigSectionNav({
  sections,
  activeSectionId,
  onSectionSelect,
  className = "",
}: ConfigSectionNavProps) {
  const totalFields = sections.reduce((count, section) => count + section.fields.length, 0);

  return (
    <aside
      className={`flex min-h-0 flex-col rounded-xl border border-border/50 bg-card/50 shadow-sm ${className}`}
      data-testid="config-section-nav"
    >
      <div className="border-b border-border/40 px-3 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Layers3 className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0">
            <h2 className="font-brand text-[13px] font-semibold tracking-tight">配置分组</h2>
            <p className="text-[11px] text-muted-foreground">共 {sections.length} 组 · {totalFields} 项</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-1.5">
        <div className="space-y-0.5">
          {sections.map((section) => {
            const isActive = section.id === activeSectionId;
            return (
              <button
                key={section.id}
                type="button"
                data-testid={`config-section-nav-${section.id}`}
                aria-current={isActive ? "page" : undefined}
                onClick={() => onSectionSelect(section.id)}
                className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left transition-colors ${
                  isActive
                    ? "bg-primary/10 text-primary ring-1 ring-primary/20"
                    : "hover:bg-muted/50"
                }`}
              >
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium">{section.title}</div>
                  <div className="text-[11px] text-muted-foreground">{section.fields.length} 个字段</div>
                </div>
                <div
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    isActive ? "bg-primary" : "bg-muted-foreground/30"
                  }`}
                />
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
