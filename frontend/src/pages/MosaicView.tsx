import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Group, Panel } from "react-resizable-panels";
import { ArrowLeft, CircleAlert, Columns2, Columns3, Pencil, Plus } from "lucide-react";
import { useProjects } from "@/hooks/useProjects";
import { useWorkspaceLiveDataContext } from "@/contexts/WorkspaceLiveDataContext";
import { useMosaicWorkspaces, parseTileId, MAX_MOSAIC } from "@/hooks/useMosaicWorkspaces";
import { ConversationTile } from "@/components/mosaic/ConversationTile";
import { WorkspacePicker } from "@/components/mosaic/WorkspacePicker";
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
  addToLayout,
  getDropZone,
} from "@/lib/mosaic-layout";
import type { Workspace } from "@/types";

interface WorkspaceWithProject extends Workspace {
  projectId: string;
  projectUrl: string;
  projectName: string;
}

const LAYOUT_KEY = "hive-mosaic-layout";
const COLUMNS_KEY = "hive-mosaic-columns";

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
  const { selectedIds, setSelectedIds, toggleId, removeId, addTileId } = useMosaicWorkspaces();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [columns, setColumnsRaw] = useState<2 | 3>(() => {
    const stored = localStorage.getItem(COLUMNS_KEY);
    return stored === "3" ? 3 : 2;
  });

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

  // Clean up stale IDs from persistence
  useEffect(() => {
    if (allWorkspaces.length === 0) return;
    const validIds = selectedIds.filter((id) => wsById.has(parseTileId(id).wsId));
    if (validIds.length !== selectedIds.length) {
      setSelectedIds(validIds);
    }
  }, [selectedIds, wsById, allWorkspaces.length, setSelectedIds]);

  // ── Pad with empty slot sentinels ──────────────────────────────────
  const paddedIds = useMemo(() => {
    if (selectedIds.length === 0) return [];
    const ids = [...selectedIds];
    const targetSize = Math.min(MAX_MOSAIC, columns * Math.ceil(ids.length / columns));
    for (let i = ids.length; i < targetSize; i++) ids.push(`__empty_${i}`);
    return ids;
  }, [selectedIds, columns]);

  const isEmptySlot = (id: string) => id.startsWith("__empty");

  // ── Layout tree ──────────────────────────────────────────────────
  const [layout, setLayoutRaw] = useState<MosaicNode | null>(() => {
    const stored = loadLayout();
    if (stored && paddedIds.length > 0) {
      const storedReal = new Set(getLeafIds(stored).filter((id) => !isEmptySlot(id)));
      const selReal = new Set(selectedIds);
      if (storedReal.size === selReal.size && [...storedReal].every((id) => selReal.has(id))) {
        return stored;
      }
    }
    return buildDefaultLayout(paddedIds, columns);
  });

  const columnsRef = useRef(columns);
  columnsRef.current = columns;

  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const setLayout = useCallback((l: MosaicNode | null) => {
    setLayoutRaw(l);
    saveLayout(l);
  }, []);

  // Sync layout when selectedIds change (picker / auto-populate / stale cleanup)
  const prevPaddedJson = useRef(JSON.stringify(paddedIds));
  useEffect(() => {
    const json = JSON.stringify(paddedIds);
    if (prevPaddedJson.current === json) return;
    prevPaddedJson.current = json;

    if (paddedIds.length === 0) {
      setLayout(null);
      return;
    }

    const currentReal = layoutRef.current
      ? new Set(getLeafIds(layoutRef.current).filter((id) => !isEmptySlot(id)))
      : new Set<string>();
    const newReal = new Set(selectedIds);
    if (currentReal.size === newReal.size && [...currentReal].every((id) => newReal.has(id))) {
      // Real IDs unchanged but padding may have changed — rebuild with new padding
    } else {
      // Real tile additions/removals — try incremental update
      const added = selectedIds.filter((id) => !currentReal.has(id));
      const removed = [...currentReal].filter((id) => !newReal.has(id));

      if (layoutRef.current && removed.length > 0 && added.length === 0) {
        let next: MosaicNode | null = layoutRef.current;
        for (const id of removed) next = next ? removeFromLayout(next, id) : null;
        // Fall through to rebuild with padding below
      }
    }
    // Always rebuild with correct padding
    setLayout(buildDefaultLayout(paddedIds, columnsRef.current));
  }, [paddedIds, selectedIds, setLayout]);

  const tileCount = layout ? getLeafIds(layout).filter((id) => !isEmptySlot(id)).length : 0;

  // Toolbar summary
  const streamingCount = selectedIds.filter((id) => liveData[parseTileId(id).wsId]?.streaming).length;
  const needsInputCount = Object.values(needsInputMap).filter(Boolean).length;

  // Project label for a workspace
  const getProjectLabel = (ws: WorkspaceWithProject) => {
    const parsed = parseProjectOwnerRepo(ws.projectUrl);
    return parsed ? `${parsed.owner}/${parsed.repo}` : ws.projectName;
  };

  const handleColumnsChange = useCallback(
    (cols: 2 | 3) => {
      setColumnsRaw(cols);
      localStorage.setItem(COLUMNS_KEY, String(cols));
      // Compute padded IDs for the new column count
      const ids = [...selectedIds];
      const target = Math.min(MAX_MOSAIC, cols * Math.ceil(Math.max(ids.length, 1) / cols));
      for (let i = ids.length; i < target; i++) ids.push(`__empty_${i}`);
      setLayout(buildDefaultLayout(ids, cols));
    },
    [selectedIds, setLayout],
  );

  // ── Hide tile (updates both selectedIds and layout immediately) ──
  const handleHide = useCallback(
    (tileId: string) => {
      removeId(tileId);
      setLayout((layoutRef.current ? removeFromLayout(layoutRef.current, tileId) : null));
    },
    [removeId, setLayout],
  );

  // ── Add tile: pin old session as read-only tile ──
  const handleAddTile = useCallback(
    (wsId: string, sessionIdToPin: string) => {
      addTileId(`${wsId}:${sessionIdToPin}`);
    },
    [addTileId],
  );

  // ── Tile drag state ───────────────────────────────────────────────
  const [dragWsId, setDragWsId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dropTarget, setDropTarget] = useState<{ wsId: string; zone: DropZone } | null>(null);
  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });
  const dragStartPos = useRef({ x: 0, y: 0 });
  const dragWsIdRef = useRef(dragWsId);
  const dropTargetRef = useRef(dropTarget);
  const isDraggingRef = useRef(isDragging);
  dragWsIdRef.current = dragWsId;
  dropTargetRef.current = dropTarget;
  isDraggingRef.current = isDragging;

  const startTileDrag = useCallback((e: React.PointerEvent, wsId: string) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    setDragWsId(wsId);
    setIsDragging(false);
    setCursorPos({ x: e.clientX, y: e.clientY });
    dragStartPos.current = { x: e.clientX, y: e.clientY };
  }, []);

  // Prevent text selection and set grabbing cursor during drag
  useEffect(() => {
    if (dragWsId === null) return;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "grabbing";
    return () => {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [dragWsId]);

  useEffect(() => {
    if (dragWsId === null) return;

    const onMove = (e: PointerEvent) => {
      e.preventDefault();
      setCursorPos({ x: e.clientX, y: e.clientY });

      const dx = Math.abs(e.clientX - dragStartPos.current.x);
      const dy = Math.abs(e.clientY - dragStartPos.current.y);
      if (dx > 4 || dy > 4) setIsDragging(true);

      // Find drop target by bounding rect
      const tiles = document.querySelectorAll("[data-tile-wsid]");
      let found: { wsId: string; zone: DropZone } | null = null;
      for (const tile of tiles) {
        const wsId = tile.getAttribute("data-tile-wsid");
        if (!wsId || wsId === dragWsIdRef.current || wsId.startsWith("__empty")) continue;
        const rect = tile.getBoundingClientRect();
        if (
          e.clientX >= rect.left && e.clientX <= rect.right &&
          e.clientY >= rect.top && e.clientY <= rect.bottom
        ) {
          found = { wsId, zone: getDropZone(rect, e.clientX, e.clientY) };
          break;
        }
      }
      setDropTarget(found);
    };

    const onUp = () => {
      const drag = dragWsIdRef.current;
      const target = dropTargetRef.current;
      if (isDraggingRef.current && drag && target && drag !== target.wsId) {
        const current = layoutRef.current;
        if (current) {
          const next = applyDrop(current, drag, target.wsId, target.zone);
          setLayoutRaw(next);
          saveLayout(next);
        }
      }
      setDragWsId(null);
      setIsDragging(false);
      setDropTarget(null);
    };

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };
  }, [dragWsId]);

  // ── Render helpers ────────────────────────────────────────────────
  function renderTile(tileId: string) {
    if (isEmptySlot(tileId)) {
      return (
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="flex h-full w-full flex-col items-center justify-center gap-2 border border-dashed border-border/60 bg-background"
        >
          <Plus className="h-5 w-5 text-muted-foreground/40" />
          <span className="text-xs text-muted-foreground/50">Add workspace</span>
        </button>
      );
    }

    const { wsId, sessionId } = parseTileId(tileId);
    const ws = wsById.get(wsId);
    if (!ws) return null;

    const isSource = isDragging && dragWsId === tileId;
    const dt = isDragging && !isSource && dropTarget?.wsId === tileId ? dropTarget.zone : null;

    return (
      <div
        data-tile-wsid={tileId}
        className={cn("h-full relative", isSource && "opacity-30")}
      >
        <ConversationTile
          wsId={wsId}
          workspace={ws}
          pinnedSessionId={sessionId}
          projectLabel={getProjectLabel(ws)}
          onJumpOut={(id) => navigate(`/workspaces/${id}`, { state: { fromMosaic: true } })}
          onHide={tileCount > 1 ? () => handleHide(tileId) : undefined}
          onAddTile={!sessionId && tileCount < MAX_MOSAIC ? (sessionIdToPin) => handleAddTile(wsId, sessionIdToPin) : undefined}
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
      return renderTile(node.wsId);
    }

    const handleOrientation = node.direction === "horizontal" ? "vertical" : "horizontal";

    return (
      <Group orientation={node.direction} id={`mosaic-${path}`} className="h-full">
        {node.children.map((child, i) => {
          const childKey = child.type === "leaf" ? child.wsId : `${path}-${i}`;
          return (
            <Fragment key={childKey}>
              <Panel id={`p-${path}-${i}`} minSize={15}>
                {child.type === "leaf"
                  ? renderTile(child.wsId)
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
  const draggedWs = dragWsId ? wsById.get(parseTileId(dragWsId).wsId) : null;

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
        <div className="flex items-center rounded-md border border-border p-0.5">
          <button
            type="button"
            onClick={() => handleColumnsChange(2)}
            className={cn(
              "flex items-center gap-1 rounded px-1.5 py-0.5 text-xs transition-colors",
              columns === 2 ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
            aria-label="2 columns"
          >
            <Columns2 className="h-3 w-3" />
            <span>2</span>
          </button>
          <button
            type="button"
            onClick={() => handleColumnsChange(3)}
            className={cn(
              "flex items-center gap-1 rounded px-1.5 py-0.5 text-xs transition-colors",
              columns === 3 ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
            aria-label="3 columns"
          >
            <Columns3 className="h-3 w-3" />
            <span>3</span>
          </button>
        </div>

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
      {!layout ? (
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
      ) : isNarrow ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {selectedIds.map((tileId) => (
            <div key={tileId} className="min-h-[300px] shrink-0 border-b border-border">
              {renderTile(tileId)}
            </div>
          ))}
        </div>
      ) : layout.type === "leaf" ? (
        <div className="flex min-h-0 flex-1">
          {renderTile(layout.wsId)}
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
            <span className="font-medium">{draggedWs.name}</span>
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
