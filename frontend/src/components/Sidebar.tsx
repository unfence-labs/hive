import { useMemo, useState } from "react";
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
import { useQueryClient } from "@tanstack/react-query";
import { useWorkspaceLiveDataContext } from "@/contexts/WorkspaceLiveDataContext";
import { useProjects } from "@/hooks/useProjects";
import { useBulkPrStatus } from "@/hooks/usePrStatus";
import { computePrDisplayCompact } from "@/lib/pr-display";
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

type SidebarTab = "build" | "automation";

export default function Sidebar({ onAddProject }: SidebarProps) {
  const { projects, loading, createWorkspace, archiveWorkspace } = useProjects();
  const queryClient = useQueryClient();
  const { wsId: activeWsId } = useParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
  const [creatingProjectId, setCreatingProjectId] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<SidebarTab>("build");
  const liveData = useWorkspaceLiveDataContext();

  const activeProjectId = projects.find((project) =>
    (project.workspaces ?? []).some((workspace) => workspace.id === activeWsId),
  )?.id;

  const allWsIds = useMemo(
    () => projects.flatMap((p) => (p.workspaces ?? []).map((ws) => ws.id)),
    [projects],
  );
  const { results: prStatuses } = useBulkPrStatus(allWsIds);

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
        style={{ height: "max(var(--titlebar-inset, 0px), 3rem)" }}
        data-tauri-drag-region
      />

      {/* ── Tab content ─────────────────────────────────────────────── */}
      {activeTab === "build" ? (
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
                {projects.map((project, index) => (
                  <div
                    key={project.id}
                    className={cn(index > 0 && "mt-3 border-t border-border/30 pt-3")}
                  >
                    <Collapsible
                      open={isProjectExpanded(project.id)}
                      onOpenChange={(open) =>
                        setExpandedProjects((prev) => ({ ...prev, [project.id]: open }))
                      }
                    >
                      {/* ── Project header ──────────────────────────────── */}
                      <div className="group relative flex w-full items-center">
                        <CollapsibleTrigger asChild>
                          <button
                            type="button"
                            className="flex w-full min-w-0 items-center gap-2.5 overflow-hidden rounded-md bg-[#1e1e28] px-2.5 py-2 text-left transition-colors hover:bg-[#252532]"
                          >
                            <ProjectAvatar
                              name={project.name}
                              projectId={project.id}
                              hasFavicon={project.hasFavicon}
                              className="h-5 w-5"
                            />
                            <span className="min-w-0 flex-1 truncate text-xs font-semibold uppercase tracking-wider text-muted-foreground pr-0 transition-[padding] group-hover:pr-10">
                              {project.name}
                              {(project.workspaces ?? []).length > 0 && (
                                <span className="ml-1.5 text-[10px] tabular-nums text-muted-foreground/40">
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

                      {/* ── Workspace list ──────────────────────────────── */}
                      <CollapsibleContent>
                        <div className="mt-1 space-y-0.5">
                          {(project.workspaces ?? []).map((ws) => {
                            const wsLive = liveData[ws.id];
                            const wsStreaming = wsLive?.streaming ?? false;
                            const wsScriptRunning = wsLive?.scriptRunning ?? false;
                            const displayBranch = wsLive?.branch ?? ws.branch;
                            const wsUnread = !wsStreaming && Object.keys(wsLive?.unreadSessions ?? {}).length > 0;
                            const prStatus = prStatuses[ws.id];

                            return (
                              <div key={ws.id} className="group/ws relative">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Link
                                      to={`/workspaces/${ws.id}`}
                                      className={cn(
                                        "block rounded-md py-1.5 pl-2 pr-2 transition-colors hover:bg-sidebar-accent/60",
                                        activeWsId === ws.id
                                          ? "border-2 border-dashed border-primary/50"
                                          : "border-2 border-transparent",
                                      )}
                                    >
                                      {/* Line 1: activity + branch + wave */}
                                      <div className="flex items-center gap-1.5">
                                        {wsStreaming ? (
                                          <div className="flex h-3.5 w-3.5 shrink-0 items-center justify-center overflow-visible">
                                            <AgentActivityPreview size="small" />
                                          </div>
                                        ) : wsUnread ? (
                                          <div className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                                            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                                          </div>
                                        ) : null}
                                        <BranchLabel branch={displayBranch} showIcon={!wsStreaming && !wsUnread} className="min-w-0 flex-1 text-sm" />
                                        {wsScriptRunning && (
                                          <WaveIndicator className="shrink-0" />
                                        )}
                                      </div>

                                      {/* Line 2: PR status */}
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
                                        ) : prStatus && !prStatus.pr ? (
                                          <span className="text-muted-foreground">No PR</span>
                                        ) : null}
                                      </div>
                                    </Link>
                                  </TooltipTrigger>
                                  <TooltipContent side="right" className="text-xs">
                                    {ws.name}
                                  </TooltipContent>
                                </Tooltip>

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
                ))}
              </TooltipProvider>
            )}

          </div>
        </ScrollArea>
      ) : (
        /* ── Automation placeholder ────────────────────────────────── */
        <div className="flex flex-1 items-center justify-center">
          <span className="text-sm text-muted-foreground">Coming soon</span>
        </div>
      )}

      {/* ── Add repository (build tab only) ─────────────────────────── */}
      {activeTab === "build" && (
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
      )}

      {/* ── Footer: tabs + settings ─────────────────────────────────── */}
      <div className="flex items-center border-t border-border/50 px-2 py-1.5">
        <div className="flex flex-1 gap-0.5">
          {(["build", "automation"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                activeTab === tab
                  ? "bg-sidebar-accent text-sidebar-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/40 hover:text-sidebar-foreground",
              )}
            >
              {tab === "build" ? "Build" : "Automation"}
            </button>
          ))}
        </div>
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
