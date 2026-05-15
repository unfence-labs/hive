import type { ReactNode } from "react";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import { cn } from "@/lib/utils";

export function SettingsEditorFrame({
  title,
  badge,
  description,
  providers,
  banner,
  value,
  onChange,
  placeholder,
  ariaLabel,
  actions,
}: {
  title: string;
  badge: ReactNode;
  description?: string;
  providers?: ReactNode;
  banner?: ReactNode;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel: string;
  actions: ReactNode;
}) {
  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden px-5 pt-5 pb-2">
      <div className="mb-4 shrink-0">
        <div className="flex items-center gap-2">
          <h2 className="min-w-0 truncate text-base font-medium text-foreground">
            {title}
          </h2>
          {badge}
        </div>
        {description && (
          <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
            {description}
          </p>
        )}
        {providers && <div className="mt-3 flex flex-wrap gap-2">{providers}</div>}
      </div>

      {banner}

      <div className={cn("min-h-0 flex-1", banner && "mt-3")}>
        <MarkdownEditor
          value={value}
          onChange={onChange}
          maxHeight="100%"
          placeholder={placeholder}
          ariaLabel={ariaLabel}
        />
      </div>

      <div className="mt-4 flex shrink-0 items-center gap-2">
        {actions}
      </div>
    </div>
  );
}
