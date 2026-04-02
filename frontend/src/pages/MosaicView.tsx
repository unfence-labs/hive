import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Group, Panel } from "react-resizable-panels";
import { ArrowLeft, CircleAlert, Eye, Pencil, Plus } from "lucide-react";
import { useProjects } from "@/hooks/useProjects";
import { useWorkspaceLiveDataContext } from "@/contexts/WorkspaceLiveDataContext";
import { useMosaicWorkspaces, MAX_MOSAIC } from "@/hooks/useMosaicWorkspaces";
import { ConversationTile } from "@/components/mosaic/ConversationTile";
import { WorkspacePicker } from "@/components/mosaic/WorkspacePicker";
import { ResizeHandle } from "@/components/ResizeHandle";
import AgentActivityPreview from "@/components/chat/AgentActivityPreview";
import { parseProjectOwnerRepo } from "@/components/Sidebar";
import { cn } from "@/lib/utils";
import type { Workspace } from "@/types";

interface WorkspaceWithProject extends Workspace {
  projectId: string;
  projectUrl: string;
  projectName: string;
}

export default function MosaicView() {
  const navigate = useNavigate();
  const { projects } = useProjects();
  const liveData = useWorkspaceLiveDataContext();
  const { selectedIds, setSelectedIds, toggleId, removeId } = useMosaicWorkspaces();

  const [pickerOpen, setPickerOpen] = useState(false);

  // Hidden tiles (visible in mosaic selection but collapsed)
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());

  // Drag-to-reorder state
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

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
        (p.workspaces ?? []).map((ws) => ({
          ...ws,
          projectId: p.id,
          projectUrl: p.url,
          projectName: p.name,
        })),
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
        .sort((a, b) => {
          const aUnread = Object.keys(liveData[a.id]?.unreadSessions ?? {}).length > 0 ? 1 : 0;
          const bUnread = Object.keys(liveData[b.id]?.unreadSessions ?? {}).length > 0 ? 1 : 0;
          if (bUnread !== aUnread) return bUnread - aUnread;
          const aBusy = liveData[a.id]?.status === "busy" ? 1 : 0;
          const bBusy = liveData[b.id]?.status === "busy" ? 1 : 0;
          if (bBusy !== aBusy) return bBusy - aBusy;
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });
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

  // Visible (not hidden) workspaces
  const visibleWorkspaces = useMemo(
    () => selectedWorkspaces.filter((ws) => !hiddenIds.has(ws.id)),
    [selectedWorkspaces, hiddenIds],
  );
  const hiddenWorkspaces = useMemo(
    () => selectedWorkspaces.filter((ws) => hiddenIds.has(ws.id)),
    [selectedWorkspaces, hiddenIds],
  );

  const tileCount = visibleWorkspaces.length;

  // Toolbar summary
  const streamingCount = selectedWorkspaces.filter((ws) => liveData[ws.id]?.streaming).length;
  const needsInputCount = Object.values(needsInputMap).filter(Boolean).length;

  // Project label for a workspace
  const getProjectLabel = (ws: WorkspaceWithProject) => {
    const parsed = parseProjectOwnerRepo(ws.projectUrl);
    return parsed ? `${parsed.owner}/${parsed.repo}` : ws.projectName;
  };

  // ── Drag-to-reorder ───────────────────────────────────────────────
  const handleDragStart = (index: number) => {
    setDragIndex(index);
  };
  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverIndex(index);
  };
  const handleDrop = (targetIndex: number) => {
    if (dragIndex === null || dragIndex === targetIndex) {
      setDragIndex(null);
      setDragOverIndex(null);
      return;
    }
    // Reorder the visible IDs
    const visibleIds = visibleWorkspaces.map((ws) => ws.id);
    const [moved] = visibleIds.splice(dragIndex, 1);
    visibleIds.splice(targetIndex, 0, moved);
    // Rebuild full selection: visible (reordered) + hidden
    const hiddenIdsArr = hiddenWorkspaces.map((ws) => ws.id);
    setSelectedIds([...visibleIds, ...hiddenIdsArr]);
    setDragIndex(null);
    setDragOverIndex(null);
  };
  const handleDragEnd = () => {
    setDragIndex(null);
    setDragOverIndex(null);
  };

  const handleHide = useCallback((wsId: string) => {
    setHiddenIds((prev) => new Set([...prev, wsId]));
  }, []);

  const handleShow = useCallback((wsId: string) => {
    setHiddenIds((prev) => {
      const next = new Set(prev);
      next.delete(wsId);
      return next;
    });
  }, []);

  // ── Layout: split into rows for resizable panels ──────────────────
  // Row 1: first N tiles, Row 2: remaining tiles (N = colCount derived from tileCount)
  const colCount = tileCount <= 1 ? 1 : tileCount <= 3 ? 2 : 2;
  const rows: WorkspaceWithProject[][] = [];
  for (let i = 0; i < visibleWorkspaces.length; i += colCount) {
    rows.push(visibleWorkspaces.slice(i, i + colCount));
  }

  // Helper to render a single tile with drag wrappers
  function renderTile(ws: WorkspaceWithProject, globalIndex: number) {
    return (
      <div
        key={ws.id}
        draggable
        onDragStart={() => handleDragStart(globalIndex)}
        onDragOver={(e) => handleDragOver(e, globalIndex)}
        onDrop={() => handleDrop(globalIndex)}
        onDragEnd={handleDragEnd}
        className={cn(
          "flex h-full min-h-0 flex-col",
          dragOverIndex === globalIndex && dragIndex !== globalIndex && "ring-2 ring-primary/40 ring-inset",
          dragIndex === globalIndex && "opacity-50",
        )}
      >
        <ConversationTile
          wsId={ws.id}
          workspace={ws}
          projectLabel={getProjectLabel(ws)}
          onJumpOut={(id) => navigate(`/workspaces/${id}`, { state: { fromMosaic: true } })}
          onHide={tileCount > 1 ? handleHide : undefined}
          onNeedsInputChange={handleNeedsInputChange}
          className="h-full"
          dragHandleProps={{
            draggable: true,
            onDragStart: () => handleDragStart(globalIndex),
          }}
        />
      </div>
    );
  }

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
        <div className="flex flex-1 items-center justify-center gap-3 text-xs text-muted-foreground" data-tauri-drag-region>
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

        {/* Hidden tiles restore */}
        {hiddenWorkspaces.length > 0 && (
          <div className="flex items-center gap-1">
            {hiddenWorkspaces.map((ws) => (
              <button
                key={ws.id}
                type="button"
                onClick={() => handleShow(ws.id)}
                className="flex items-center gap-1 rounded border border-border/50 px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                title={`Show ${ws.name}`}
              >
                <Eye className="h-2.5 w-2.5" />
                {ws.name}
              </button>
            ))}
          </div>
        )}

        {/* Edit button (popover trigger) */}
        <WorkspacePicker
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          selectedIds={selectedIds}
          onToggle={toggleId}
        >
          <button
            type="button"
            className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <Pencil className="h-3 w-3" />
            <span>Edit</span>
          </button>
        </WorkspacePicker>
      </div>

      {/* ── Grid ────────────────────────────────────────────────────── */}
      {tileCount === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3">
          <p className="text-sm text-muted-foreground">
            {hiddenWorkspaces.length > 0
              ? `All tiles hidden — click a tile name above to restore`
              : "No workspaces selected"}
          </p>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="flex items-center gap-2 text-xs text-primary transition-colors hover:text-primary/80"
          >
            <Plus className="h-3.5 w-3.5" />
            Add workspaces
          </button>
        </div>
      ) : tileCount === 1 ? (
        /* Single tile — full screen */
        <div className="flex min-h-0 flex-1">
          {renderTile(visibleWorkspaces[0], 0)}
        </div>
      ) : rows.length === 1 ? (
        /* Single row — horizontal resizable panels */
        <Group orientation="horizontal" id="mosaic-row-0" className="min-h-0 flex-1">
          {rows[0].map((ws, i) => (
            <MosaicPanel key={ws.id} ws={ws} isLast={i === rows[0].length - 1}>
              {renderTile(ws, i)}
            </MosaicPanel>
          ))}
        </Group>
      ) : (
        /* Multiple rows — vertical Group wrapping horizontal Groups */
        <Group orientation="vertical" id="mosaic-rows" className="min-h-0 flex-1">
          {rows.map((row, rowIdx) => {
            const globalOffset = rowIdx * colCount;
            return (
              <MosaicRowPanel key={rowIdx} rowIdx={rowIdx} isLast={rowIdx === rows.length - 1}>
                <Group orientation="horizontal" id={`mosaic-row-${rowIdx}`} className="h-full">
                  {row.map((ws, colIdx) => (
                    <MosaicPanel key={ws.id} ws={ws} isLast={colIdx === row.length - 1}>
                      {renderTile(ws, globalOffset + colIdx)}
                    </MosaicPanel>
                  ))}
                </Group>
              </MosaicRowPanel>
            );
          })}
        </Group>
      )}
    </div>
  );
}

/** A single resizable panel with an optional resize handle after it. */
function MosaicPanel({ ws, isLast, children }: { ws: WorkspaceWithProject; isLast: boolean; children: React.ReactNode }) {
  return (
    <>
      <Panel id={`tile-${ws.id}`} minSize={15}>
        {children}
      </Panel>
      {!isLast && <ResizeHandle orientation="vertical" />}
    </>
  );
}

/** A single resizable row panel with an optional horizontal resize handle after it. */
function MosaicRowPanel({ rowIdx, isLast, children }: { rowIdx: number; isLast: boolean; children: React.ReactNode }) {
  return (
    <>
      <Panel id={`row-${rowIdx}`} minSize={20}>
        {children}
      </Panel>
      {!isLast && <ResizeHandle orientation="horizontal" />}
    </>
  );
}
