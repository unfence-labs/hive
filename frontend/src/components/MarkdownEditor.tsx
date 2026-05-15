import { useMemo } from "react";
import { markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { oneDarkHighlightStyle } from "@codemirror/theme-one-dark";
import { syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { CodeEditor } from "@/components/CodeEditor";

interface MarkdownEditorProps {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  maxHeight?: string;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  extraExtensions?: Extension[];
}

export function MarkdownEditor({
  value,
  onChange,
  readOnly = false,
  maxHeight = "24rem",
  placeholder,
  ariaLabel,
  className,
  extraExtensions = [],
}: MarkdownEditorProps) {
  const extensions = useMemo(
    () => [
      markdown({ codeLanguages: languages }),
      syntaxHighlighting(oneDarkHighlightStyle),
      ...extraExtensions,
    ],
    [extraExtensions],
  );

  return (
    <CodeEditor
      value={value}
      onChange={onChange}
      readOnly={readOnly}
      maxHeight={maxHeight}
      placeholder={placeholder}
      ariaLabel={ariaLabel}
      className={className}
      extensions={extensions}
    />
  );
}
