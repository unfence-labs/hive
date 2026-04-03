import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Group, Panel } from "react-resizable-panels";
import { ArrowLeft, CircleAlert, Pencil, Plus } from "lucide-react";
import { useProjects } from "@/hooks/useProjects";
import { useWorkspaceLiveDataContext } from "@/contexts/WorkspaceLiveDataContext";
import { useAllSessions, type SessionTile } from "@/hooks/useAllSessions";
import { useMosaicSessions, parseTileId } from "@/hooks/useMosaicSessions";
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
import type { Workspace } from "@/types";

interface WorkspaceWithProject extends Workspace {
  projectId: string;
  projectUrl: string;
  projectName: string;
}

const LAYOUT_KEY = "hive-mosaic-layout";
const COLUMNS = 2;

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
  const { hiddenIds, isHidden, toggleSession, setHiddenIds } = useMosaicSessions();
  const queryClient = useQueryClient();

  const [pickerOpen, setPickerOpen] = useState(false);

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

  // Derive visible tile IDs (all sessions minus hidden)
  const visibleTileIds = useMemo(
    () => allSessions.filter((s) => !isHidden(s.tileId)).map((s) => s.tileId),
    [allSessions, isHidden],
  );

  // Garbage-collect stale hidden IDs (sessions that no longer exist)
  useEffect(() => {
    if (allSessions.length === 0) return;
    const validTileIds = new Set(allSessions.map((s) => s.tileId));
    const stale = hiddenIds.filter((id) => !validTileIds.has(id));
    if (stale.length > 0) {
      setHiddenIds(hiddenIds.filter((id) => validTileIds.has(id)));
    }
  }, [allSessions, hiddenIds, setHiddenIds]);

  // ── Layout tree ──────────────────────────────────────────────────
  const [layout, setLayoutRaw] = useState<MosaicNode | null>(() => {
    const stored = loadLayout();
    if (stored && visibleTileIds.length > 0) {
      const storedIds = new Set(getLeafIds(stored));
      const visibleSet = new Set(visibleTileIds);
      if (storedIds.size === visibleSet.size && [...storedIds].every((id) => visibleSet.has(id))) {
        return stored;
      }
    }
    return buildDefaultLayout(visibleTileIds, COLUMNS);
  });

  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const setLayout = useCallback((l: MosaicNode | null) => {
    setLayoutRaw(l);
    saveLayout(l);
  }, []);

  // Sync layout when visibleTileIds change
  const prevVisibleJson = useRef(JSON.stringify(visibleTileIds));
  useEffect(() => {
    const json = JSON.stringify(visibleTileIds);
    if (prevVisibleJson.current === json) return;
    prevVisibleJson.current = json;

    if (visibleTileIds.length === 0) {
      setLayout(null);
      return;
    }

    // Always rebuild to match current visible set
    setLayout(buildDefaultLayout(visibleTileIds, COLUMNS));
  }, [visibleTileIds, setLayout]);

  const tileCount = layout ? getLeafIds(layout).length : 0;

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

  // ── Hide tile ──
  const handleHide = useCallback(
    (tileId: string) => {
      toggleSession(tileId);
      setLayout((layoutRef.current ? removeFromLayout(layoutRef.current, tileId) : null));
    },
    [toggleSession, setLayout],
  );

  // ── New session for a workspace ──
  const handleNewSession = useCallback(
    async (wsId: string) => {
      try {
        await api.post(`/api/workspaces/${wsId}/sessions`);
        queryClient.invalidateQueries({ queryKey: ["sessions", wsId] });
      } catch {
        // ignore — session creation can fail if workspace is busy
      }
    },
    [queryClient],
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
  function renderTile(tileId: string) {
    const tile = tileByTileId.get(tileId);
    if (!tile) return null;

    const { wsId, sessionId } = parseTileId(tileId);
    const ws = wsById.get(wsId);
    if (!ws) return null;

    const isSource = isDragging && dragTileId === tileId;
    const dt = isDragging && !isSource && dropTarget?.tileId === tileId ? dropTarget.zone : null;

    // Active session → live (no pinnedSessionId); otherwise → read-only
    const pinnedSessionId = tile.isActive ? undefined : sessionId;
    const sessionTitle = tile.session.title || undefined;

    return (
      <div
        data-tile-id={tileId}
        className={cn("h-full relative", isSource && "opacity-30")}
      >
        <ConversationTile
          wsId={wsId}
          workspace={ws}
          pinnedSessionId={pinnedSessionId}
          sessionTitle={sessionTitle}
          projectLabel={getProjectLabel(ws)}
          onJumpOut={(id) => navigate(`/workspaces/${id}`, { state: { fromMosaic: true } })}
          onHide={tileCount > 1 ? () => handleHide(tileId) : undefined}
          onClose={sessionId ? () => handleCloseSession(wsId, sessionId) : undefined}
          onNewSession={tile.isActive ? handleNewSession : undefined}
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

        {/* Edit button (session picker) */}
        <SessionPicker
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          sessions={allSessions}
          hiddenIds={hiddenIds}
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
      {!layout ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3">
          <p className="text-sm text-muted-foreground">
            {allSessions.length === 0
              ? "No sessions found"
              : "All sessions are hidden"}
          </p>
          {allSessions.length > 0 && (
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="flex items-center gap-2 text-xs text-primary transition-colors hover:text-primary/80"
            >
              <Plus className="h-3.5 w-3.5" />
              Show sessions
            </button>
          )}
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
