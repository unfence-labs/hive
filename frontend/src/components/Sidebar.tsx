import { useEffect, useMemo, useState } from "react";
import { getNextRun, formatTimeUntil } from "@/lib/cron";
import {
  AlertCircle,
  Brain,
  FolderGit2,
  FolderPlus,
  Loader2,
  Search,
  Settings,
} from "lucide-react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { Group, Panel, useDefaultLayout } from "react-resizable-panels";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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
import { useBrain } from "@/hooks/useBrain";
import { usePrStatusMap, useSyncPrWorkspaces } from "@/hooks/usePrStatus";
import { useSidebarProjectFolders, type SidebarProjectFolderView } from "@/hooks/useSidebarProjectFolders";
import { api } from "@/hooks/useApi";
import {
  automationSortKey,
  describeSchedule,
  parseProjectOwnerRepo,
} from "@/lib/sidebar-helpers";
import { cn } from "@/lib/utils";
import { dispatchAppCommand } from "@/lib/app-commands";
import { shortcutLabel } from "@/lib/shortcuts";
import { ShortcutTooltip } from "@/components/ShortcutTooltip";
import { BRAIN_WORKSPACE_ID } from "@/lib/brain";
import {
  aggregateScriptRunning,
  aggregateWorkspaceActivity,
  workspaceActivityState,
} from "@/lib/workspace-activity";
import { SidebarActivityDot } from "@/components/sidebar/SidebarActivityDot";
import { useAutomations } from "@/hooks/useAutomations";
import { SidebarShell } from "@/components/SidebarShell";
import { ResizeHandle } from "@/components/ResizeHandle";
import { SidebarFolderComposer } from "@/components/sidebar/SidebarFolderComposer";
import { SidebarFolderItem } from "@/components/sidebar/SidebarFolderItem";
import {
  SidebarSectionHeader,
} from "@/components/sidebar/SidebarHeaders";
import { SidebarProjectItem } from "@/components/sidebar/SidebarProjectItem";
import type { Automation, DiffStatResponse, Project } from "@/types";

// ── Sidebar ──────────────────────────────────────────────────────────

interface SidebarProps {
  onAddProject: () => void;
  onAddAutomation?: () => void;
  onNewWorkspaceFrom?: (projectId: string) => void;
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

export function collectVisiblePrWorkspaceIds({
  folders,
  rootProjects,
  expandedProjects,
  activeProjectId,
  activeWsId,
  isFolderExpanded,
}: {
  folders: SidebarProjectFolderView[];
  rootProjects: Project[];
  expandedProjects: Record<string, boolean>;
  activeProjectId?: string;
  activeWsId?: string;
  isFolderExpanded: (folderId: string) => boolean;
}): string[] {
  const visible = new Set<string>();
  const isProjectExpanded = (projectId: string) => {
    const expanded = expandedProjects[projectId];
    if (typeof expanded === "boolean") return expanded;
    return activeProjectId === projectId;
  };
  const addProjectWorkspaces = (project: Project) => {
    if (!isProjectExpanded(project.id)) return;
    for (const workspace of project.workspaces ?? []) {
      visible.add(workspace.id);
    }
  };

  for (const folder of folders) {
    if (!isFolderExpanded(folder.id)) continue;
    for (const project of folder.projects) addProjectWorkspaces(project);
  }
  for (const project of rootProjects) addProjectWorkspaces(project);
  if (activeWsId && activeWsId !== BRAIN_WORKSPACE_ID) visible.add(activeWsId);

  return [...visible];
}

function SidebarHeaderAction({
  icon,
  label,
  onClick,
  disabled = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="flex items-center justify-center rounded p-0.5 text-muted-foreground/70 transition-colors hover:bg-sidebar-accent/50 hover:text-sidebar-foreground disabled:pointer-events-none disabled:opacity-40"
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
        >
          {icon}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

const sidebarPanelScrollClassName =
  "[&_[data-slot=scroll-area-viewport]>div]:!block [&_[data-slot=scroll-area-viewport]>div]:!min-w-full [&_[data-slot=scroll-area-viewport]>div]:!w-full";

function SidebarPanelScroll({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <ScrollArea className={cn(sidebarPanelScrollClassName, className)}>
      <div className="p-2">{children}</div>
    </ScrollArea>
  );
}

export default function Sidebar({ onAddProject, onAddAutomation, onNewWorkspaceFrom }: SidebarProps) {
  const {
    projects,
    loading,
    recovering: projectsRecovering,
    unavailable: projectsUnavailable,
    ready: projectsReady,
    errorMessage: projectsErrorMessage,
    retryProjects,
    createWorkspace,
    archiveWorkspace,
  } = useProjects();
  const { brain } = useBrain();
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
  const {
    defaultLayout: sidebarSectionsLayout,
    onLayoutChanged: onSidebarSectionsLayoutChanged,
  } = useDefaultLayout({
    id: "hive-sidebar-sections-layout",
    storage: localStorage,
  });

  const activeProjectId = projects.find((project) =>
    (project.workspaces ?? []).some((workspace) => workspace.id === activeWsId),
  )?.id;

  const {
    folders,
    rootProjects,
    hasInitialHydration,
    createFolder,
    renameFolder,
    deleteFolder,
    moveProjectToFolder,
    moveProjectToPosition,
    moveFolderById,
    isFolderExpanded,
    setFolderExpanded,
    getFolderIdForProject,
  } = useSidebarProjectFolders(projects, projectsReady);
  const visiblePrWorkspaceIds = useMemo(
    () => collectVisiblePrWorkspaceIds({
      folders,
      rootProjects,
      expandedProjects,
      activeProjectId,
      activeWsId,
      isFolderExpanded,
    }),
    [activeProjectId, activeWsId, expandedProjects, folders, isFolderExpanded, rootProjects],
  );
  useSyncPrWorkspaces(visiblePrWorkspaceIds);
  const prStatuses = usePrStatusMap(visiblePrWorkspaceIds);
  const sortedAutomations = useMemo(() => {
    if (!automations) return [];
    return [...automations].sort((a, b) => automationSortKey(a) - automationSortKey(b));
  }, [automations]);
  const projectsAppearIncomplete = projectsReady
    && projects.length === 0
    && folders.some((folder) => folder.projectIds.length > folder.projects.length);

  useEffect(() => {
    if (!projectsAppearIncomplete) return;
    const intervalId = setInterval(() => {
      void retryProjects();
    }, 5_000);
    return () => clearInterval(intervalId);
  }, [projectsAppearIncomplete, retryProjects]);

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
    if (!hasInitialHydration) return;
    const folderId = createFolder(newFolderName);
    if (!folderId) return;
    resetFolderComposer();
  };

  const startRenamingFolder = (folderId: string, currentName: string) => {
    if (!hasInitialHydration) return;
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
    if (!hasInitialHydration) return;
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
    if (!hasInitialHydration) return;
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
    if (!hasInitialHydration) return;
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
    if (!hasInitialHydration) return;
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
    if (!hasInitialHydration) return;
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
    if (!hasInitialHydration) return;
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
    if (!hasInitialHydration) return;
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
    if (!hasInitialHydration) return;
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
    const projectInsertIndicator = projectOrderDropTarget?.projectId === project.id
      ? projectOrderDropTarget.position
      : null;

    return (
      <SidebarProjectItem
        key={project.id}
        project={project}
        folderId={folderId}
        className={className}
        displayLabel={displayLabel}
        displayLabelPlain={displayLabelPlain}
        isExpanded={isProjectExpanded(project.id)}
        setExpanded={(open) =>
          setExpandedProjects((prev) => ({ ...prev, [project.id]: open }))
        }
        activeWsId={activeWsId}
        liveData={liveData}
        prStatuses={prStatuses}
        creatingProjectId={creatingProjectId}
        archivingWsId={archivingWsId}
        canReorder={hasInitialHydration}
        draggingProjectId={draggingProjectId}
        projectInsertIndicator={projectInsertIndicator}
        onAddWorkspace={(projectId) => { void handleAddWorkspace(projectId); }}
        onAddWorkspaceFrom={onNewWorkspaceFrom}
        onArchiveWorkspace={(wsId) => { void handleArchiveClick(wsId); }}
        onProjectDragStart={handleProjectDragStart}
        onProjectDragEnd={handleProjectDragEnd}
        onProjectReorderDragOver={handleProjectReorderDragOver}
        onProjectReorderDrop={handleProjectReorderDrop}
      />
    );
  };

  const footerActions = (
    <div className="flex items-center justify-end gap-1 px-2 py-1.5">
      <ShortcutTooltip label="Commands" shortcut={shortcutLabel("K")}>
        <button
          type="button"
          onClick={() => dispatchAppCommand("open-spotlight")}
          className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:text-sidebar-foreground"
          aria-label="Commands"
        >
          <Search className="h-4 w-4" />
        </button>
      </ShortcutTooltip>
      <ShortcutTooltip label="Settings" shortcut={shortcutLabel(",")}>
        <Link
          to="/settings"
          state={{ from: pathname }}
          className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:text-sidebar-foreground"
          aria-label="Settings"
        >
          <Settings className="h-4 w-4" />
        </Link>
      </ShortcutTooltip>
    </div>
  );

  const brainActivity = workspaceActivityState(liveData[BRAIN_WORKSPACE_ID]);
  const brainSidebarEntry = brain.exists ? (
    <Link
      to="/brain"
      className={cn(
        // h-9 mirrors the right-panel ConversationTabs band, and -mt-2 cancels the
        // scroll wrapper's p-2 top padding, so the Brain row lines up exactly with
        // the file/tab bar. Border only when active; transparent at rest avoids shift.
        "-mt-2 mb-3 flex h-9 items-center gap-2 rounded-md border border-transparent px-2 text-sm transition-colors",
        pathname === "/brain"
          ? "sidebar-card-active"
          : "text-sidebar-foreground/80 hover:bg-sidebar-accent/40 hover:text-sidebar-foreground",
      )}
    >
      <span className="relative inline-flex shrink-0">
        <Brain
          className={cn(
            "h-4 w-4 shrink-0",
            pathname === "/brain" ? "text-primary" : "text-sidebar-foreground/70",
          )}
          aria-hidden="true"
        />
        <SidebarActivityDot state={brainActivity} dimmed={pathname === "/brain"} />
      </span>
      <span className="truncate text-sidebar-foreground">Brain</span>
    </Link>
  ) : null;

  const loadedWorkspaceContent = (
    <>
      {(projectsUnavailable || projectsAppearIncomplete) && (
        <div
          className="mb-3 rounded-lg border border-warning-border bg-warning-muted p-3"
          role="alert"
        >
          <div className="flex items-start gap-2.5">
            {projectsRecovering ? (
              <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-warning-foreground" />
            ) : (
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning-foreground" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-sidebar-foreground">
                {projectsAppearIncomplete
                  ? "Repository list looks incomplete"
                  : "Unable to load repositories"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {projectsAppearIncomplete
                  ? "Folders were restored, but the repository list is empty. Hive is retrying automatically."
                  : `${projectsErrorMessage ?? "The repository list is unavailable."} Hive will keep retrying automatically.`}
              </p>
              <Button
                type="button"
                variant="outline"
                size="xs"
                className="mt-3"
                onClick={() => { void retryProjects(); }}
                disabled={projectsRecovering}
              >
                {projectsRecovering && <Loader2 className="h-3 w-3 animate-spin" />}
                {projectsRecovering ? "Retrying..." : "Retry now"}
              </Button>
            </div>
          </div>
        </div>
      )}

      <SidebarSectionHeader
        label="Workspaces"
        className="mb-1"
        actions={
          <>
            <SidebarHeaderAction
              icon={<FolderGit2 className="h-4 w-4" />}
              label="Add repository"
              onClick={onAddProject}
            />
            <SidebarHeaderAction
              icon={<FolderPlus className="h-4 w-4" />}
              label="New folder"
              disabled={!hasInitialHydration}
              onClick={() => {
                if (!hasInitialHydration) return;
                setIsCreatingFolder(true);
                setNewFolderName("");
              }}
            />
          </>
        }
      />

      <SidebarFolderComposer
        isOpen={isCreatingFolder}
        name={newFolderName}
        onNameChange={setNewFolderName}
        onSubmit={handleCreateFolder}
        onCancel={resetFolderComposer}
      />

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
            const folderWorkspaceIds = folder.projects.flatMap((project) =>
              (project.workspaces ?? []).map((ws) => ws.id),
            );
            const folderActivity = aggregateWorkspaceActivity(folderWorkspaceIds, liveData);
            const folderScriptRunning = aggregateScriptRunning(folderWorkspaceIds, liveData);

            return (
              <SidebarFolderItem
                key={folder.id}
                folder={folder}
                expanded={expanded}
                canInteract={hasInitialHydration}
                isActiveDropTarget={isActiveDropTarget}
                containsActiveProject={containsActiveProject}
                isDraggedFolder={isDraggedFolder}
                isRenaming={isRenaming}
                isEmptyFolder={isEmptyFolder}
                draggingFolderId={draggingFolderId}
                folderInsertIndicator={folderInsertIndicator}
                activityState={folderActivity}
                scriptRunning={folderScriptRunning}
                renameDraft={renameDraft}
                onOpenChange={(open) => setFolderExpanded(folder.id, open)}
                onFolderDragOver={handleFolderDragOver}
                onFolderDrop={handleFolderDrop}
                onFolderDragStart={handleFolderDragStart}
                onFolderDragEnd={handleFolderDragEnd}
                onFolderReorderDragOver={handleFolderReorderDragOver}
                onFolderReorderDrop={handleFolderReorderDrop}
                onStartRenaming={startRenamingFolder}
                onDeleteRequest={(folderId, folderName) =>
                  setDeleteFolderTarget({ id: folderId, name: folderName })
                }
                onRenameDraftChange={setRenameDraft}
                onCommitRename={commitRenamingFolder}
                onCancelRename={cancelRenamingFolder}
                renderProjectItem={renderProjectItem}
              />
            );
          })}
        </div>
      )}

      {rootProjects.length > 0 && (
        <div className={cn("space-y-px", folders.length > 0 && "mt-0.5")}>
          {rootProjects.map((project) => renderProjectItem(project, null))}
        </div>
      )}
    </>
  );

  const workspacePanelContent = (
    <>
      {brainSidebarEntry}

      {loading ? (
        <div className="space-y-2 px-2">
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-3/4" />
          <Skeleton className="h-6 w-full" />
        </div>
      ) : (
        loadedWorkspaceContent
      )}
    </>
  );

  const automationPanelContent = (
    <>
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
        <div className="mt-2 space-y-1.5">
          {sortedAutomations.map((auto) => (
            <AutomationRow key={auto.id} auto={auto} pathname={pathname} />
          ))}
        </div>
      )}
    </>
  );
  const deleteFolderTargetId = deleteFolderTarget?.id ?? null;

  return (
    <SidebarShell footerActions={footerActions}>
      <TooltipProvider delayDuration={400}>
        <Group
          orientation="vertical"
          defaultLayout={sidebarSectionsLayout}
          onLayoutChanged={onSidebarSectionsLayoutChanged}
          style={{ flex: 1, minHeight: 0, overflow: "hidden" }}
        >
          <Panel id="workspaces" defaultSize="70%" minSize="25%" className="min-h-0 overflow-hidden">
            <div className="flex h-full min-h-0 flex-col">
              <SidebarPanelScroll className="min-h-0 flex-1">
                {workspacePanelContent}
              </SidebarPanelScroll>
            </div>
          </Panel>

          <ResizeHandle orientation="horizontal" separator="after" />

          <Panel id="automations" defaultSize="30%" minSize="15%" className="min-h-0 overflow-hidden">
            <SidebarPanelScroll className="h-full">
              {automationPanelContent}
            </SidebarPanelScroll>
          </Panel>
        </Group>
      </TooltipProvider>

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
            <AlertDialogAction
              onClick={() => {
                if (!hasInitialHydration || !deleteFolderTargetId) return;
                deleteFolder(deleteFolderTargetId);
                setDeleteFolderTarget(null);
              }}
            >
              Delete
            </AlertDialogAction>
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
    <Link
      to={`/automations/${auto.id}`}
      className={cn(
        "sidebar-card block rounded-md border px-2.5 py-1.5",
        isActive && "sidebar-card-active",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            isRunning
              ? "bg-success animate-pulse"
              : auto.enabled
                ? "bg-success"
                : "bg-muted-foreground/40",
          )}
        />
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-sm",
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
  );
}
