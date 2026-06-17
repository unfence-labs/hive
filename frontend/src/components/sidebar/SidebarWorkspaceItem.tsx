import { Link } from "react-router-dom";
import { ArchiveIcon, Loader2 } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ActivityWave } from "@/components/ui/activity-wave";
import { DiffStatBadge } from "@/components/diff/DiffStatBadge";
import { computePrDisplayCompact } from "@/lib/pr-display";
import { workspaceDiffTotals } from "@/lib/workspace-activity";
import { cn } from "@/lib/utils";
import type { WorkspaceLiveData } from "@/hooks/useWorkspaceLiveData";
import type { PrStatusResponse, Workspace } from "@/types";

interface SidebarWorkspaceItemProps {
  ws: Workspace;
  wsLive: WorkspaceLiveData | undefined;
  prStatus: PrStatusResponse | undefined;
  isActive: boolean;
  isArchiving: boolean;
  onArchive: (wsId: string) => void;
}

/**
 * Dense single-line workspace row.
 *
 * - State lives mostly in the branch text: streaming shimmers it, unread paints
 *   it accent, the active row is bold. Idle rows render with the branch flush to
 *   the left — no reserved lead slot, so there is no empty gutter.
 * - A leading indicator (running wave > unread dot) is rendered inline only when
 *   present, gently pushing the branch right; streaming needs no glyph.
 * - The trailing diff + PR dot sit in fixed-width cells (the PR cell is reserved
 *   even with no PR so the column stays aligned). On hover they fade out and the
 *   archive action takes their place — same real estate, nothing shifts.
 */
export function SidebarWorkspaceItem({
  ws,
  wsLive,
  prStatus,
  isActive,
  isArchiving,
  onArchive,
}: SidebarWorkspaceItemProps) {
  const streaming = wsLive?.streaming ?? false;
  const scriptRunning = wsLive?.scriptRunning ?? false;
  const unread = !streaming && Object.keys(wsLive?.unreadSessions ?? {}).length > 0;
  const displayBranch = wsLive?.branch ?? ws.branch;
  const diffTotals = workspaceDiffTotals(wsLive);
  const pr = prStatus?.pr;
  const prDisplay = pr ? computePrDisplayCompact(pr) : null;

  // A running script must never be archived from under itself; while it runs we
  // keep showing the metadata on hover instead of swapping in the archive action.
  const canArchive = !scriptRunning && !isArchiving;

  const branchClass = streaming
    ? "sidebar-stream-text"
    : unread
      ? "text-primary font-medium"
      : isActive
        ? "text-sidebar-foreground font-semibold"
        : "text-muted-foreground";

  return (
    <div
      className={cn(
        "group/ws relative transition-opacity",
        isArchiving && "pointer-events-none opacity-40",
      )}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            to={`/workspaces/${ws.id}`}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "sidebar-ws flex h-7 items-center gap-2 rounded-md px-2",
              isActive && "sidebar-ws-active",
            )}
          >
            {(scriptRunning || unread) && (
              <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                {scriptRunning ? (
                  <ActivityWave size="small" decorative />
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                )}
              </span>
            )}
            {streaming && (
              <span className="sr-only" role="img" aria-label="Agent thinking" />
            )}

            <span className={cn("min-w-0 flex-1 truncate text-sm", branchClass)}>
              {displayBranch}
            </span>

            <span
              className={cn(
                "flex shrink-0 items-center gap-2 transition-opacity",
                canArchive && "group-hover/ws:opacity-0",
              )}
            >
              {diffTotals && (
                <DiffStatBadge
                  additions={diffTotals.additions}
                  deletions={diffTotals.deletions}
                  className="text-[10px] opacity-75"
                />
              )}
              <span className="grid w-2.5 place-items-center">
                {prDisplay && (
                  <span
                    role="img"
                    aria-label={`#${pr!.number} ${prDisplay.label}`}
                    title={`#${pr!.number} ${prDisplay.label}`}
                    className={cn("size-1.5 rounded-full bg-current", prDisplay.iconClass)}
                  />
                )}
              </span>
            </span>
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right" className="text-xs">
          {ws.name}
        </TooltipContent>
      </Tooltip>

      {isArchiving ? (
        <div className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5">
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
        </div>
      ) : (
        canArchive && (
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground opacity-0 transition-[opacity,color] duration-150 hover:text-destructive group-hover/ws:opacity-100"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onArchive(ws.id);
            }}
            aria-label={`Archive workspace ${ws.name}`}
            title="Archive workspace"
          >
            <ArchiveIcon className="size-[13px]" />
          </button>
        )
      )}
    </div>
  );
}
