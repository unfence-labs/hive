import { useMemo } from "react";
import { StreamLanguage, syntaxHighlighting } from "@codemirror/language";
import { properties } from "@codemirror/legacy-modes/mode/properties";
import { oneDarkHighlightStyle } from "@codemirror/theme-one-dark";
import { CodeEditor } from "@/components/CodeEditor";

interface EnvEditorProps {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  maxHeight?: string;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
}

export function EnvEditor({
  value,
  onChange,
  readOnly = false,
  maxHeight = "10rem",
  placeholder = "DATABASE_URL=...\nAPI_KEY=...",
  ariaLabel = "Environment variables",
  className,
}: EnvEditorProps) {
  const extensions = useMemo(
    () => [
      // .env files follow the same core shape as properties files: comments plus KEY=VALUE pairs.
      StreamLanguage.define(properties),
      syntaxHighlighting(oneDarkHighlightStyle),
    ],
    [],
  );

  return (
    <CodeEditor
      value={value}
      onChange={onChange}
      readOnly={readOnly}
      maxHeight={maxHeight}
      placeholder={placeholder}
      extensions={extensions}
      ariaLabel={ariaLabel}
      className={className}
    />
  );
}
