import { GitBranch, Plus } from "lucide-react";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { ContextMenuItem } from "@/components/ui/context-menu";
import { SidebarGroupHeader } from "@/components/sidebar/SidebarHeaders";
import { SidebarActivityDot } from "@/components/sidebar/SidebarActivityDot";
import { SidebarWorkspaceItem } from "@/components/sidebar/SidebarWorkspaceItem";
import { ActivityWave } from "@/components/ui/activity-wave";
import { ProjectAvatar } from "@/components/ProjectAvatar";
import { cn } from "@/lib/utils";
import type { WorkspaceLiveData } from "@/hooks/useWorkspaceLiveData";
import { aggregateScriptRunning, aggregateWorkspaceActivity } from "@/lib/workspace-activity";
import type { PrStatusResponse, Project } from "@/types";

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
  creatingProjectId: string | null;
  archivingWsId: string | null;
  draggingProjectId: string | null;
  projectInsertIndicator: ProjectInsertIndicator;
  onAddWorkspace: (projectId: string) => void;
  onAddWorkspaceFrom?: (projectId: string) => void;
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
  creatingProjectId,
  archivingWsId,
  draggingProjectId,
  projectInsertIndicator,
  onAddWorkspace,
  onAddWorkspaceFrom,
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
          addMenu={
            onAddWorkspaceFrom ? (
              <>
                <ContextMenuItem onSelect={() => onAddWorkspace(project.id)}>
                  <Plus />
                  New workspace
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => onAddWorkspaceFrom(project.id)}>
                  <GitBranch />
                  New workspace from…
                </ContextMenuItem>
              </>
            ) : undefined
          }
          variant="plain"
          buttonClassName={cn(
            "rounded py-1 pl-0 hover:bg-sidebar-accent/35",
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
            <div className="mt-1 space-y-px">
              {(project.workspaces ?? []).map((ws) => (
                <SidebarWorkspaceItem
                  key={ws.id}
                  ws={ws}
                  wsLive={liveData[ws.id]}
                  prStatus={prStatuses[ws.id]}
                  isActive={activeWsId === ws.id}
                  isArchiving={archivingWsId === ws.id}
                  onArchive={onArchiveWorkspace}
                />
              ))}
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
