import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangleIcon,
  CheckIcon,
  CloudUploadIcon,
  CodeIcon,
  EyeIcon,
  Loader2Icon,
} from "lucide-react";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import { MessageResponse } from "@/components/ai-elements/message";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Debounce (ms) before flushing edits to disk via PUT /api/brain/file. */
const DISK_WRITE_DEBOUNCE_MS = 600;

export type BrainSaveIndicator = "idle" | "saving" | "saved" | "push-failed";

type ViewMode = "rendered" | "raw";

interface BrainEditorPanelProps {
  /** Currently open file path, or null when nothing is selected. */
  filePath: string | null;
  /** Content loaded from disk for the open file (server-fetched). */
  loadedContent: string;
  /** Whether the file content is loading. */
  isLoadingContent: boolean;
  /** Number of files with pending git changes (drives the Save badge). */
  pendingCount: number;
  /** Outcome indicator for the last git save. */
  saveIndicator: BrainSaveIndicator;
  /**
   * Persist edited content to disk (working tree only — NOT a git commit).
   * Called debounced as the user types.
   */
  onWriteToDisk: (path: string, content: string) => void;
  /** Open the review/diff panel to commit + push. */
  onRequestReview: () => void;
}

/**
 * Central Brain panel: edit notes (Raw markdown or rendered preview) and trigger
 * the two-stage Save flow.
 *
 * Two distinct persistence levels (do not conflate them):
 *  1. Disk write (working tree) — automatic + debounced as you type. This is NOT
 *     git; it only prevents losing work.
 *  2. Git save (commit + push) — manual, via the Save button, after reviewing
 *     the diff. This is the backup to the remote.
 */
export function BrainEditorPanel({
  filePath,
  loadedContent,
  isLoadingContent,
  pendingCount,
  saveIndicator,
  onWriteToDisk,
  onRequestReview,
}: BrainEditorPanelProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("rendered");
  const [buffer, setBuffer] = useState(loadedContent);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The latest not-yet-persisted edit, captured with the path it belongs to so a
  // flush always writes to the correct file even after the selection changed.
  const pendingRef = useRef<{ path: string; content: string } | null>(null);
  const filePathRef = useRef(filePath);
  filePathRef.current = filePath;

  // Immediately persist any pending debounced edit. Safe to call repeatedly.
  const flush = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    const pending = pendingRef.current;
    if (pending) {
      pendingRef.current = null;
      onWriteToDisk(pending.path, pending.content);
    }
  }, [onWriteToDisk]);

  // Reset the buffer whenever the loaded file changes (new selection or refetch).
  useEffect(() => {
    setBuffer(loadedContent);
  }, [loadedContent, filePath]);

  // Flush the pending write of the *previous* file before switching, and on
  // unmount, so no edit is lost inside the debounce window.
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    return () => {
      flushRef.current();
    };
  }, [filePath]);

  const handleChange = useCallback(
    (next: string) => {
      setBuffer(next);
      const path = filePathRef.current;
      if (!path) return;
      pendingRef.current = { path, content: next };
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        const pending = pendingRef.current;
        pendingRef.current = null;
        if (pending) onWriteToDisk(pending.path, pending.content);
      }, DISK_WRITE_DEBOUNCE_MS);
    },
    [onWriteToDisk],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Toolbar */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border/50 px-4">
        <div
          role="group"
          aria-label="Editor view mode"
          className="flex items-center rounded-md border border-border p-0.5"
        >
          <button
            type="button"
            aria-pressed={viewMode === "rendered"}
            onClick={() => setViewMode("rendered")}
            className={cn(
              "flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              viewMode === "rendered"
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <EyeIcon className="size-3.5" aria-hidden="true" />
            Rendered
          </button>
          <button
            type="button"
            aria-pressed={viewMode === "raw"}
            onClick={() => setViewMode("raw")}
            className={cn(
              "flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              viewMode === "raw"
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <CodeIcon className="size-3.5" aria-hidden="true" />
            Raw
          </button>
        </div>

        {filePath && (
          <span className="truncate text-xs text-muted-foreground">{filePath}</span>
        )}

        <div className="ml-auto flex items-center gap-2">
          <SaveStatus indicator={saveIndicator} />
          <Button
            size="sm"
            variant="outline"
            className="cursor-pointer"
            onClick={onRequestReview}
            disabled={pendingCount === 0}
          >
            <CloudUploadIcon className="size-3.5" aria-hidden="true" />
            Save
            {pendingCount > 0 && (
              <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-[10px]">
                {pendingCount}
              </Badge>
            )}
          </Button>
        </div>
      </div>

      {/* Editor / preview */}
      <div className="min-h-0 flex-1 overflow-auto">
        {!filePath ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Select a note from the tree, or create a new one.
          </div>
        ) : isLoadingContent ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <Loader2Icon className="mr-2 size-5 animate-spin" />
            Loading...
          </div>
        ) : viewMode === "raw" ? (
          <MarkdownEditor
            value={buffer}
            onChange={handleChange}
            maxHeight="100%"
            ariaLabel="Note content"
            className="h-full"
          />
        ) : (
          <div className="px-6 py-4 text-sm [&_h1]:text-2xl [&_h2]:text-xl [&_h3]:text-lg">
            {buffer.trim() ? (
              <MessageResponse>{buffer}</MessageResponse>
            ) : (
              <span className="text-muted-foreground">Empty note.</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SaveStatus({ indicator }: { indicator: BrainSaveIndicator }) {
  if (indicator === "saving") {
    return (
      <span role="status" className="flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
        Saving...
      </span>
    );
  }
  if (indicator === "saved") {
    // Darker greens in light mode for AA contrast; lighter in dark mode.
    return (
      <span role="status" className="flex items-center gap-1 text-xs text-green-700 dark:text-green-400">
        <CheckIcon className="size-3.5" aria-hidden="true" />
        Saved
      </span>
    );
  }
  if (indicator === "push-failed") {
    return (
      <span
        role="status"
        className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400"
      >
        <AlertTriangleIcon className="size-3.5" aria-hidden="true" />
        Push failed
      </span>
    );
  }
  return null;
}
