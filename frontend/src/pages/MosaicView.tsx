import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Group, Panel } from "react-resizable-panels";
import { ArrowLeft, CircleAlert, Columns2Icon, Columns3Icon, Pencil, Plus } from "lucide-react";
import { useProjects } from "@/hooks/useProjects";
import { useWorkspaceLiveDataContext } from "@/contexts/WorkspaceLiveDataContext";
import { useAllSessions, type SessionTile } from "@/hooks/useAllSessions";
import { useMosaicSessions, isMosaicFirstEntry, parseTileId } from "@/hooks/useMosaicSessions";
import { api } from "@/hooks/useApi";
import { useQueryClient } from "@tanstack/react-query";
import { ConversationTile } from "@/components/mosaic/ConversationTile";
import { SessionPicker } from "@/components/mosaic/SessionPicker";
import { ResizeHandle } from "@/components/ResizeHandle";
import AgentActivityPreview from "@/components/chat/AgentActivityPreview";
import { parseProjectOwnerRepo } from "@/components/Sidebar";
import { cn } from "@/lib/utils";
import {
  type MosaicNode,
  type DropZone,
  getLeafIds,
  buildDefaultLayout,
  applyDrop,
  removeFromLayout,
  getDropZone,
} from "@/lib/mosaic-layout";
import type { Workspace, SessionMetadata } from "@/types";

interface WorkspaceWithProject extends Workspace {
  projectId: string;
  projectUrl: string;
  projectName: string;
}

const LAYOUT_KEY = "hive-mosaic-layout";
const COLUMNS_KEY = "hive-mosaic-columns";

function loadColumns(): 2 | 3 {
  const v = localStorage.getItem(COLUMNS_KEY);
  return v === "3" ? 3 : 2;
}

function saveColumns(c: 2 | 3) {
  localStorage.setItem(COLUMNS_KEY, String(c));
}

function loadLayout(): MosaicNode | null {
  try {
    return JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? "null");
  } catch {
    return null;
  }
}

function saveLayout(l: MosaicNode | null) {
  if (l) localStorage.setItem(LAYOUT_KEY, JSON.stringify(l));
  else localStorage.removeItem(LAYOUT_KEY);
}

export default function MosaicView() {
  const navigate = useNavigate();
  const { projects } = useProjects();
  const liveData = useWorkspaceLiveDataContext();
  const { selectedIds, atMax, toggleSession, selectSession, deselectSession, setSelectedIds } = useMosaicSessions();
  const queryClient = useQueryClient();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [columns, setColumnsRaw] = useState<2 | 3>(loadColumns);
  const columnsRef = useRef(columns);
  columnsRef.current = columns;

  const setColumns = useCallback((c: 2 | 3) => {
    setColumnsRaw(c);
    saveColumns(c);
  }, []);

  // ── Responsive narrow viewport detection ──────────────────────────
  const [isNarrow, setIsNarrow] = useState(
    () => typeof window !== "undefined" && !window.matchMedia("(min-width: 768px)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const handler = (e: MediaQueryListEvent) => setIsNarrow(!e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // "Needs input" state reported by each tile
  const [needsInputMap, setNeedsInputMap] = useState<Record<string, boolean>>({});
  const handleNeedsInputChange = useCallback((tileId: string, needsInput: boolean) => {
    setNeedsInputMap((prev) => {
      if (prev[tileId] === needsInput) return prev;
      return { ...prev, [tileId]: needsInput };
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

  // Fetch all sessions across all workspaces
  const { sessions: allSessions } = useAllSessions(allWorkspaces);

  // Build tile lookup by tileId
  const tileByTileId = useMemo(() => {
    const map = new Map<string, SessionTile>();
    for (const t of allSessions) map.set(t.tileId, t);
    return map;
  }, [allSessions]);

  // Derive visible tile IDs (selected sessions, filtered to valid ones)
  const visibleTileIds = useMemo(() => {
    const validSet = new Set(allSessions.map((s) => s.tileId));
    return selectedIds.filter((id) => validSet.has(id));
  }, [allSessions, selectedIds]);

  // Garbage-collect stale selected IDs (sessions that no longer exist)
  useEffect(() => {
    if (allSessions.length === 0) return;
    const validTileIds = new Set(allSessions.map((s) => s.tileId));
    const stale = selectedIds.filter((id) => !validTileIds.has(id));
    if (stale.length > 0) {
      setSelectedIds(selectedIds.filter((id) => validTileIds.has(id)));
    }
  }, [allSessions, selectedIds, setSelectedIds]);

  // Auto-populate on first entry: select up to 4 streaming sessions, or most recently active
  const autoPopulatedRef = useRef(false);
  useEffect(() => {
    if (autoPopulatedRef.current) return;
    if (allSessions.length === 0) return;
    if (!isMosaicFirstEntry()) return;

    autoPopulatedRef.current = true;

    // Prefer streaming sessions
    const streaming = allSessions.filter((s) => {
      const wsLive = liveData[s.wsId];
      return wsLive?.streaming || wsLive?.streamingSessions?.[s.session.sessionId];
    });

    if (streaming.length > 0) {
      setSelectedIds(streaming.slice(0, 4).map((s) => s.tileId));
      return;
    }

    // Fallback: most recently active (by createdAt descending)
    const sorted = [...allSessions].sort(
      (a, b) => new Date(b.session.createdAt).getTime() - new Date(a.session.createdAt).getTime(),
    );
    setSelectedIds(sorted.slice(0, 4).map((s) => s.tileId));
  }, [allSessions, liveData, setSelectedIds]);

  // Pad visible tile IDs with empty sentinels to fill grid capacity (max 4)
  const MAX_TILES = 4;
  const paddedTileIds = useMemo(() => {
    const ids = [...visibleTileIds];
    for (let i = ids.length; i < MAX_TILES; i++) {
      ids.push(`__empty_${i}`);
    }
    return ids;
  }, [visibleTileIds]);

  const isEmptySlot = (id: string) => id.startsWith("__empty_");

  // ── Layout tree ──────────────────────────────────────────────────
  const [layout, setLayoutRaw] = useState<MosaicNode | null>(() => {
    const stored = loadLayout();
    if (stored && paddedTileIds.length > 0) {
      const storedLeafs = getLeafIds(stored).filter((id) => !isEmptySlot(id));
      const visibleSet = new Set(visibleTileIds);
      if (storedLeafs.length === visibleSet.size && storedLeafs.every((id) => visibleSet.has(id))) {
        return stored;
      }
    }
    return buildDefaultLayout(paddedTileIds, columns);
  });

  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const setLayout = useCallback((l: MosaicNode | null) => {
    setLayoutRaw(l);
    saveLayout(l);
  }, []);

  // Rebuild layout when padded tile IDs change (selection add/remove)
  const prevPaddedRef = useRef<string[]>(paddedTileIds);
  useEffect(() => {
    const prev = prevPaddedRef.current;
    const next = paddedTileIds;

    if (JSON.stringify(prev) === JSON.stringify(next)) return;
    prevPaddedRef.current = next;

    // Rebuild from scratch — empty slots make incremental updates fragile
    setLayout(buildDefaultLayout(next, columnsRef.current));
  }, [paddedTileIds, setLayout]);

  // Rebuild layout when columns change
  const prevColumnsRef = useRef(columns);
  useEffect(() => {
    if (prevColumnsRef.current === columns) return;
    prevColumnsRef.current = columns;
    setLayout(buildDefaultLayout(paddedTileIds, columns));
  }, [columns, paddedTileIds, setLayout]);

  const tileCount = layout ? getLeafIds(layout).filter((id) => !isEmptySlot(id)).length : 0;

  // Toolbar summary
  const streamingCount = visibleTileIds.filter((id) => {
    const { wsId } = parseTileId(id);
    return liveData[wsId]?.streaming;
  }).length;
  const needsInputCount = Object.values(needsInputMap).filter(Boolean).length;

  const getProjectLabel = (ws: WorkspaceWithProject) => {
    const parsed = parseProjectOwnerRepo(ws.projectUrl);
    return parsed ? `${parsed.owner}/${parsed.repo}` : ws.projectName;
  };

  // ── Remove tile from mosaic ──
  const handleRemove = useCallback(
    (tileId: string) => {
      deselectSession(tileId);
      setLayout((layoutRef.current ? removeFromLayout(layoutRef.current, tileId) : null));
    },
    [deselectSession, setLayout],
  );

  // ── New session for a workspace ──
  const handleNewSession = useCallback(
    async (wsId: string, _sourceTileId: string) => {
      try {
        const meta = await api.post<SessionMetadata>(`/api/workspaces/${wsId}/sessions`);
        const newTileId = `${wsId}:${meta.sessionId}`;
        selectSession(newTileId);
        queryClient.invalidateQueries({ queryKey: ["sessions", wsId] });
      } catch {
        // ignore — session creation can fail if workspace is busy
      }
    },
    [queryClient, selectSession],
  );

  // ── Close (delete) a session ──
  const handleCloseSession = useCallback(
    async (wsId: string, sessionId: string) => {
      try {
        await api.delete(`/api/workspaces/${wsId}/sessions/${sessionId}`);
        queryClient.invalidateQueries({ queryKey: ["sessions", wsId] });
      } catch {
        // ignore
      }
    },
    [queryClient],
  );

  // ── Tile drag state ───────────────────────────────────────────────
  const [dragTileId, setDragTileId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dropTarget, setDropTarget] = useState<{ tileId: string; zone: DropZone } | null>(null);
  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });
  const dragStartPos = useRef({ x: 0, y: 0 });
  const dragTileIdRef = useRef(dragTileId);
  const dropTargetRef = useRef(dropTarget);
  const isDraggingRef = useRef(isDragging);
  dragTileIdRef.current = dragTileId;
  dropTargetRef.current = dropTarget;
  isDraggingRef.current = isDragging;

  const startTileDrag = useCallback((e: React.PointerEvent, tileId: string) => {
    if (e.button !== 0) return;
    if (isEmptySlot(tileId)) return;
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    setDragTileId(tileId);
    setIsDragging(false);
    setCursorPos({ x: e.clientX, y: e.clientY });
    dragStartPos.current = { x: e.clientX, y: e.clientY };
  }, []);

  // Prevent text selection and set grabbing cursor during drag
  useEffect(() => {
    if (dragTileId === null) return;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "grabbing";
    return () => {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [dragTileId]);

  useEffect(() => {
    if (dragTileId === null) return;

    const onMove = (e: PointerEvent) => {
      e.preventDefault();
      setCursorPos({ x: e.clientX, y: e.clientY });

      const dx = Math.abs(e.clientX - dragStartPos.current.x);
      const dy = Math.abs(e.clientY - dragStartPos.current.y);
      if (dx > 4 || dy > 4) setIsDragging(true);

      // Find drop target by bounding rect
      const tiles = document.querySelectorAll("[data-tile-id]");
      let found: { tileId: string; zone: DropZone } | null = null;
      for (const tile of tiles) {
        const id = tile.getAttribute("data-tile-id");
        if (!id || id === dragTileIdRef.current) continue;
        const rect = tile.getBoundingClientRect();
        if (
          e.clientX >= rect.left && e.clientX <= rect.right &&
          e.clientY >= rect.top && e.clientY <= rect.bottom
        ) {
          found = { tileId: id, zone: getDropZone(rect, e.clientX, e.clientY) };
          break;
        }
      }
      setDropTarget(found);
    };

    const onUp = () => {
      const drag = dragTileIdRef.current;
      const target = dropTargetRef.current;
      if (isDraggingRef.current && drag && target && drag !== target.tileId) {
        const current = layoutRef.current;
        if (current) {
          const next = applyDrop(current, drag, target.tileId, target.zone);
          setLayoutRaw(next);
          saveLayout(next);
        }
      }
      setDragTileId(null);
      setIsDragging(false);
      setDropTarget(null);
    };

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };
  }, [dragTileId]);

  // ── Render helpers ────────────────────────────────────────────────
  function renderEmptySlot() {
    return (
      <button
        type="button"
        onClick={() => setPickerOpen(true)}
        className="flex h-full w-full flex-col items-center justify-center gap-2 border-2 border-dashed border-border/60 bg-background transition-colors hover:border-primary/40 hover:bg-muted/30"
      >
        <Plus className="h-5 w-5 text-muted-foreground/50" />
        <span className="text-xs text-muted-foreground/50">Add workspace</span>
      </button>
    );
  }

  function renderTile(tileId: string) {
    if (isEmptySlot(tileId)) return renderEmptySlot();

    const tile = tileByTileId.get(tileId);
    if (!tile) return null;

    const { wsId, sessionId } = parseTileId(tileId);
    const ws = wsById.get(wsId);
    if (!ws) return null;

    const isSource = isDragging && dragTileId === tileId;
    const dt = isDragging && !isSource && dropTarget?.tileId === tileId ? dropTarget.zone : null;

    // Always pin the tile to its specific session
    const sessionTitle = tile.session.title || undefined;

    return (
      <div
        data-tile-id={tileId}
        className={cn("h-full relative", isSource && "opacity-30")}
      >
        <ConversationTile
          wsId={wsId}
          workspace={ws}
          pinnedSessionId={sessionId}
          sessionTitle={sessionTitle}
          projectLabel={getProjectLabel(ws)}
          onJumpOut={(id) => navigate(`/workspaces/${id}`, { state: { fromMosaic: true } })}
          onHide={tileCount > 1 ? () => handleRemove(tileId) : undefined}
          onClose={sessionId ? () => handleCloseSession(wsId, sessionId) : undefined}
          onNewSession={(id: string) => handleNewSession(id, tileId)}
          onNeedsInputChange={handleNeedsInputChange}
          onHeaderPointerDown={isNarrow ? undefined : (e) => startTileDrag(e, tileId)}
          isDragSource={isSource}
          className="h-full"
        />
        {isDragging && !isSource && <DropZoneOverlay zone={dt} />}
      </div>
    );
  }

  function renderNode(node: MosaicNode, path: string): React.ReactNode {
    if (node.type === "leaf") {
      return renderTile(node.tileId);
    }

    const handleOrientation = node.direction === "horizontal" ? "vertical" : "horizontal";

    return (
      <Group orientation={node.direction} id={`mosaic-${path}`} className="h-full">
        {node.children.map((child, i) => {
          const childKey = child.type === "leaf" ? child.tileId : `${path}-${i}`;
          return (
            <Fragment key={childKey}>
              <Panel id={`p-${path}-${i}`} minSize={15}>
                {child.type === "leaf"
                  ? renderTile(child.tileId)
                  : renderNode(child, `${path}-${i}`)}
              </Panel>
              {i < node.children.length - 1 && (
                <ResizeHandle orientation={handleOrientation} />
              )}
            </Fragment>
          );
        })}
      </Group>
    );
  }

  // Floating ghost for dragged tile
  const draggedTile = dragTileId ? tileByTileId.get(dragTileId) : null;
  const draggedWs = draggedTile ? wsById.get(draggedTile.wsId) : null;

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* ── Toolbar ─────────────────────────────────────────────────── */}
      <div
        className="flex h-11 shrink-0 items-center gap-3 border-b border-border bg-card px-3"
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

        {/* Layout toggle */}
        <button
          type="button"
          onClick={() => setColumns(columns === 2 ? 3 : 2)}
          className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          aria-label={`Switch to ${columns === 2 ? 3 : 2} columns`}
          title={`${columns === 2 ? 3 : 2}-column layout`}
        >
          {columns === 2 ? <Columns3Icon className="h-3.5 w-3.5" /> : <Columns2Icon className="h-3.5 w-3.5" />}
        </button>

        {/* Edit button (session picker) */}
        <SessionPicker
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          sessions={allSessions}
          selectedIds={selectedIds}
          atMax={atMax}
          onToggle={toggleSession}
        >
          <button
            type="button"
            className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <Pencil className="h-3 w-3" />
            <span>Edit</span>
          </button>
        </SessionPicker>
      </div>

      {/* ── Grid ────────────────────────────────────────────────────── */}
      {allSessions.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3">
          <p className="text-sm text-muted-foreground">No sessions found</p>
        </div>
      ) : !layout ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3">
          <p className="text-sm text-muted-foreground">No sessions selected</p>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="flex items-center gap-2 text-xs text-primary transition-colors hover:text-primary/80"
          >
            <Plus className="h-3.5 w-3.5" />
            Add workspace
          </button>
        </div>
      ) : isNarrow ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {visibleTileIds.map((tileId) => (
            <div key={tileId} className="min-h-[300px] shrink-0 border-b border-border">
              {renderTile(tileId)}
            </div>
          ))}
        </div>
      ) : layout.type === "leaf" ? (
        <div className="flex min-h-0 flex-1">
          {renderTile(layout.tileId)}
        </div>
      ) : (
        <div className="min-h-0 flex-1">
          {renderNode(layout, "root")}
        </div>
      )}

      {/* ── Floating drag ghost ─────────────────────────────────────── */}
      {isDragging && draggedWs && (
        <div
          className="pointer-events-none fixed z-50"
          style={{ left: cursorPos.x, top: cursorPos.y, transform: "translate(-50%, -110%)" }}
        >
          <div className="flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs shadow-xl">
            <div className="h-2 w-2 shrink-0 rounded-full bg-primary" />
            <span className="font-medium">{liveData[draggedWs.id]?.branch ?? draggedWs.branch}</span>
            {draggedTile?.session.title && (
              <>
                <span className="text-muted-foreground/40">·</span>
                <span className="text-muted-foreground">{draggedTile.session.title}</span>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function DropZoneOverlay({ zone }: { zone: DropZone | null }) {
  return (
    <div className="absolute inset-0 pointer-events-none z-20">
      <div
        className={cn(
          "absolute rounded transition-all duration-100",
          zone === "left" && "inset-y-1 left-1 w-[calc(30%-4px)] bg-primary/15 border-2 border-primary/40",
          zone === "right" && "inset-y-1 right-1 w-[calc(30%-4px)] bg-primary/15 border-2 border-primary/40",
          zone === "top" && "inset-x-1 top-1 h-[calc(30%-4px)] bg-primary/15 border-2 border-primary/40",
          zone === "bottom" && "inset-x-1 bottom-1 h-[calc(30%-4px)] bg-primary/15 border-2 border-primary/40",
          zone === "center" && "inset-2 bg-primary/10 border-2 border-primary/30 border-dashed",
          !zone && "hidden",
        )}
      />
    </div>
  );
}
