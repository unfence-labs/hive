import { memo, useCallback, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { FileTextIcon } from "lucide-react";
import { FileDiff } from "@pierre/diffs/react";
import {
  getFiletypeFromFileName,
  preloadHighlighter,
  type DiffLineAnnotation,
  type FileDiffMetadata,
  type SelectedLineRange,
} from "@pierre/diffs";
import { cn } from "@/lib/utils";

const UNSAFE_CSS =
  "pre { font-family: var(--font-mono, ui-monospace, monospace) !important; font-size: 13px !important; line-height: 1.5 !important; }";
const DIFF_THEMES = { dark: "github-dark", light: "github-light" } as const;
type HighlighterStatus = "loading" | "ready" | "error";
interface HighlighterResource {
  getSnapshot: () => HighlighterStatus;
  subscribe: (listener: () => void) => () => void;
}

const highlighterResources = new Map<string, HighlighterResource>();

function getHighlighterResource(fileName: string): HighlighterResource {
  const language = getFiletypeFromFileName(fileName);
  const cachedResource = highlighterResources.get(language);
  if (cachedResource) return cachedResource;

  let status: HighlighterStatus = "loading";
  let started = false;
  const listeners = new Set<() => void>();
  const updateStatus = (nextStatus: HighlighterStatus) => {
    status = nextStatus;
    listeners.forEach((listener) => listener());
  };
  const start = () => {
    if (started) return;
    started = true;

    preloadHighlighter({
      themes: [DIFF_THEMES.dark, DIFF_THEMES.light],
      langs: [language],
    }).then(
      () => updateStatus("ready"),
      () => {
        highlighterResources.delete(language);
        updateStatus("error");
      },
    );
  };

  const resource: HighlighterResource = {
    getSnapshot: () => status,
    subscribe: (listener) => {
      listeners.add(listener);
      start();
      return () => listeners.delete(listener);
    },
  };
  highlighterResources.set(language, resource);

  return resource;
}

function diffStatusColor(type: string): string {
  switch (type) {
    case "new":
      return "text-success-foreground";
    case "deleted":
      return "text-destructive";
    case "rename-pure":
    case "rename-changed":
      return "text-warning-foreground";
    default:
      return "text-info-foreground";
  }
}

export interface FileDiffCardProps<TMeta = unknown> {
  fileDiff: FileDiffMetadata;
  fileName: string;
  additions: number;
  deletions: number;
  themeType: "dark" | "light";
  diffStyle: "split" | "unified";
  annotations?: DiffLineAnnotation<TMeta>[];
  selectedLines?: SelectedLineRange | null;
  onLineSelected?: (range: SelectedLineRange | null) => void;
  renderAnnotation?: (annotation: DiffLineAnnotation<TMeta>) => ReactNode;
}

/**
 * Render a single parsed diff file as a bordered card with a sticky header.
 * Shared by the workspace and Brain inline diff viewers so diff rendering,
 * theming, and header layout stay consistent.
 */
function FileDiffCardComponent<TMeta>({
  fileDiff,
  fileName,
  additions,
  deletions,
  themeType,
  diffStyle,
  annotations,
  selectedLines = null,
  onLineSelected,
  renderAnnotation,
}: FileDiffCardProps<TMeta>) {
  const highlighterResource = getHighlighterResource(fileName);
  const highlighterStatus = useSyncExternalStore(
    highlighterResource.subscribe,
    highlighterResource.getSnapshot,
    highlighterResource.getSnapshot,
  );

  const options = useMemo(
    () => ({
      theme: DIFF_THEMES,
      themeType,
      diffStyle,
      enableLineSelection: Boolean(onLineSelected),
      onLineSelected,
      disableFileHeader: true,
      unsafeCSS: UNSAFE_CSS,
    }),
    [themeType, diffStyle, onLineSelected],
  );

  const isEmpty =
    fileDiff.hunks.length === 0 ||
    fileDiff.hunks.every((h) => h.hunkContent.length === 0);

  const renderAnnotationCb = useCallback(
    (annotation: DiffLineAnnotation<TMeta>) =>
      renderAnnotation ? renderAnnotation(annotation) : null,
    [renderAnnotation],
  );

  return (
    <div className="border border-border/50">
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border/50 bg-muted px-3 py-2">
        <FileTextIcon className={cn("h-[1em] w-[1em] shrink-0", diffStatusColor(fileDiff.type))} />
        <span className="truncate">{fileName}</span>
        {fileDiff.prevName && fileDiff.prevName !== fileName && (
          <span className="truncate text-muted-foreground">&larr; {fileDiff.prevName}</span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {additions > 0 && <span className="text-success-foreground">+{additions}</span>}
          {deletions > 0 && <span className="text-destructive">-{deletions}</span>}
        </div>
      </div>
      {isEmpty ? (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">Empty file</div>
      ) : highlighterStatus === "error" ? (
        <div className="px-4 py-8 text-center text-sm text-destructive">
          Unable to load syntax highlighting
        </div>
      ) : highlighterStatus === "loading" ? (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">Loading diff...</div>
      ) : (
        <FileDiff
          fileDiff={fileDiff}
          lineAnnotations={annotations}
          selectedLines={selectedLines}
          options={options}
          renderAnnotation={renderAnnotation ? renderAnnotationCb : undefined}
        />
      )}
    </div>
  );
}

export const FileDiffCard = memo(FileDiffCardComponent) as typeof FileDiffCardComponent;
