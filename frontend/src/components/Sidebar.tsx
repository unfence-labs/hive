import { useEffect, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
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
                    <div className="group flex items-center gap-1">
                      <CollapsibleTrigger asChild>
                        <button
                          type="button"
                          className={cn(
                            "flex flex-1 items-center gap-1 rounded-md px-2 py-1.5 text-left text-sm font-medium hover:bg-sidebar-accent",
                            activeProjectId === project.id && "bg-sidebar-accent",
                          )}
                        >
                          <ChevronRight
                            className={cn(
                              "h-3.5 w-3.5 shrink-0 transition-transform",
                              isProjectExpanded(project.id) && "rotate-90",
                            )}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate">{project.name}</span>
                            <span className="mt-0.5 flex items-center gap-1 text-[11px] font-normal text-muted-foreground">
                              <span
                                className={cn(
                                  "inline-block h-1.5 w-1.5 rounded-full",
                                  hasActiveSession ? "bg-blue-500" : "bg-muted-foreground/40",
                                )}
                              />
                            </span>
                          </span>
                        </button>
                      </CollapsibleTrigger>
                      <button
                        type="button"
                        className="mr-1 rounded p-0.5 text-muted-foreground transition-colors hover:text-sidebar-foreground"
                        onClick={() => handleAddWorkspace(project.id)}
                        aria-label={`Add workspace to ${project.name}`}
                        title={`Add workspace to ${project.name}`}
                        disabled={creatingProjectId !== null}
                      >
                        {creatingProjectId === project.id ? "..." : "+"}
                      </button>
                    </div>
                    <CollapsibleContent>
                      <div className="space-y-0.5 pl-5">
                        {(project.workspaces ?? []).map((ws) => {
                          const live = liveWorkspaceStatus[ws.id];
                          const wsStatus = live?.status ?? ws.status;
                          const wsStreaming = live?.streaming ?? false;
                          return (
                            <Link
                              key={ws.id}
                              to={`/workspaces/${ws.id}`}
                              className={cn(
                                "flex items-center gap-1.5 rounded-md px-2 py-1 text-sm hover:bg-sidebar-accent",
                                activeWsId === ws.id && "bg-sidebar-accent",
                              )}
                            >
                              <span
                                className={cn(
                                  "inline-block h-2 w-2 rounded-full",
                                  wsStatus === "busy" ? "bg-blue-500" : "bg-muted-foreground/40",
                                )}
                              />
                              <span className="truncate">{ws.name}</span>
                              {wsStreaming ? (
                                <span className="ml-auto text-[11px] text-muted-foreground">
                                  Working
                                </span>
                              ) : null}
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
