import { useEffect, useRef } from "react";
import {
  EditorView,
  ViewPlugin,
  MatchDecorator,
  Decoration,
  type DecorationSet,
  type ViewUpdate,
  placeholder as cmPlaceholder,
} from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { minimalSetup } from "codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { oneDark } from "@codemirror/theme-one-dark";

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

// ── Theme overrides to match app palette ───────────────────────────────

const appTheme = EditorView.theme(
  {
    "&": {
      fontSize: "13px",
      borderRadius: "0.5rem",
      border: "1px solid hsl(0 0% 100% / 0.08)",
      overflow: "hidden",
      height: "100%",
    },
    "&.cm-focused": {
      outline: "2px solid hsl(var(--ring))",
      outlineOffset: "-1px",
    },
    ".cm-scroller": {
      fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace",
      lineHeight: "1.6",
    },
    ".cm-gutters": {
      display: "none",
    },
    ".cm-content": {
      padding: "0.75rem",
    },
    ".cm-template-var": {
      color: "var(--primary)",
      background: "hsl(from var(--primary) h s l / 0.15)",
      borderRadius: "3px",
      padding: "0 2px",
      fontWeight: "600",
    },
  },
  { dark: true },
);

// ── Compartments for dynamic reconfiguration ───────────────────────────

const readOnlyComp = new Compartment();
const editableComp = new Compartment();

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
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // Keep onChange stable across renders without recreating the view
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Mount editor once
  useEffect(() => {
    if (!containerRef.current) return;

    const extensions = [
      minimalSetup,
      markdown({ codeLanguages: languages }),
      oneDark,
      appTheme,
      templateVarPlugin,
      EditorView.lineWrapping,
      readOnlyComp.of(EditorState.readOnly.of(readOnly)),
      editableComp.of(EditorView.editable.of(!readOnly)),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && onChangeRef.current) {
          onChangeRef.current(update.state.doc.toString());
        }
      }),
    ];

    if (placeholder) {
      extensions.push(cmPlaceholder(placeholder));
    }

    const view = new EditorView({
      state: EditorState.create({ doc: value, extensions }),
      parent: containerRef.current,
    });

    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync external value → editor (skip if editor already matches)
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
  }, [value]);

  // Sync readOnly prop
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: [
        readOnlyComp.reconfigure(EditorState.readOnly.of(readOnly)),
        editableComp.reconfigure(EditorView.editable.of(!readOnly)),
      ],
    });
  }, [readOnly]);

  return (
    <div
      ref={containerRef}
      className="rounded-lg"
      style={{ height: maxHeight, minHeight: "6rem", resize: "vertical", overflow: "hidden" }}
    />
  );
}
