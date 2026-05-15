import type { ReactNode } from "react";
import { StreamLanguage } from "@codemirror/language";
import { syntaxHighlighting } from "@codemirror/language";
import { oneDarkHighlightStyle } from "@codemirror/theme-one-dark";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import { CodeEditor } from "@/components/CodeEditor";
import { cn } from "@/lib/utils";

const TOML_EXTENSIONS = [
  StreamLanguage.define(toml),
  syntaxHighlighting(oneDarkHighlightStyle),
];

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
  language = "markdown",
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
  language?: "markdown" | "toml";
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
        {language === "toml" ? (
          <CodeEditor
            value={value}
            onChange={onChange}
            maxHeight="100%"
            placeholder={placeholder}
            ariaLabel={ariaLabel}
            extensions={TOML_EXTENSIONS}
          />
        ) : (
          <MarkdownEditor
            value={value}
            onChange={onChange}
            maxHeight="100%"
            placeholder={placeholder}
            ariaLabel={ariaLabel}
          />
        )}
      </div>

      <div className="mt-4 flex shrink-0 items-center gap-2">
        {actions}
      </div>
    </div>
  );
}
