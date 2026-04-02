import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, CircleAlert, Pencil, Plus } from "lucide-react";
import { useProjects } from "@/hooks/useProjects";
import { useWorkspaceLiveDataContext } from "@/contexts/WorkspaceLiveDataContext";
import { useMosaicWorkspaces, MAX_MOSAIC } from "@/hooks/useMosaicWorkspaces";
import { ConversationTile } from "@/components/mosaic/ConversationTile";
import { WorkspacePicker } from "@/components/mosaic/WorkspacePicker";
import AgentActivityPreview from "@/components/chat/AgentActivityPreview";
import { cn } from "@/lib/utils";
import type { Workspace } from "@/types";

interface WorkspaceWithProject extends Workspace {
  projectId: string;
}

export default function MosaicView() {
  const navigate = useNavigate();
  const { projects } = useProjects();
  const liveData = useWorkspaceLiveDataContext();
  const { selectedIds, setSelectedIds, toggleId } = useMosaicWorkspaces();

  const [pickerOpen, setPickerOpen] = useState(false);

  // "Needs input" state reported by each tile
  const [needsInputMap, setNeedsInputMap] = useState<Record<string, boolean>>({});
  const handleNeedsInputChange = useCallback((wsId: string, needsInput: boolean) => {
    setNeedsInputMap((prev) => {
      if (prev[wsId] === needsInput) return prev;
      return { ...prev, [wsId]: needsInput };
    });
  }, []);

  const allWorkspaces = useMemo<WorkspaceWithProject[]>(
    () =>
      projects.flatMap((p) =>
        (p.workspaces ?? []).map((ws) => ({ ...ws, projectId: p.id })),
      ),
    [projects],
  );

  const wsById = useMemo(() => {
    const map = new Map<string, WorkspaceWithProject>();
    for (const ws of allWorkspaces) map.set(ws.id, ws);
    return map;
  }, [allWorkspaces]);

  // Auto-populate on first visit (selectedIds empty) once workspaces load
  const didAutoPopulate = useRef(false);
  useEffect(() => {
    if (didAutoPopulate.current) return;
    if (allWorkspaces.length === 0) return;
    if (selectedIds.length > 0) {
      didAutoPopulate.current = true;
      return;
    }

    const streaming = allWorkspaces.filter((ws) => liveData[ws.id]?.streaming);
    if (streaming.length >= MAX_MOSAIC) {
      setSelectedIds(streaming.slice(0, MAX_MOSAIC).map((ws) => ws.id));
    } else {
      const streamingIds = new Set(streaming.map((ws) => ws.id));
      const rest = allWorkspaces
        .filter((ws) => !streamingIds.has(ws.id))
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setSelectedIds([...streaming, ...rest].slice(0, MAX_MOSAIC).map((ws) => ws.id));
    }
    didAutoPopulate.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-time auto-populate
  }, [allWorkspaces]);

  // Resolve persisted IDs to workspace objects, filtering stale
  const selectedWorkspaces = useMemo(() => {
    const resolved: WorkspaceWithProject[] = [];
    for (const id of selectedIds) {
      const ws = wsById.get(id);
      if (ws) resolved.push(ws);
    }
    return resolved;
  }, [selectedIds, wsById]);

  // Clean up stale IDs from persistence
  useEffect(() => {
    if (allWorkspaces.length === 0) return;
    const validIds = selectedIds.filter((id) => wsById.has(id));
    if (validIds.length !== selectedIds.length) {
      setSelectedIds(validIds);
    }
  }, [selectedIds, wsById, allWorkspaces.length, setSelectedIds]);

  const tileCount = selectedWorkspaces.length;
  // Layout: 1→2col 1row (+1 empty), 2→2col 1row, 3→2col 2row (3rd spans), 4→2col 2row
  const hasSecondRow = tileCount >= 3;
  const emptySlotCount = tileCount === 1 ? 1 : 0;

  // Toolbar summary
  const streamingCount = selectedWorkspaces.filter((ws) => liveData[ws.id]?.streaming).length;
  const needsInputCount = Object.values(needsInputMap).filter(Boolean).length;

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* ── Toolbar ─────────────────────────────────────────────────── */}
      <div
        className="flex h-10 shrink-0 items-center gap-3 border-b border-border bg-card px-3"
        style={{ paddingLeft: "max(var(--traffic-light-clearance, 0px), 0.75rem)" }}
        data-tauri-drag-region
      >
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back</span>
        </button>
        <span className="text-xs font-medium">Mosaic</span>

        {/* Summary */}
        <div className="flex flex-1 items-center justify-center gap-3 text-xs text-muted-foreground">
          {streamingCount > 0 && (
            <span className="flex items-center gap-1.5">
              <AgentActivityPreview size="small" />
              {streamingCount} streaming
            </span>
          )}
          {needsInputCount > 0 && (
            <span className="flex items-center gap-1.5 text-amber-400">
              <CircleAlert className="h-3 w-3" />
              {needsInputCount} needs input
            </span>
          )}
        </div>

        {/* Edit button */}
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <Pencil className="h-3 w-3" />
          <span>Edit</span>
        </button>
      </div>

      {/* ── Grid ────────────────────────────────────────────────────── */}
      {tileCount === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3">
          <p className="text-sm text-muted-foreground">No workspaces selected</p>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="flex items-center gap-2 text-xs text-primary transition-colors hover:text-primary/80"
          >
            <Plus className="h-3.5 w-3.5" />
            Add workspaces
          </button>
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
            const isLastTile = index === tileCount - 1;
            const spans = tileCount === 3 && isLastTile;

            return (
              <ConversationTile
                key={ws.id}
                wsId={ws.id}
                workspace={ws}
                onJumpOut={(id) => navigate(`/workspaces/${id}`, { state: { fromMosaic: true } })}
                onNeedsInputChange={handleNeedsInputChange}
                className={cn(
                  spans && "md:col-span-2",
                  isLeftCol && !spans && "md:border-r md:border-border",
                  isTopRow && hasSecondRow && "md:border-b md:border-border",
                )}
              />
            );
          })}

          {/* Empty tile slot (only shown with 1 workspace) */}
          {emptySlotCount > 0 && (
            <button
              key="empty-slot"
              type="button"
              onClick={() => setPickerOpen(true)}
              className={cn(
                "flex flex-col items-center justify-center gap-2 border border-dashed border-border/40 transition-colors hover:border-border hover:bg-muted/20",
                "max-md:min-h-[200px]",
              )}
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-full border border-dashed border-muted-foreground/30">
                <Plus className="h-4 w-4 text-muted-foreground/60" />
              </div>
              <span className="text-xs text-muted-foreground/60">Add workspace</span>
            </button>
          )}
        </div>
      )}

      {/* ── Workspace Picker ────────────────────────────────────────── */}
      <WorkspacePicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        selectedIds={selectedIds}
        onToggle={toggleId}
      />
    </div>
  );
}
