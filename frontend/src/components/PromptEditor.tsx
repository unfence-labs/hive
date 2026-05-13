import { useMemo } from "react";
import {
  EditorView,
  ViewPlugin,
  MatchDecorator,
  Decoration,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { oneDarkHighlightStyle } from "@codemirror/theme-one-dark";
import { syntaxHighlighting } from "@codemirror/language";
import { CodeEditor } from "@/components/CodeEditor";

// ── Template variable highlighting ─────────────────────────────────────

const templateVarMark = Decoration.mark({ class: "cm-template-var" });

const templateVarDecorator = new MatchDecorator({
  regexp: /\{[A-Z_][A-Z0-9_]*\}/g,
  decoration: () => templateVarMark,
});

const templateVarPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = templateVarDecorator.createDeco(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = templateVarDecorator.updateDeco(update, this.decorations);
      }
    }
  },
  { decorations: (instance) => instance.decorations },
);

const templateVarTheme = EditorView.theme({
  ".cm-template-var": {
    color: "var(--primary)",
    background: "hsl(from var(--primary) h s l / 0.15)",
    borderRadius: "3px",
    padding: "0 2px",
    fontWeight: "600",
  },
});

// ── Component ──────────────────────────────────────────────────────────

interface PromptEditorProps {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  maxHeight?: string;
  placeholder?: string;
}

export function PromptEditor({
  value,
  onChange,
  readOnly = false,
  maxHeight = "24rem",
  placeholder,
}: PromptEditorProps) {
  const extensions = useMemo(
    () => [
      markdown({ codeLanguages: languages }),
      syntaxHighlighting(oneDarkHighlightStyle),
      templateVarPlugin,
      templateVarTheme,
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
    />
  );
}
