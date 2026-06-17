import { RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface FileBrowserHeaderProps {
  activeTab: "all" | "modified";
  onTabChange: (tab: "all" | "modified") => void;
  modifiedCount: number;
  onRefresh: () => void;
  isRefreshing?: boolean;
}

/**
 * Shared file-browser header: "Files" / "Changes" segmented tabs (Changes shows the
 * pending-change count) plus a right-aligned manual refresh button that reloads
 * the file tree + git status/diff. Reused by the Workspace and Brain right columns.
 */
export function FileBrowserHeader({
  activeTab,
  onTabChange,
  modifiedCount,
  onRefresh,
  isRefreshing = false,
}: FileBrowserHeaderProps) {
  return (
    <div className="flex h-12 items-center px-4" data-tauri-drag-region>
      <div className="inline-flex items-center gap-0.5 rounded-lg bg-muted/60 p-0.5">
        <button
          type="button"
          className={cn(
            "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
            activeTab === "all"
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
          onClick={() => onTabChange("all")}
        >
          Files
        </button>
        <button
          type="button"
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
            activeTab === "modified"
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
          onClick={() => onTabChange("modified")}
        >
          Changes
          <span className="tabular-nums text-muted-foreground/70">{modifiedCount}</span>
        </button>
      </div>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className="ml-auto text-muted-foreground/70 hover:text-foreground"
              onClick={onRefresh}
              disabled={isRefreshing}
              aria-label="Refresh files"
            >
              <RefreshCwIcon className={cn("size-3.5", isRefreshing && "animate-spin")} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Refresh files</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}
