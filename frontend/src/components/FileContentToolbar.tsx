import { Columns2Icon, Rows3Icon, MessageSquarePlusIcon } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { FileViewMode } from "@/hooks/useTabs";

interface FileContentToolbarProps {
  filePath: string;
  mode: FileViewMode;
  onModeChange: (mode: FileViewMode) => void;
  isModified: boolean;
  diffStyle: "split" | "unified";
  onDiffStyleChange: (style: "split" | "unified") => void;
  commentCount: number;
  onPasteToPrompt: () => void;
}

export function FileContentToolbar({
  filePath,
  mode,
  onModeChange,
  isModified,
  diffStyle,
  onDiffStyleChange,
  commentCount,
  onPasteToPrompt,
}: FileContentToolbarProps) {
  const parts = filePath.split("/");
  const basename = parts.pop() ?? filePath;
  const directory = parts.length > 0 ? parts.join("/") + "/" : "";

  const toggleCls = (active: boolean) =>
    cn(
      "flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium transition-colors",
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
          {/* Diff-only controls */}
          {mode === "diff" && (
            <>
              {commentCount > 0 && (
                <button
                  type="button"
                  onClick={onPasteToPrompt}
                  className="flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  <MessageSquarePlusIcon className="size-3" />
                  Paste to prompt ({commentCount})
                </button>
              )}
              <div className="flex items-center rounded-lg bg-muted p-0.5">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button type="button" onClick={() => onDiffStyleChange("split")} className={toggleCls(diffStyle === "split")}>
                      <Columns2Icon className="size-3" />
                      Split
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Side-by-side view</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button type="button" onClick={() => onDiffStyleChange("unified")} className={toggleCls(diffStyle === "unified")}>
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
          <div className="flex items-center rounded-lg bg-muted p-0.5">
            <button type="button" onClick={() => onModeChange("source")} className={toggleCls(mode === "source")}>
              Source
            </button>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => isModified && onModeChange("diff")}
                  disabled={!isModified}
                  className={cn(toggleCls(mode === "diff"), !isModified && "cursor-not-allowed opacity-40")}
                >
                  Diff
                </button>
              </TooltipTrigger>
              {!isModified && <TooltipContent>No changes for this file</TooltipContent>}
            </Tooltip>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
