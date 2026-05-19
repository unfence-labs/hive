import { Link } from "react-router-dom";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SidebarGroupHeader } from "@/components/sidebar/SidebarHeaders";
import { SidebarActivityDot } from "@/components/sidebar/SidebarActivityDot";
import { BranchLabel } from "@/components/BranchLabel";
import AgentActivityPreview from "@/components/chat/AgentActivityPreview";
import { ActivityWave } from "@/components/ui/activity-wave";
import { ProjectAvatar } from "@/components/ProjectAvatar";
import { computePrDisplayCompact } from "@/lib/pr-display";
import { cn } from "@/lib/utils";
import type { WorkspaceLiveData } from "@/hooks/useWorkspaceLiveData";
import { aggregateScriptRunning, aggregateWorkspaceActivity } from "@/lib/workspace-activity";
import type { PrStatusResponse, Project } from "@/types";
import { ArchiveIcon, Loader2 } from "lucide-react";

type ProjectInsertIndicator = "before" | "after" | null;

interface SidebarProjectItemProps {
  project: Project;
  folderId: string | null;
  canReorder: boolean;
  className?: string;
  displayLabel: React.ReactNode;
  displayLabelPlain: string;
  isExpanded: boolean;
  setExpanded: (open: boolean) => void;
  activeWsId?: string;
  liveData: Record<string, WorkspaceLiveData>;
  prStatuses: Record<string, PrStatusResponse>;
  prLoading: boolean;
  creatingProjectId: string | null;
  archivingWsId: string | null;
  draggingProjectId: string | null;
  projectInsertIndicator: ProjectInsertIndicator;
  onAddWorkspace: (projectId: string) => void;
  onArchiveWorkspace: (wsId: string) => void;
  onProjectDragStart: (event: React.DragEvent<HTMLButtonElement>, projectId: string) => void;
  onProjectDragEnd: () => void;
  onProjectReorderDragOver: (
    event: React.DragEvent<HTMLDivElement>,
    projectId: string,
    position: "before" | "after",
  ) => void;
  onProjectReorderDrop: (
    event: React.DragEvent<HTMLDivElement>,
    projectId: string,
    folderId: string,
    position: "before" | "after",
  ) => void;
}

export function SidebarProjectItem({
  project,
  folderId,
  canReorder,
  className,
  displayLabel,
  displayLabelPlain,
  isExpanded,
  setExpanded,
  activeWsId,
  liveData,
  prStatuses,
  prLoading,
  creatingProjectId,
  archivingWsId,
  draggingProjectId,
  projectInsertIndicator,
  onAddWorkspace,
  onArchiveWorkspace,
  onProjectDragStart,
  onProjectDragEnd,
  onProjectReorderDragOver,
  onProjectReorderDrop,
}: SidebarProjectItemProps) {
  const isDragged = draggingProjectId === project.id;
  const showReorderZones =
    canReorder
    && folderId !== null
    && draggingProjectId !== null
    && draggingProjectId !== project.id;

  const workspaceIds = (project.workspaces ?? []).map((ws) => ws.id);
  const projectActivity = aggregateWorkspaceActivity(workspaceIds, liveData);
  const projectScriptRunning = aggregateScriptRunning(workspaceIds, liveData);

  return (
    <div key={project.id} className={cn("relative", className)} data-sidebar-project={project.id}>
      <Collapsible open={isExpanded} onOpenChange={setExpanded}>
        <SidebarGroupHeader
          icon={
            <span className="relative inline-flex shrink-0">
              <ProjectAvatar
                name={project.name}
                projectId={project.id}
                hasFavicon={project.hasFavicon}
                faviconVersion={project.faviconVersion}
                className="h-[18px] w-[18px]"
              />
              <SidebarActivityDot state={projectActivity} dimmed={isExpanded} />
            </span>
          }
          label={displayLabel}
          activityIndicator={
            projectScriptRunning && !isExpanded ? (
              <ActivityWave size="small" decorative className="shrink-0" />
            ) : undefined
          }
          count={(project.workspaces ?? []).length}
          isLoading={creatingProjectId === project.id}
          onAdd={() => { onAddWorkspace(project.id); }}
          addLabel={`Add workspace to ${displayLabelPlain}`}
          variant="plain"
          buttonClassName={cn(
            "rounded py-1 pl-0 pr-1.5 hover:bg-sidebar-accent/35",
            isDragged && "cursor-grabbing opacity-45",
          )}
          buttonProps={{
            draggable: canReorder,
            onDragStart: canReorder ? (event) => onProjectDragStart(event, project.id) : undefined,
            onDragEnd: canReorder ? onProjectDragEnd : undefined,
            "aria-grabbed": isDragged,
          }}
        />

        <CollapsibleContent className="mb-2">
          <div className="ml-2 mt-px border-l border-sidebar-border/40 pl-2">
            <div className="mt-1 space-y-1.5">
              {(project.workspaces ?? []).map((ws) => {
              const wsLive = liveData[ws.id];
              const wsStreaming = wsLive?.streaming ?? false;
              const wsScriptRunning = wsLive?.scriptRunning ?? false;
              const displayBranch = wsLive?.branch ?? ws.branch;
              const wsUnread = !wsStreaming && Object.keys(wsLive?.unreadSessions ?? {}).length > 0;
              const prStatus = prStatuses[ws.id];
              const wsArchiving = archivingWsId === ws.id;

              return (
                <div
                  key={ws.id}
                  className={cn(
                    "group/ws relative transition-opacity",
                    wsArchiving && "pointer-events-none opacity-40",
                  )}
                >
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Link
                        to={`/workspaces/${ws.id}`}
                        className={cn(
                          "sidebar-card block rounded-md border py-1.5 pl-2 pr-2",
                          activeWsId === ws.id && "sidebar-card-active",
                        )}
                      >
                        <div className="flex items-center gap-1.5">
                          <div className="flex h-3.5 w-3.5 shrink-0 items-center justify-center overflow-visible">
                            {wsStreaming ? (
                              <AgentActivityPreview size="small" />
                            ) : wsUnread ? (
                              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                            ) : null}
                          </div>
                          <BranchLabel
                            branch={displayBranch}
                            showIcon={false}
                            className={cn(
                              "min-w-0 flex-1 pr-5 text-sm",
                              activeWsId === ws.id || wsUnread
                                ? "text-sidebar-foreground"
                                : "text-muted-foreground",
                            )}
                          />
                        </div>

                        <div className="mt-0.5 flex items-center gap-1 pl-5 text-[11px]">
                          {prStatus?.pr ? (
                            (() => {
                              const display = computePrDisplayCompact(prStatus.pr);
                              return (
                                <span className={cn("truncate", display.textClass)}>
                                  #{prStatus.pr.number} {display.label}
                                </span>
                              );
                            })()
                          ) : prLoading ? (
                            <span className="text-muted-foreground">Loading…</span>
                          ) : prStatus?.error ? (
                            <span className="text-muted-foreground">Error fetching PR</span>
                          ) : (
                            <span className="text-muted-foreground">No PR</span>
                          )}
                        </div>
                      </Link>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="text-xs">
                      {ws.name}
                    </TooltipContent>
                  </Tooltip>

                  {wsScriptRunning && !wsArchiving && (
                    <div className="pointer-events-none absolute right-2 top-1.5">
                      <ActivityWave size="small" decorative className="shrink-0" />
                    </div>
                  )}

                  {wsArchiving ? (
                    <div className="absolute right-2 top-1.5 p-0.5">
                      <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                    </div>
                  ) : !wsScriptRunning && (
                    <button
                      type="button"
                      className="absolute right-2 top-1.5 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-sidebar-foreground group-hover/ws:opacity-100"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onArchiveWorkspace(ws.id);
                      }}
                      aria-label={`Archive workspace ${ws.name}`}
                      title="Archive workspace"
                    >
                      <ArchiveIcon className="h-3 w-3" />
                    </button>
                  )}
                </div>
              );
            })}
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
      {showReorderZones && folderId !== null && (
        <>
          <div
            data-project-reorder="before"
            className="absolute inset-x-0 top-0 z-20 h-2.5"
            onDragOver={(event) => onProjectReorderDragOver(event, project.id, "before")}
            onDrop={(event) => onProjectReorderDrop(event, project.id, folderId, "before")}
          />
          <div
            data-project-reorder="after"
            className="absolute inset-x-0 bottom-0 z-20 h-2.5"
            onDragOver={(event) => onProjectReorderDragOver(event, project.id, "after")}
            onDrop={(event) => onProjectReorderDrop(event, project.id, folderId, "after")}
          />
        </>
      )}
      {projectInsertIndicator && (
        <div
          className={cn(
            "pointer-events-none absolute inset-x-1 z-10 h-0.5 rounded-full bg-primary",
            projectInsertIndicator === "before" ? "top-0" : "bottom-0",
          )}
        />
      )}
    </div>
  );
}
