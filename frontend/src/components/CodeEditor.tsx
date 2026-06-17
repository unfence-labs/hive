import { useEffect, useMemo, useRef } from "react";
import { EditorView, placeholder as cmPlaceholder } from "@codemirror/view";
import { EditorState, Compartment, type Extension } from "@codemirror/state";
import { minimalSetup } from "codemirror";
import { cn } from "@/lib/utils";

const appTheme = EditorView.theme(
  {
    "&": {
      fontSize: "13px",
      background: "transparent",
      border: "none",
      borderRadius: "0.5rem",
      overflow: "hidden",
      height: "100%",
    },
    "&.cm-focused": {
      outline: "2px solid var(--ring)",
      outlineOffset: "0px",
    },
    ".cm-scroller": {
      fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace",
      lineHeight: "1.6",
      background: "transparent",
    },
    ".cm-gutters": {
      display: "none",
    },
    ".cm-content": {
      padding: "0.75rem",
    },
  },
  { dark: true },
);

interface CodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  maxHeight?: string;
  placeholder?: string;
  extensions?: Extension[];
  ariaLabel?: string;
  className?: string;
}

export function CodeEditor({
  value,
  onChange,
  readOnly = false,
  maxHeight = "24rem",
  placeholder,
  extensions = [],
  ariaLabel,
  className,
}: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const readOnlyComp = useMemo(() => new Compartment(), []);
  const editableComp = useMemo(() => new Compartment(), []);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!containerRef.current) return;

    const editorExtensions = [
      minimalSetup,
      ...extensions,
      appTheme,
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
      editorExtensions.push(cmPlaceholder(placeholder));
    }

    if (ariaLabel) {
      editorExtensions.push(EditorView.contentAttributes.of({ "aria-label": ariaLabel }));
    }

    const view = new EditorView({
      state: EditorState.create({ doc: value, extensions: editorExtensions }),
      parent: containerRef.current,
    });

    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Extensions are intentionally mounted once; callers provide static editor configuration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: [
        readOnlyComp.reconfigure(EditorState.readOnly.of(readOnly)),
        editableComp.reconfigure(EditorView.editable.of(!readOnly)),
      ],
    });
  }, [editableComp, readOnly, readOnlyComp]);

  return (
    <div
      ref={containerRef}
      aria-disabled={readOnly}
      className={cn("rounded-lg border border-border/50 bg-card/50", className)}
      style={{ height: maxHeight, minHeight: "6rem", resize: "vertical", overflow: "hidden" }}
    />
  );
}
