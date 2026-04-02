import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useProjects } from "@/hooks/useProjects";
import { useWorkspaceLiveDataContext } from "@/contexts/WorkspaceLiveDataContext";
import { ConversationTile } from "@/components/mosaic/ConversationTile";
import { cn } from "@/lib/utils";
import type { Workspace } from "@/types";

const MAX_TILES = 4;

interface WorkspaceWithProject extends Workspace {
  projectId: string;
}

export default function MosaicView() {
  const navigate = useNavigate();
  const { projects } = useProjects();
  const liveData = useWorkspaceLiveDataContext();

  const allWorkspaces = useMemo<WorkspaceWithProject[]>(
    () =>
      projects.flatMap((p) =>
        (p.workspaces ?? []).map((ws) => ({ ...ws, projectId: p.id })),
      ),
    [projects],
  );

  const selectedWorkspaces = useMemo(() => {
    if (allWorkspaces.length === 0) return [];

    const streaming = allWorkspaces.filter(
      (ws) => liveData[ws.id]?.streaming,
    );

    if (streaming.length >= MAX_TILES) {
      return streaming.slice(0, MAX_TILES);
    }

    const streamingIds = new Set(streaming.map((ws) => ws.id));
    const rest = allWorkspaces
      .filter((ws) => !streamingIds.has(ws.id))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return [...streaming, ...rest].slice(0, MAX_TILES);
  }, [allWorkspaces, liveData]);

  const tileCount = selectedWorkspaces.length;
  const hasSecondRow = tileCount > 2;
  const lastTileSpans = tileCount === 3;

  return (
    <div className="flex h-screen flex-col bg-background">
      <div
        className="flex h-10 shrink-0 items-center gap-3 border-b border-border bg-card px-3"
        style={{ paddingLeft: "max(var(--traffic-light-clearance, 0px), 0.75rem)" }}
        data-tauri-drag-region
      >
        <Link
          to="/home"
          className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back</span>
        </Link>
        <span className="text-xs font-medium">Mosaic</span>
      </div>

      {tileCount === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-muted-foreground">No workspaces yet</p>
        </div>
      ) : (
        <div
          className={cn(
            "grid min-h-0 flex-1",
            "max-md:grid-cols-1 max-md:auto-rows-[minmax(300px,1fr)] max-md:overflow-y-auto",
            "md:grid-cols-2",
            hasSecondRow ? "md:grid-rows-2" : "md:grid-rows-1",
          )}
        >
          {selectedWorkspaces.map((ws, index) => {
            const isLeftCol = index % 2 === 0;
            const isTopRow = index < 2;
            const spans = lastTileSpans && index === tileCount - 1;

            return (
              <ConversationTile
                key={ws.id}
                wsId={ws.id}
                workspace={ws}
                onJumpOut={(id) => navigate(`/workspaces/${id}`)}
                className={cn(
                  spans && "md:col-span-2",
                  isLeftCol && !spans && tileCount > 1 && "md:border-r md:border-border",
                  isTopRow && hasSecondRow && "md:border-b md:border-border",
                )}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
