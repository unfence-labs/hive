import { useEffect, useMemo, useState } from "react";
import { GitBranch, MapPin } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { wsTransport } from "@/lib/ws-transport";
import { cn } from "@/lib/utils";
import type { Project } from "@/types";

const AVATAR_COLORS = [
  "bg-red-500",
  "bg-orange-500",
  "bg-amber-500",
  "bg-emerald-500",
  "bg-teal-500",
  "bg-blue-500",
  "bg-indigo-500",
  "bg-purple-500",
  "bg-pink-500",
] as const;

function getProjectColor(name: string): string {
  let hash = 0;
  for (const ch of name) {
    hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

interface SidebarProps {
  projects: Project[];
  loading: boolean;
  onAddProject: () => void;
  onAddWorkspace: (projectId: string) => Promise<unknown>;
}

export default function Sidebar({
  projects,
  loading,
  onAddProject,
  onAddWorkspace,
}: SidebarProps) {
  const workspaceIds = useMemo(
    () =>
      Array.from(
        new Set(
          projects.flatMap((project) => (project.workspaces ?? []).map((workspace) => workspace.id)),
        ),
      ),
    [projects],
  );
  const { wsId: activeWsId } = useParams();
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
  const [creatingProjectId, setCreatingProjectId] = useState<string | null>(null);
  const [liveWorkspaceStatus, setLiveWorkspaceStatus] = useState<
    Record<string, { status: "idle" | "busy"; streaming: boolean }>
  >({});

  useEffect(() => {
    const unsubscribers = workspaceIds.map((workspaceId) =>
      wsTransport.onMessage(workspaceId, (msg) => {
        if (msg.type !== "status") return;
        setLiveWorkspaceStatus((prev) => {
          const next = { status: msg.status, streaming: msg.streaming ?? false };
          const current = prev[workspaceId];
          if (current?.status === next.status && current.streaming === next.streaming) {
            return prev;
          }
          return { ...prev, [workspaceId]: next };
        });
      }),
    );

    return () => {
      for (const sub of unsubscribers) sub.unsubscribe();
    };
  }, [workspaceIds]);

  useEffect(() => {
    const workspaceIdSet = new Set(workspaceIds);
    setLiveWorkspaceStatus((prev) =>
      Object.fromEntries(
        Object.entries(prev).filter(([workspaceId]) => workspaceIdSet.has(workspaceId)),
      ),
    );
  }, [workspaceIds]);

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
      await onAddWorkspace(projectId);
      setExpandedProjects((prev) => ({ ...prev, [projectId]: true }));
    } finally {
      setCreatingProjectId(null);
    }
  };

  return (
    <div className="flex h-full w-60 flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="flex h-14 items-center justify-between border-b px-4">
        <Link to="/" className="font-title text-lg tracking-wide">
          Hive
        </Link>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2">
          {loading ? (
            <div className="space-y-2 px-2">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-6 w-full" />
            </div>
          ) : (
            projects.map((project) => {
              const workspaceStates = (project.workspaces ?? []).map((workspace) => {
                const live = liveWorkspaceStatus[workspace.id];
                return {
                  id: workspace.id,
                  status: live?.status ?? workspace.status,
                  streaming: live?.streaming ?? false,
                };
              });
              const hasActiveSession = workspaceStates.some(
                (workspaceState) => workspaceState.status === "busy",
              );

              return (
                <div key={project.id} className="mb-1">
                  <Collapsible
                    open={isProjectExpanded(project.id)}
                    onOpenChange={(open) =>
                      setExpandedProjects((prev) => ({ ...prev, [project.id]: open }))
                    }
                  >
                    <div className="group flex items-center">
                      <CollapsibleTrigger asChild>
                        <button
                          type="button"
                          className={cn(
                            "flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm font-medium hover:bg-sidebar-accent",
                            activeProjectId === project.id && "bg-sidebar-accent",
                          )}
                        >
                          <span
                            className={cn(
                              "flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold text-white",
                              getProjectColor(project.name),
                            )}
                          >
                            {project.name[0]?.toUpperCase() ?? "?"}
                          </span>
                          <span className="min-w-0 flex-1 truncate">{project.name}</span>
                          {hasActiveSession && (
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />
                          )}
                          <span
                            role="button"
                            tabIndex={-1}
                            className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-sidebar-foreground group-hover:opacity-100"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleAddWorkspace(project.id);
                            }}
                            aria-label={`Add workspace to ${project.name}`}
                            title={`Add workspace to ${project.name}`}
                          >
                            {creatingProjectId === project.id ? "..." : "+"}
                          </span>
                        </button>
                      </CollapsibleTrigger>
                    </div>
                    <CollapsibleContent>
                      <div className="mt-1 space-y-0.5">
                        {(project.workspaces ?? []).map((ws) => {
                          const live = liveWorkspaceStatus[ws.id];
                          const wsStatus = live?.status ?? ws.status;
                          const wsStreaming = live?.streaming ?? false;
                          return (
                            <Link
                              key={ws.id}
                              to={`/workspaces/${ws.id}`}
                              className={cn(
                                "block rounded-md px-2 py-1.5 hover:bg-sidebar-accent",
                                activeWsId === ws.id && "bg-sidebar-accent",
                              )}
                            >
                              <div className="flex items-center gap-1.5">
                                <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                <span
                                  className={cn(
                                    "h-1.5 w-1.5 shrink-0 rounded-full",
                                    wsStatus === "busy" ? "bg-blue-500" : "bg-muted-foreground/40",
                                  )}
                                />
                                <span className="min-w-0 flex-1 truncate text-sm">{ws.branch}</span>
                                {wsStreaming && (
                                  <span className="shrink-0 text-[11px] text-muted-foreground">
                                    Working
                                  </span>
                                )}
                              </div>
                              <div className="mt-0.5 flex items-center gap-1.5 pl-5 text-[11px] text-muted-foreground">
                                <MapPin className="h-3 w-3 shrink-0" />
                                <span className="truncate">{ws.name}</span>
                              </div>
                            </Link>
                          );
                        })}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>

      <div className="border-t p-2">
        <Button variant="outline" className="w-full" onClick={onAddProject}>
          + Add Project
        </Button>
      </div>
    </div>
  );
}
