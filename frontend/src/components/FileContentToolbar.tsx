import { Columns2Icon, Rows3Icon, MessageSquarePlusIcon } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { FileViewMode } from "@/hooks/useTabs";
import type { DiffScope } from "@/types";

const DIFF_SCOPE_LABELS: Record<DiffScope, string> = {
  uncommitted: "Working tree",
  committed: "Branch commits",
  combined: "Combined",
};

interface FileContentToolbarProps {
  filePath: string;
  mode: FileViewMode;
  onModeChange: (mode: FileViewMode) => void;
  /**
   * Whether to show the Source/Diff segmented toggle. When `false` the toggle is
   * hidden entirely (e.g. the Brain, which has no per-file diff). Defaults to
   * `true`. The diff-only props below are only read while `mode === "diff"`.
   */
  showSourceDiffToggle?: boolean;
  isModified?: boolean;
  diffScope?: DiffScope;
  availableDiffScopes?: DiffScope[];
  onDiffScopeChange?: (scope: DiffScope) => void;
  diffStyle?: "split" | "unified";
  onDiffStyleChange?: (style: "split" | "unified") => void;
  commentCount?: number;
  onPasteToPrompt?: () => void;
  sourceLabel?: string;
  supportsTextDiff?: boolean;
  /** Markdown render mode for the source view. Defaults to `"raw"`. */
  renderMode?: "raw" | "rendered";
  /** Called when the user toggles the Raw/Rendered segmented control. */
  onRenderModeChange?: (mode: "raw" | "rendered") => void;
  /**
   * Whether the open file can be rendered (e.g. Markdown). When `false` the
   * Raw/Rendered toggle is hidden. Defaults to `false`.
   */
  supportsRendered?: boolean;
}

export function FileContentToolbar({
  filePath,
  mode,
  onModeChange,
  showSourceDiffToggle = true,
  isModified = false,
  diffScope = "uncommitted",
  availableDiffScopes = [],
  onDiffScopeChange,
  diffStyle = "unified",
  onDiffStyleChange,
  commentCount = 0,
  onPasteToPrompt,
  sourceLabel = "Source",
  supportsTextDiff = true,
  renderMode = "raw",
  onRenderModeChange,
  supportsRendered = false,
}: FileContentToolbarProps) {
  const parts = filePath.split("/");
  const basename = parts.pop() ?? filePath;
  const directory = parts.length > 0 ? parts.join("/") + "/" : "";

  const toggleCls = (active: boolean) =>
    cn(
      "flex min-h-7 items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
      active
        ? "bg-background text-foreground shadow-sm"
        : "text-muted-foreground hover:text-foreground",
    );

  return (
    <TooltipProvider>
      <div className="flex h-10 shrink-0 items-center gap-3 border-b border-border/50 px-3">
        {/* File path */}
        <span className="min-w-0 truncate text-xs">
          <span className="text-muted-foreground">{directory}</span>
          <span className="font-medium">{basename}</span>
        </span>

        <div className="ml-auto flex items-center gap-2">
          {/* Raw / Rendered toggle (source mode, renderable files only) */}
          {mode === "source" && supportsRendered && (
            <div className="flex items-center rounded-lg bg-muted p-0.5">
              <button
                type="button"
                onClick={() => onRenderModeChange?.("raw")}
                className={toggleCls(renderMode === "raw")}
                aria-pressed={renderMode === "raw"}
              >
                Raw
              </button>
              <button
                type="button"
                onClick={() => onRenderModeChange?.("rendered")}
                className={toggleCls(renderMode === "rendered")}
                aria-pressed={renderMode === "rendered"}
              >
                Rendered
              </button>
            </div>
          )}

          {/* Diff-only controls */}
          {mode === "diff" && supportsTextDiff && (
            <>
              {commentCount > 0 && (
                <button
                  type="button"
                  onClick={() => onPasteToPrompt?.()}
                  className="flex min-h-7 items-center gap-1 rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground transition-colors outline-none hover:bg-primary/90 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <MessageSquarePlusIcon className="size-3" />
                  Paste to prompt ({commentCount})
                </button>
              )}
              {availableDiffScopes.length > 1 && (
                <div className="flex items-center rounded-lg bg-muted p-0.5">
                  {availableDiffScopes.map((scope) => (
                    <button
                      key={scope}
                      type="button"
                      onClick={() => onDiffScopeChange?.(scope)}
                      className={toggleCls(diffScope === scope)}
                    >
                      {DIFF_SCOPE_LABELS[scope]}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex items-center rounded-lg bg-muted p-0.5">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button type="button" onClick={() => onDiffStyleChange?.("split")} className={toggleCls(diffStyle === "split")}>
                      <Columns2Icon className="size-3" />
                      Split
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Side-by-side view</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button type="button" onClick={() => onDiffStyleChange?.("unified")} className={toggleCls(diffStyle === "unified")}>
                      <Rows3Icon className="size-3" />
                      Stacked
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Unified view</TooltipContent>
                </Tooltip>
              </div>
            </>
          )}

          {/* Source / Diff toggle */}
          {showSourceDiffToggle && (
            <div className="flex items-center rounded-lg bg-muted p-0.5">
              <button
                type="button"
                onClick={() => onModeChange("source")}
                className={toggleCls(mode === "source")}
                aria-pressed={mode === "source"}
              >
                {sourceLabel}
              </button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => isModified && onModeChange("diff")}
                    disabled={!isModified}
                    className={cn(toggleCls(mode === "diff"), !isModified && "cursor-not-allowed opacity-40")}
                    aria-pressed={mode === "diff"}
                  >
                    Diff
                  </button>
                </TooltipTrigger>
                {!isModified && <TooltipContent>No changes for this file</TooltipContent>}
              </Tooltip>
            </div>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
