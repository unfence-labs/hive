import { useMemo, type ReactNode } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { ProjectAvatar } from "@/components/ProjectAvatar";
import { BranchLabel } from "@/components/BranchLabel";
import AgentActivityPreview from "@/components/chat/AgentActivityPreview";
import { parseProjectOwnerRepo } from "@/components/Sidebar";
import { useProjects } from "@/hooks/useProjects";
import { useWorkspaceLiveDataContext } from "@/contexts/WorkspaceLiveDataContext";
import type { SessionTile } from "@/hooks/useAllSessions";
import { cn } from "@/lib/utils";

interface SessionPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessions: SessionTile[];
  hiddenIds: string[];
  onToggle: (tileId: string) => void;
  children: ReactNode;
}

export function SessionPicker({
  open,
  onOpenChange,
  sessions,
  hiddenIds,
  onToggle,
  children,
}: SessionPickerProps) {
  const { projects } = useProjects();
  const liveData = useWorkspaceLiveDataContext();

  const hiddenSet = useMemo(() => new Set(hiddenIds), [hiddenIds]);

  // Group sessions by project → workspace
  const grouped = useMemo(() => {
    const projectMap = new Map<string, typeof projects[number]>();
    for (const p of projects) projectMap.set(p.id, p);

    // Build workspace → project mapping
    const wsToProject = new Map<string, string>();
    for (const p of projects) {
      for (const ws of p.workspaces ?? []) {
        wsToProject.set(ws.id, p.id);
      }
    }

    // Group sessions by project then workspace
    type WsGroup = { wsId: string; wsName: string; branch: string; sessions: SessionTile[] };
    type ProjectGroup = { projectId: string; label: string; url: string; name: string; hasFavicon?: boolean; workspaces: WsGroup[] };

    const projectGroups = new Map<string, ProjectGroup>();
    const wsGroups = new Map<string, WsGroup>();

    for (const tile of sessions) {
      const projectId = wsToProject.get(tile.wsId) ?? "unknown";

      if (!projectGroups.has(projectId)) {
        const project = projectMap.get(projectId);
        const parsed = project ? parseProjectOwnerRepo(project.url) : null;
        projectGroups.set(projectId, {
          projectId,
          label: parsed ? `${parsed.owner}/${parsed.repo}` : project?.name ?? "Unknown",
          url: project?.url ?? "",
          name: project?.name ?? "",
          hasFavicon: project?.hasFavicon,
          workspaces: [],
        });
      }

      if (!wsGroups.has(tile.wsId)) {
        const ws = projects.flatMap((p) => p.workspaces ?? []).find((w) => w.id === tile.wsId);
        const wsLive = liveData[tile.wsId];
        const group: WsGroup = {
          wsId: tile.wsId,
          wsName: ws?.name ?? tile.wsId,
          branch: wsLive?.branch ?? ws?.branch ?? "",
          sessions: [],
        };
        wsGroups.set(tile.wsId, group);
        projectGroups.get(projectId)!.workspaces.push(group);
      }

      wsGroups.get(tile.wsId)!.sessions.push(tile);
    }

    return [...projectGroups.values()];
  }, [sessions, projects, liveData]);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>

      <PopoverContent className="w-80 p-0">
        <div className="border-b border-border px-3 py-2.5">
          <p className="text-sm font-medium">Choose sessions</p>
          <p className="text-xs text-muted-foreground">
            Toggle individual sessions to show or hide in mosaic view.
          </p>
        </div>

        <ScrollArea className="max-h-[420px]">
          <div className="space-y-4 p-3">
            {grouped.map((pg) => (
              <div key={pg.projectId}>
                <div className="mb-1.5 flex items-center gap-2">
                  <ProjectAvatar
                    name={pg.name}
                    projectId={pg.projectId}
                    hasFavicon={pg.hasFavicon}
                    className="h-4 w-4"
                  />
                  <span className="text-xs font-semibold lowercase tracking-wider text-muted-foreground">
                    {pg.label}
                  </span>
                </div>

                <div className="space-y-2">
                  {pg.workspaces.map((wsg) => {
                    const wsLive = liveData[wsg.wsId];
                    const displayBranch = wsLive?.branch ?? wsg.branch;

                    return (
                      <div key={wsg.wsId}>
                        {/* Workspace sub-header */}
                        <div className="flex items-center gap-1.5 px-2 py-1">
                          <span className="text-xs font-medium text-foreground/80">
                            {wsg.wsName}
                          </span>
                          {displayBranch && (
                            <>
                              <span className="text-muted-foreground/40">·</span>
                              <BranchLabel
                                branch={displayBranch}
                                showIcon={false}
                                className="truncate text-[10px] text-muted-foreground"
                              />
                            </>
                          )}
                        </div>

                        {/* Sessions */}
                        <div className="space-y-0.5">
                          {wsg.sessions.map((tile, idx) => {
                            const isVisible = !hiddenSet.has(tile.tileId);
                            const streaming =
                              wsLive?.streamingSessions?.[tile.session.sessionId] ?? false;

                            return (
                              <button
                                key={tile.tileId}
                                type="button"
                                onClick={() => onToggle(tile.tileId)}
                                className={cn(
                                  "flex w-full items-center gap-2.5 rounded-md px-2 py-1 text-left transition-colors",
                                  "hover:bg-muted/50",
                                )}
                              >
                                <Checkbox
                                  checked={isVisible}
                                  onCheckedChange={() => onToggle(tile.tileId)}
                                  tabIndex={-1}
                                  className="pointer-events-none"
                                />

                                <div className="flex min-w-0 flex-1 items-center gap-1.5">
                                  <span className="truncate text-xs">
                                    {tile.session.title || `Session ${idx + 1}`}
                                  </span>
                                  {tile.isActive && (
                                    <span className="shrink-0 rounded bg-primary/15 px-1 py-0.5 text-[9px] font-medium text-primary">
                                      Active
                                    </span>
                                  )}
                                </div>

                                {streaming && (
                                  <AgentActivityPreview size="small" />
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
