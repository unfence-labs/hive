import { useMemo, useState } from "react";
import { getNextRun, formatTimeUntil } from "@/lib/cron";
import {
  ArchiveIcon,
  Check,
  ChevronRight,
  Folder,
  FolderOpen,
  FolderPlus,
  Loader2,
  Pencil,
  Plus,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { useWorkspaceLiveDataContext } from "@/contexts/WorkspaceLiveDataContext";
import { useProjects } from "@/hooks/useProjects";
import { useBulkPrStatus, usePrStatusMap } from "@/hooks/usePrStatus";
import { useSidebarProjectFolders } from "@/hooks/useSidebarProjectFolders";
import { computePrDisplayCompact } from "@/lib/pr-display";
import { BranchLabel } from "@/components/BranchLabel";
import AgentActivityPreview from "@/components/chat/AgentActivityPreview";
import { ActivityWave } from "@/components/ui/activity-wave";
import { api } from "@/hooks/useApi";
import { cn } from "@/lib/utils";
import { ProjectAvatar } from "@/components/ProjectAvatar";
import { useAutomations } from "@/hooks/useAutomations";
import { SidebarShell } from "@/components/SidebarShell";
import { Input } from "@/components/ui/input";
import type { Automation, DiffStatResponse, Project } from "@/types";

// ── Helpers ──────────────────────────────────────────────────────────

/** Extract { owner, repo } from any git URL, or null if unparseable. */
export function parseProjectOwnerRepo(url: string): { owner: string; repo: string } | null {
  // SCP-style: git@host:owner/repo.git
  const scpMatch = url.match(/^[^@]+@[^:]+:([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (scpMatch) return { owner: scpMatch[1], repo: scpMatch[2] };

  // URL-style: https://host/owner/repo.git or ssh://git@host/owner/repo
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length >= 2)
      return { owner: segments[0], repo: segments[1].replace(/\.git$/, "") };
  } catch {
    // not a valid URL
  }

  return null;
}

// ── Shared sidebar group header ──────────────────────────────────────

interface SidebarGroupHeaderProps {
  icon: React.ReactNode;
  label: React.ReactNode;
  badge?: React.ReactNode;
  count?: number;
  isLoading?: boolean;
  onAdd?: (e: React.MouseEvent) => void;
  addLabel?: string;
  variant?: "default" | "plain";
  buttonClassName?: string;
  buttonProps?: React.ComponentProps<"button">;
}

function SidebarGroupHeader({
  icon,
  label,
  badge,
  count,
  isLoading,
  onAdd,
  addLabel,
  variant = "default",
  buttonClassName,
  buttonProps,
}: SidebarGroupHeaderProps) {
  const isPlain = variant === "plain";
  const { className: buttonPropsClassName, ...restButtonProps } = buttonProps ?? {};

  return (
    <div className="group relative flex w-full items-center">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex w-full min-w-0 items-center overflow-hidden text-left transition-colors",
            isPlain
              ? "gap-1.5 px-0 py-0.5"
              : "gap-2 rounded px-2 py-1 hover:bg-sidebar-accent/40",
            count !== undefined && "pr-7",
            buttonClassName,
            buttonPropsClassName,
          )}
          {...restButtonProps}
        >
          {icon}
          <span className="min-w-0 flex-1 truncate text-xs font-semibold lowercase tracking-wider text-sidebar-foreground">
            {label}
          </span>
          {badge}
        </button>
      </CollapsibleTrigger>
      {count !== undefined && (
        <div className={cn("absolute inset-y-0 flex items-center", isPlain ? "right-0" : "right-2")}>
          <div className="relative flex h-5 w-5 items-center justify-center">
            {isLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            ) : (
              <>
                <span className="text-xs tabular-nums text-muted-foreground/60 transition-opacity group-hover:opacity-0">
                  {count}
                </span>
                {onAdd && (
                  <button
                    type="button"
                    className="absolute inset-0 flex items-center justify-center text-muted-foreground opacity-0 transition-opacity hover:text-sidebar-foreground group-hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      onAdd(e);
                    }}
                    aria-label={addLabel}
                    title={addLabel}
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface SidebarSectionHeaderProps {
  label: string;
  isLoading?: boolean;
  onAdd?: () => void;
  addLabel?: string;
  className?: string;
  addIcon?: React.ReactNode;
  addButtonClassName?: string;
}

function SidebarSectionHeader({
  label,
  isLoading = false,
  onAdd,
  addLabel,
  className,
  addIcon,
  addButtonClassName,
}: SidebarSectionHeaderProps) {
  return (
    <div className={cn("group relative flex w-full items-center", className)}>
      <span className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </span>
      <div className="relative flex h-5 w-5 items-center justify-center">
        {isLoading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        ) : onAdd ? (
          <button
            type="button"
            className={cn(
              "flex items-center justify-center text-muted-foreground/70 transition-colors hover:text-sidebar-foreground",
              addButtonClassName,
            )}
            onClick={onAdd}
            aria-label={addLabel}
            title={addLabel}
          >
            {addIcon ?? <Plus className="h-4 w-4" />}
          </button>
        ) : null
        }
      </div>
    </div>
  );
}

// ── Sidebar ──────────────────────────────────────────────────────────

interface SidebarProps {
  onAddProject: () => void;
  onAddAutomation?: () => void;
}

type SidebarDropTarget = { type: "folder"; folderId: string };

type FolderOrderDropTarget = {
  folderId: string;
  position: "before" | "after";
};

type ProjectOrderDropTarget = {
  projectId: string;
  position: "before" | "after";
};

export default function Sidebar({ onAddProject, onAddAutomation }: SidebarProps) {
  const { projects, loading, createWorkspace, archiveWorkspace } = useProjects();
  const { data: automations, isLoading: automationsLoading } = useAutomations();
  const queryClient = useQueryClient();
  const { wsId: activeWsId } = useParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
  const [creatingProjectId, setCreatingProjectId] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<string | null>(null);
  const [archivingWsId, setArchivingWsId] = useState<string | null>(null);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [deleteFolderTarget, setDeleteFolderTarget] = useState<{ id: string; name: string } | null>(null);
  const [draggingProjectId, setDraggingProjectId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<SidebarDropTarget | null>(null);
  const [draggingFolderId, setDraggingFolderId] = useState<string | null>(null);
  const [folderOrderDropTarget, setFolderOrderDropTarget] = useState<FolderOrderDropTarget | null>(null);
  const [projectOrderDropTarget, setProjectOrderDropTarget] = useState<ProjectOrderDropTarget | null>(null);
  const liveData = useWorkspaceLiveDataContext();

  const activeProjectId = projects.find((project) =>
    (project.workspaces ?? []).some((workspace) => workspace.id === activeWsId),
  )?.id;

  const allWsIds = useMemo(
    () => projects.flatMap((p) => (p.workspaces ?? []).map((ws) => ws.id)),
    [projects],
  );
  const { loading: prLoading } = useBulkPrStatus(allWsIds);
  const prStatuses = usePrStatusMap(allWsIds);
  const sortedAutomations = useMemo(() => {
    if (!automations) return [];
    return [...automations].sort((a, b) => automationSortKey(a) - automationSortKey(b));
  }, [automations]);
  const {
    folders,
    rootProjects,
    createFolder,
    renameFolder,
    deleteFolder,
    moveProjectToFolder,
    moveProjectToPosition,
    moveFolderById,
    isFolderExpanded,
    setFolderExpanded,
    getFolderIdForProject,
  } = useSidebarProjectFolders(projects);

  const isProjectExpanded = (projectId: string) => {
    const expanded = expandedProjects[projectId];
    if (typeof expanded === "boolean") return expanded;
    return activeProjectId === projectId;
  };

  const resetFolderComposer = () => {
    setIsCreatingFolder(false);
    setNewFolderName("");
  };

  const handleCreateFolder = () => {
    const folderId = createFolder(newFolderName);
    if (!folderId) return;
    resetFolderComposer();
  };

  const startRenamingFolder = (folderId: string, currentName: string) => {
    setRenamingFolderId(folderId);
    setRenameDraft(currentName);
  };

  const cancelRenamingFolder = () => {
    setRenamingFolderId(null);
    setRenameDraft("");
  };

  const commitRenamingFolder = () => {
    if (!renamingFolderId) return;
    const trimmed = renameDraft.trim();
    if (trimmed.length === 0) {
      cancelRenamingFolder();
      return;
    }
    renameFolder(renamingFolderId, trimmed);
    cancelRenamingFolder();
  };

  const confirmDeleteFolder = () => {
    if (!deleteFolderTarget) return;
    deleteFolder(deleteFolderTarget.id);
    setDeleteFolderTarget(null);
  };

  const handleAddWorkspace = async (projectId: string) => {
    if (creatingProjectId) return;
    setCreatingProjectId(projectId);
    try {
      const workspace = await createWorkspace(projectId);
      setExpandedProjects((prev) => ({ ...prev, [projectId]: true }));
      navigate(`/workspaces/${workspace.id}`);
    } finally {
      setCreatingProjectId(null);
    }
  };

  const handleArchiveClick = async (wsId: string) => {
    let uncommittedCount = liveData[wsId]?.diffStats?.uncommitted?.length;
    if (uncommittedCount === undefined) {
      try {
        const stats = await queryClient.fetchQuery({
          queryKey: ["diff-stat", wsId],
          queryFn: () => api.get<DiffStatResponse>(`/api/workspaces/${wsId}/diff/stat`),
        });
        uncommittedCount = stats.uncommitted.length;
      } catch {
        uncommittedCount = 0;
      }
    }
    if (uncommittedCount > 0) {
      setArchiveTarget(wsId);
    } else {
      await doArchive(wsId);
    }
  };

  const doArchive = async (wsId: string) => {
    setArchivingWsId(wsId);
    try {
      const wasActive = activeWsId === wsId;
      await archiveWorkspace(wsId);
      if (wasActive) navigate("/home");
    } finally {
      setArchivingWsId(null);
    }
  };

  const handleProjectDragStart = (
    event: React.DragEvent<HTMLButtonElement>,
    projectId: string,
  ) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-hive-project-id", projectId);
    event.dataTransfer.setData("text/plain", projectId);
    setDraggingProjectId(projectId);
    setDropTarget(null);
    setProjectOrderDropTarget(null);
  };

  const handleProjectDragEnd = () => {
    setDraggingProjectId(null);
    setDropTarget(null);
    setProjectOrderDropTarget(null);
  };

  const getDraggedProjectId = (event: React.DragEvent<HTMLDivElement>) =>
    draggingProjectId
    ?? event.dataTransfer.getData("application/x-hive-project-id")
    ?? null;

  const handleProjectReorderDragOver = (
    event: React.DragEvent<HTMLDivElement>,
    anchorProjectId: string,
    position: "before" | "after",
  ) => {
    const sourceProjectId = getDraggedProjectId(event);
    if (!sourceProjectId || sourceProjectId === anchorProjectId) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    if (dropTarget !== null) setDropTarget(null);

    if (
      projectOrderDropTarget?.projectId !== anchorProjectId
      || projectOrderDropTarget.position !== position
    ) {
      setProjectOrderDropTarget({ projectId: anchorProjectId, position });
    }
  };

  const handleProjectReorderDrop = (
    event: React.DragEvent<HTMLDivElement>,
    anchorProjectId: string,
    anchorFolderId: string,
    position: "before" | "after",
  ) => {
    const sourceProjectId = getDraggedProjectId(event);
    if (!sourceProjectId || sourceProjectId === anchorProjectId) return;
    event.preventDefault();
    event.stopPropagation();
    moveProjectToPosition(sourceProjectId, anchorFolderId, anchorProjectId, position);
    setDraggingProjectId(null);
    setDropTarget(null);
    setProjectOrderDropTarget(null);
  };

  const handleFolderDragOver = (
    event: React.DragEvent<HTMLDivElement>,
    folderId: string,
  ) => {
    if (!draggingProjectId) return;
    event.preventDefault();
    event.stopPropagation();

    if (getFolderIdForProject(draggingProjectId) === folderId) {
      if (dropTarget !== null) setDropTarget(null);
      return;
    }

    event.dataTransfer.dropEffect = "move";
    if (dropTarget?.type !== "folder" || dropTarget.folderId !== folderId) {
      setDropTarget({ type: "folder", folderId });
    }
    if (projectOrderDropTarget) setProjectOrderDropTarget(null);
  };

  const handleFolderDrop = (
    event: React.DragEvent<HTMLDivElement>,
    folderId: string,
  ) => {
    if (!draggingProjectId) return;
    event.preventDefault();
    event.stopPropagation();
    moveProjectToFolder(draggingProjectId, folderId);
    setDraggingProjectId(null);
    setDropTarget(null);
  };

  const handleFolderDragStart = (
    event: React.DragEvent<HTMLButtonElement>,
    folderId: string,
  ) => {
    setDraggingFolderId(folderId);
    setFolderOrderDropTarget(null);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-hive-folder-id", folderId);
    event.dataTransfer.setData("text/plain", folderId);
  };

  const handleFolderDragEnd = () => {
    setDraggingFolderId(null);
    setFolderOrderDropTarget(null);
  };

  const getDraggedFolderId = (event: React.DragEvent<HTMLDivElement>) =>
    draggingFolderId
    ?? event.dataTransfer.getData("application/x-hive-folder-id")
    ?? null;

  const handleFolderReorderDragOver = (
    event: React.DragEvent<HTMLDivElement>,
    folderId: string,
    position: "before" | "after",
  ) => {
    const sourceFolderId = getDraggedFolderId(event);
    if (!sourceFolderId || sourceFolderId === folderId) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";

    if (
      folderOrderDropTarget?.folderId !== folderId
      || folderOrderDropTarget.position !== position
    ) {
      setFolderOrderDropTarget({ folderId, position });
    }
  };

  const handleFolderReorderDrop = (
    event: React.DragEvent<HTMLDivElement>,
    folderId: string,
    position: "before" | "after",
  ) => {
    const sourceFolderId = getDraggedFolderId(event);
    if (!sourceFolderId || sourceFolderId === folderId) return;
    event.preventDefault();
    event.stopPropagation();
    moveFolderById(sourceFolderId, folderId, position);
    setDraggingFolderId(null);
    setFolderOrderDropTarget(null);
  };

  const renderProjectItem = (
    project: Project,
    folderId: string | null,
    className?: string,
  ) => {
    const parsed = project.url ? parseProjectOwnerRepo(project.url) : null;
    const displayLabel = parsed ? (
      <><span className="text-muted-foreground">{parsed.owner}/</span>{parsed.repo}</>
    ) : project.name;
    const displayLabelPlain = parsed ? `${parsed.owner}/${parsed.repo}` : project.name;
    const isDragged = draggingProjectId === project.id;
    const showReorderZones =
      folderId !== null
      && draggingProjectId !== null
      && draggingProjectId !== project.id;
    const projectInsertIndicator = projectOrderDropTarget?.projectId === project.id
      ? projectOrderDropTarget.position
      : null;

    return (
      <div key={project.id} className={cn("relative", className)} data-sidebar-project={project.id}>
        <Collapsible
          open={isProjectExpanded(project.id)}
          onOpenChange={(open) =>
            setExpandedProjects((prev) => ({ ...prev, [project.id]: open }))
          }
        >
          <SidebarGroupHeader
            icon={
              <ProjectAvatar
                name={project.name}
                projectId={project.id}
                hasFavicon={project.hasFavicon}
                className="h-[18px] w-[18px]"
              />
            }
            label={displayLabel}
            count={(project.workspaces ?? []).length}
            isLoading={creatingProjectId === project.id}
            onAdd={() => { void handleAddWorkspace(project.id); }}
            addLabel={`Add workspace to ${displayLabelPlain}`}
            variant="plain"
            buttonClassName={cn(
              "rounded py-1 pl-0 pr-1.5 hover:bg-sidebar-accent/35",
              isDragged && "cursor-grabbing opacity-45",
            )}
            buttonProps={{
              draggable: true,
              onDragStart: (event) => handleProjectDragStart(event, project.id),
              onDragEnd: handleProjectDragEnd,
              "aria-grabbed": isDragged,
            }}
          />

          <CollapsibleContent>
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
                  <div key={ws.id} className={cn("group/ws relative transition-opacity", wsArchiving && "pointer-events-none opacity-40")}>
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
                                "min-w-0 flex-1 text-sm",
                                activeWsId === ws.id || wsUnread
                                  ? "text-sidebar-foreground"
                                  : "text-muted-foreground",
                              )}
                            />
                            {wsScriptRunning && (
                              <ActivityWave size="small" decorative className="shrink-0" />
                            )}
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

                    {wsArchiving ? (
                      <div className="absolute right-1.5 top-1.5 p-0.5">
                        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                      </div>
                    ) : !wsScriptRunning && (
                      <button
                        type="button"
                        className="absolute right-1.5 top-1.5 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-sidebar-foreground group-hover/ws:opacity-100"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          void handleArchiveClick(ws.id);
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
          </CollapsibleContent>
        </Collapsible>
        {showReorderZones && folderId !== null && (
          <>
            <div
              data-project-reorder="before"
              className="absolute inset-x-0 top-0 z-20 h-2.5"
              onDragOver={(event) => handleProjectReorderDragOver(event, project.id, "before")}
              onDrop={(event) => handleProjectReorderDrop(event, project.id, folderId, "before")}
            />
            <div
              data-project-reorder="after"
              className="absolute inset-x-0 bottom-0 z-20 h-2.5"
              onDragOver={(event) => handleProjectReorderDragOver(event, project.id, "after")}
              onDrop={(event) => handleProjectReorderDrop(event, project.id, folderId, "after")}
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
  };

  const footerActions = (
    <div className="flex items-center justify-end px-2 py-1.5">
      <Link
        to="/settings"
        state={{ from: pathname }}
        className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:text-sidebar-foreground"
        aria-label="Settings"
        title="Settings"
      >
        <Settings className="h-4 w-4" />
      </Link>
    </div>
  );

  return (
    <SidebarShell footerActions={footerActions}>
      <ScrollArea className="flex-1 [&_[data-slot=scroll-area-viewport]>div]:!block [&_[data-slot=scroll-area-viewport]>div]:!min-w-full [&_[data-slot=scroll-area-viewport]>div]:!w-full">
        <div className="p-2">
          {loading ? (
            <div className="space-y-2 px-2">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-6 w-full" />
            </div>
          ) : (
            <TooltipProvider delayDuration={400}>
              <SidebarSectionHeader
                label="Workspaces"
                className="mb-1"
                onAdd={() => {
                  setIsCreatingFolder(true);
                  setNewFolderName("");
                }}
                addLabel="New folder"
                addIcon={<FolderPlus className="h-4 w-4" />}
                addButtonClassName="rounded p-0.5 hover:bg-sidebar-accent/50"
              />

              {isCreatingFolder && (
                <form
                  className="mb-2 rounded-lg border border-sidebar-border/80 bg-sidebar-accent/25 p-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleCreateFolder();
                  }}
                >
                  <div className="flex items-center gap-2">
                    <FolderPlus className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <Input
                      value={newFolderName}
                      onChange={(e) => setNewFolderName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          e.preventDefault();
                          resetFolderComposer();
                        }
                      }}
                      placeholder="Folder name"
                      aria-label="Folder name"
                      autoFocus
                      className="h-8 bg-background/80 text-sm"
                    />
                    <Button
                      type="submit"
                      variant="ghost"
                      size="icon-xs"
                      disabled={newFolderName.trim().length === 0}
                      aria-label="Create folder"
                      title="Create folder"
                    >
                      <Check />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      onClick={resetFolderComposer}
                      aria-label="Cancel folder creation"
                      title="Cancel folder creation"
                    >
                      <X />
                    </Button>
                  </div>
                </form>
              )}

              {folders.length > 0 && (
                <div className="space-y-px">
                  {folders.map((folder) => {
                    const expanded = isFolderExpanded(folder.id);
                    const isActiveDropTarget =
                      dropTarget?.type === "folder" && dropTarget.folderId === folder.id;
                    const containsActiveProject = folder.projects.some((project) => project.id === activeProjectId);
                    const isDraggedFolder = draggingFolderId === folder.id;
                    const folderInsertIndicator = folderOrderDropTarget?.folderId === folder.id
                      ? folderOrderDropTarget.position
                      : null;

                    const isRenaming = renamingFolderId === folder.id;
                    const isEmptyFolder = folder.projects.length === 0;

                    return (
                      <Collapsible
                        key={folder.id}
                        open={expanded}
                        onOpenChange={(open) => setFolderExpanded(folder.id, open)}
                      >
                        <div
                          data-sidebar-folder={folder.id}
                          onDragOver={(event) => handleFolderDragOver(event, folder.id)}
                          onDrop={(event) => handleFolderDrop(event, folder.id)}
                          className="relative rounded-lg"
                        >
                          {draggingFolderId !== null && draggingFolderId !== folder.id && (
                            <>
                              <div
                                data-folder-reorder="before"
                                className="absolute inset-x-0 top-0 z-20 h-3"
                                onDragOver={(event) => handleFolderReorderDragOver(event, folder.id, "before")}
                                onDrop={(event) => handleFolderReorderDrop(event, folder.id, "before")}
                              />
                              <div
                                data-folder-reorder="after"
                                className="absolute inset-x-0 bottom-0 z-20 h-3"
                                onDragOver={(event) => handleFolderReorderDragOver(event, folder.id, "after")}
                                onDrop={(event) => handleFolderReorderDrop(event, folder.id, "after")}
                              />
                            </>
                          )}
                          {folderInsertIndicator && (
                            <div
                              className={cn(
                                "pointer-events-none absolute inset-x-1 z-10 h-0.5 rounded-full bg-primary",
                                folderInsertIndicator === "before" ? "top-0" : "bottom-0",
                              )}
                            />
                          )}

                          {isRenaming ? (
                            <form
                              className="flex w-full items-center gap-1.5 rounded py-1 pl-0 pr-1.5"
                              onSubmit={(event) => {
                                event.preventDefault();
                                commitRenamingFolder();
                              }}
                            >
                              <ChevronRight className={cn("h-3.5 w-3.5 shrink-0", expanded && "rotate-90")} />
                              {expanded ? (
                                <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                              ) : (
                                <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                              )}
                              <Input
                                value={renameDraft}
                                onChange={(event) => setRenameDraft(event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key === "Escape") {
                                    event.preventDefault();
                                    cancelRenamingFolder();
                                  }
                                }}
                                onFocus={(event) => event.currentTarget.select()}
                                onBlur={commitRenamingFolder}
                                autoFocus
                                aria-label="Rename folder"
                                className="h-6 min-w-0 flex-1 bg-background/80 px-1.5 py-0 text-[12px] font-medium"
                              />
                            </form>
                          ) : (
                            <div className="group/folder relative flex w-full items-center">
                              <CollapsibleTrigger asChild>
                                <button
                                  type="button"
                                  draggable
                                  onDragStart={(event) => handleFolderDragStart(event, folder.id)}
                                  onDragEnd={handleFolderDragEnd}
                                  aria-grabbed={isDraggedFolder}
                                  className={cn(
                                    "flex w-full items-center gap-1.5 rounded py-1 pl-0 pr-12 text-left transition-colors hover:bg-sidebar-accent/40",
                                    containsActiveProject ? "text-sidebar-foreground" : "text-muted-foreground",
                                    isActiveDropTarget && "bg-primary/10 text-sidebar-foreground ring-1 ring-primary/20",
                                    isDraggedFolder && "cursor-grabbing opacity-45",
                                  )}
                                >
                                  <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 transition-transform", expanded && "rotate-90")} />
                                  {expanded ? (
                                    <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                                  ) : (
                                    <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                                  )}
                                  <span className="min-w-0 flex-1 truncate text-[12px] font-medium">
                                    {folder.name}
                                  </span>
                                </button>
                              </CollapsibleTrigger>

                              <div className="pointer-events-none absolute inset-y-0 right-1 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/folder:pointer-events-auto group-hover/folder:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100">
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    startRenamingFolder(folder.id, folder.name);
                                  }}
                                  className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50"
                                  aria-label={`Rename folder ${folder.name}`}
                                >
                                  <Pencil className="h-3 w-3" />
                                </button>
                                {isEmptyFolder && (
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.preventDefault();
                                      event.stopPropagation();
                                      setDeleteFolderTarget({ id: folder.id, name: folder.name });
                                    }}
                                    className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-destructive/60"
                                    aria-label={`Delete folder ${folder.name}`}
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </button>
                                )}
                              </div>
                            </div>
                          )}

                          <CollapsibleContent>
                            <div className="ml-2 mt-px border-l border-sidebar-border/40 pl-2">
                              {folder.projects.length > 0 ? (
                                <div className="space-y-px py-0.5">
                                  {folder.projects.map((project) => renderProjectItem(project, folder.id))}
                                </div>
                              ) : (
                                <div
                                  className={cn(
                                    "py-1.5 text-xs text-muted-foreground/70 transition-colors",
                                    isActiveDropTarget && "text-primary",
                                  )}
                                >
                                  Drop repositories here
                                </div>
                              )}
                            </div>
                          </CollapsibleContent>
                        </div>
                      </Collapsible>
                    );
                  })}
                </div>
              )}

              {rootProjects.length > 0 && (
                <div className={cn("space-y-px", folders.length > 0 && "mt-0.5")}>
                  {rootProjects.map((project) => renderProjectItem(project, null))}
                </div>
              )}

              <div className="mt-4">
                <div className="mb-3 border-t border-white/10" />
                <SidebarSectionHeader
                  label="Automations"
                  isLoading={automationsLoading}
                  onAdd={onAddAutomation}
                  addLabel="Add automation"
                />

                {automationsLoading ? (
                  <div className="mt-2 space-y-1.5">
                    <Skeleton className="h-12 w-full rounded-md" />
                    <Skeleton className="h-12 w-full rounded-md" />
                  </div>
                ) : sortedAutomations.length === 0 ? (
                  <div className="mt-2 py-1">
                    <p className="text-xs text-muted-foreground/60">no automations</p>
                  </div>
                ) : (
                  <div className="mt-1 space-y-px">
                    {sortedAutomations.map((auto) => (
                      <AutomationRow key={auto.id} auto={auto} pathname={pathname} />
                    ))}
                  </div>
                )}
              </div>
            </TooltipProvider>
          )}
        </div>
      </ScrollArea>

      {/* ── Bottom action ─────────────────────────────────────────── */}
      <div className="shrink-0 px-2 pb-1.5">
        <button
          type="button"
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-primary/40 px-2 py-2 text-sm text-primary transition-colors hover:border-primary hover:bg-primary/10"
          onClick={onAddProject}
        >
          <FolderPlus className="h-4 w-4 shrink-0" />
          Add repository
        </button>
      </div>

      <AlertDialog
        open={deleteFolderTarget !== null}
        onOpenChange={(open) => !open && setDeleteFolderTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete folder</AlertDialogTitle>
            <AlertDialogDescription>
              Remove the folder “{deleteFolderTarget?.name}”? Repositories are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteFolder}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={archiveTarget !== null}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive workspace</AlertDialogTitle>
            <AlertDialogDescription>
              This workspace has uncommitted changes that will be lost. Are you sure you want to archive it?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (archiveTarget) void doArchive(archiveTarget);
                setArchiveTarget(null);
              }}
            >
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SidebarShell>
  );
}

// ── Automation sidebar list ──────────────────────────────────────────

export function automationSortKey(a: Automation): number {
  if (a.lastRunStatus === "running") return 0;
  if (a.enabled) return 1;
  return 2;
}

export function describeSchedule(expression: string): string {
  const presets: Record<string, string> = {
    "0 * * * *": "Hourly",
    "0 */6 * * *": "Every 6h",
    "0 2 * * *": "Daily 2am",
    "0 8 * * *": "Daily 8am",
    "0 0 * * *": "Daily midnight",
    "0 9 * * 1-5": "Weekdays 9am",
    "0 9 * * 1": "Weekly Mon",
  };
  return presets[expression] ?? expression;
}

function AutomationRow({ auto, pathname }: { auto: Automation; pathname: string }) {
  const isActive = pathname === `/automations/${auto.id}`;
  const isRunning = auto.lastRunStatus === "running";
  const rightLabel = (() => {
    if (!auto.enabled) return "disabled";
    if (isRunning) return "running";
    if (auto.trigger.type === "cron") {
      const next = getNextRun(auto.trigger.expression);
      if (!next) return describeSchedule(auto.trigger.expression);
      const diffMs = next.getTime() - Date.now();
      if (diffMs < 0) return "due now";
      return formatTimeUntil(diffMs);
    }
    return "";
  })();

  return (
    <div className="relative">
      {isActive && (
        <span
          aria-hidden
          className="pointer-events-none absolute left-0 top-1 bottom-1 w-0.5 rounded-full bg-primary"
        />
      )}
      <Link
        to={`/automations/${auto.id}`}
        className={cn(
          "block rounded px-2 py-1 transition-colors hover:bg-sidebar-accent/50",
          isActive && "bg-sidebar-accent/70",
        )}
      >
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full",
              isRunning
                ? "bg-green-500 animate-pulse"
                : auto.enabled
                  ? "bg-green-500"
                  : "bg-muted-foreground/40",
            )}
          />
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-[13px]",
              isActive || auto.enabled
                ? "text-sidebar-foreground"
                : "text-muted-foreground",
            )}
          >
            {auto.name}
          </span>
          <span
            className={cn(
              "shrink-0 text-[11px]",
              isActive ? "text-sidebar-foreground/70" : "text-muted-foreground",
            )}
          >
            {rightLabel}
          </span>
        </div>
      </Link>
    </div>
  );
}
