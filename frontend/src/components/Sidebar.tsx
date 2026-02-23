import { useState } from "react";
import { ArchiveIcon, FolderPlus, Plus, Settings } from "lucide-react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
import { useQueryClient } from "@tanstack/react-query";
import { useWorkspaceLiveDataContext } from "@/contexts/WorkspaceLiveDataContext";
import { useProjects } from "@/hooks/useProjects";
import { BranchLabel } from "@/components/BranchLabel";
import AgentActivityPreview from "@/components/chat/AgentActivityPreview";
import { WaveIndicator } from "@/components/WaveIndicator";
import { api } from "@/hooks/useApi";
import { cn } from "@/lib/utils";
import { ProjectAvatar } from "@/components/ProjectAvatar";
import type { DiffStatResponse } from "@/types";

interface SidebarProps {
  onAddProject: () => void;
}

export default function Sidebar({ onAddProject }: SidebarProps) {
  const { projects, loading, createWorkspace, archiveWorkspace } = useProjects();
  const queryClient = useQueryClient();
  const { wsId: activeWsId } = useParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
  const [creatingProjectId, setCreatingProjectId] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<string | null>(null);
  const liveData = useWorkspaceLiveDataContext();

  const activeProjectId = projects.find((project) =>
    (project.workspaces ?? []).some((workspace) => workspace.id === activeWsId),
  )?.id;

  const isProjectExpanded = (projectId: string) => {
    const expanded = expandedProjects[projectId];
    if (typeof expanded === "boolean") return expanded;
    return activeProjectId === projectId;
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
    const wasActive = activeWsId === wsId;
    await archiveWorkspace(wsId);
    if (wasActive) navigate("/projects");
  };

  return (
    <div className="flex h-full w-72 flex-col border-r border-border/50 bg-sidebar text-sidebar-foreground">
      <div
        className="shrink-0"
        style={{ height: "var(--titlebar-inset, 0px)" }}
        data-tauri-drag-region
      />

      <ScrollArea className="flex-1 [&_[data-slot=scroll-area-viewport]>div]:!block [&_[data-slot=scroll-area-viewport]>div]:!min-w-full [&_[data-slot=scroll-area-viewport]>div]:!w-full">
        <div className="p-2">
          {loading ? (
            <div className="space-y-2 px-2">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-6 w-full" />
            </div>
          ) : (
            projects.map((project) => (
                <div key={project.id} className="mb-1">
                  <Collapsible
                    open={isProjectExpanded(project.id)}
                    onOpenChange={(open) =>
                      setExpandedProjects((prev) => ({ ...prev, [project.id]: open }))
                    }
                  >
                    <div className="group relative flex w-full items-center">
                      <CollapsibleTrigger asChild>
                        <button
                          type="button"
                          className={cn(
                            "flex w-full min-w-0 items-center gap-2.5 overflow-hidden rounded-md px-2 py-1.5 text-left text-sm font-medium transition-colors hover:bg-sidebar-accent/60",
                            activeProjectId === project.id && "bg-sidebar-accent/60",
                          )}
                        >
                          <ProjectAvatar name={project.name} projectId={project.id} hasFavicon={project.hasFavicon} />
                          <span className="min-w-0 flex-1 truncate pr-0 transition-[padding] group-hover:pr-12">
                            {project.name}
                            {(project.workspaces ?? []).length > 0 && (
                              <span className="ml-2.5 text-sm tabular-nums text-muted-foreground/40">
                                {(project.workspaces ?? []).length}
                              </span>
                            )}
                          </span>
                        </button>
                      </CollapsibleTrigger>
                      <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center gap-1 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
                        <button
                          type="button"
                          className="shrink-0 rounded px-1 py-0.5 text-xs text-muted-foreground transition-colors hover:text-sidebar-foreground"
                          onClick={() => {
                            void handleAddWorkspace(project.id);
                          }}
                          aria-label={`Add workspace to ${project.name}`}
                          title={`Add workspace to ${project.name}`}
                        >
                          {creatingProjectId === project.id ? "..." : <Plus className="h-3 w-3" />}
                        </button>
                      </div>
                    </div>
                    <CollapsibleContent>
                      <div className="mt-1 space-y-0.5">
                        {(project.workspaces ?? []).map((ws) => {
                          const wsLive = liveData[ws.id];
                          const wsStreaming = wsLive?.streaming ?? false;
                          const wsScriptRunning = wsLive?.scriptRunning ?? false;
                          const displayBranch = wsLive?.branch ?? ws.branch;
                          return (
                            <div key={ws.id} className="group/ws relative">
                              <Link
                                to={`/workspaces/${ws.id}`}
                                className={cn(
                                  "block rounded-md px-2 py-1.5 transition-colors hover:bg-sidebar-accent/60",
                                  activeWsId === ws.id && "bg-primary/8",
                                )}
                              >
                                <div className="flex items-center gap-1.5">
                                  {wsStreaming && (
                                    <div className="flex h-3.5 w-3.5 shrink-0 items-center justify-center overflow-visible">
                                      <AgentActivityPreview size="small" />
                                    </div>
                                  )}
                                  <BranchLabel branch={displayBranch} showIcon={!wsStreaming} className="min-w-0 flex-1 text-sm" />
                                  {wsScriptRunning && (
                                    <WaveIndicator className="shrink-0" />
                                  )}
                                </div>
                                <div className="mt-0.5 pl-5 text-[11px] text-muted-foreground">
                                  <span className="truncate">{ws.name}</span>
                                </div>
                              </Link>
                              {!wsScriptRunning && (
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
                </div>
              ))
          )}
        </div>
      </ScrollArea>

      <div className="flex items-center border-t border-border/50 px-3 py-2">
        <button
          type="button"
          className="flex flex-1 items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-sidebar-foreground"
          onClick={onAddProject}
        >
          <FolderPlus className="h-4 w-4" />
          Add repository
        </button>
        <Link
          to="/settings"
          state={{ from: pathname }}
          className="rounded p-1 text-muted-foreground transition-colors hover:text-sidebar-foreground"
          aria-label="Settings"
          title="Settings"
        >
          <Settings className="h-4 w-4" />
        </Link>
      </div>

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

    </div>
  );
}
