import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Group, Panel } from "react-resizable-panels";
import { ArrowLeft, CircleAlert, Columns3, LayoutGrid, Pencil, Plus, Rows3 } from "lucide-react";
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

type MosaicLayout = "grid" | "columns" | "rows";

const LAYOUT_KEY = "hive-mosaic-layout";

function readLayout(): MosaicLayout {
  const raw = localStorage.getItem(LAYOUT_KEY);
  if (raw === "grid" || raw === "columns" || raw === "rows") return raw;
  return "grid";
}

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
  const [layout, setLayout] = useState<MosaicLayout>(readLayout);

  // "Needs input" state reported by each tile
  const [needsInputMap, setNeedsInputMap] = useState<Record<string, boolean>>({});
  const handleNeedsInputChange = useCallback((wsId: string, needsInput: boolean) => {
    setNeedsInputMap((prev) => {
      if (prev[wsId] === needsInput) return prev;
      return { ...prev, [wsId]: needsInput };
    });
  }, []);

  // Persist layout changes
  const changeLayout = useCallback((l: MosaicLayout) => {
    setLayout(l);
    localStorage.setItem(LAYOUT_KEY, l);
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

  const tileCount = selectedWorkspaces.length;

  // Toolbar summary
  const streamingCount = selectedWorkspaces.filter((ws) => liveData[ws.id]?.streaming).length;
  const needsInputCount = Object.values(needsInputMap).filter(Boolean).length;

  // Project label for a workspace
  const getProjectLabel = (ws: WorkspaceWithProject) => {
    const parsed = parseProjectOwnerRepo(ws.projectUrl);
    return parsed ? `${parsed.owner}/${parsed.repo}` : ws.projectName;
  };

  // ── Reorder (swap adjacent positions) ─────────────────────────────
  const handleMove = useCallback(
    (fromIndex: number, toIndex: number) => {
      const ids = [...selectedIds];
      const [moved] = ids.splice(fromIndex, 1);
      ids.splice(toIndex, 0, moved);
      setSelectedIds(ids);
    },
    [selectedIds, setSelectedIds],
  );

  // ── Layout: split into rows for grid mode ─────────────────────────
  const colCount = 2;
  const gridRows: WorkspaceWithProject[][] = [];
  for (let i = 0; i < selectedWorkspaces.length; i += colCount) {
    gridRows.push(selectedWorkspaces.slice(i, i + colCount));
  }

  // Helper to render a single tile
  function renderTile(ws: WorkspaceWithProject, index: number) {
    return (
      <ConversationTile
        key={ws.id}
        wsId={ws.id}
        workspace={ws}
        projectLabel={getProjectLabel(ws)}
        onJumpOut={(id) => navigate(`/workspaces/${id}`, { state: { fromMosaic: true } })}
        onHide={tileCount > 1 ? () => removeId(ws.id) : undefined}
        onMoveLeft={index > 0 ? () => handleMove(index, index - 1) : undefined}
        onMoveRight={index < tileCount - 1 ? () => handleMove(index, index + 1) : undefined}
        onNeedsInputChange={handleNeedsInputChange}
        className="h-full"
      />
    );
  }

  const layoutButtons: { value: MosaicLayout; icon: typeof LayoutGrid; label: string }[] = [
    { value: "grid", icon: LayoutGrid, label: "Grid" },
    { value: "columns", icon: Columns3, label: "Columns" },
    { value: "rows", icon: Rows3, label: "Rows" },
  ];

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

        {/* Layout selector */}
        {tileCount >= 2 && (
          <div className="flex items-center gap-0.5 rounded-md border border-border/50 p-0.5">
            {layoutButtons.map(({ value, icon: Icon, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => changeLayout(value)}
                className={cn(
                  "rounded px-1.5 py-0.5 text-muted-foreground/60 transition-colors hover:text-foreground",
                  layout === value && "bg-muted text-foreground",
                )}
                title={label}
              >
                <Icon className="h-3 w-3" />
              </button>
            ))}
          </div>
        )}

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
      ) : tileCount === 1 ? (
        /* Single tile — full screen */
        <div className="flex min-h-0 flex-1">{renderTile(selectedWorkspaces[0], 0)}</div>
      ) : layout === "columns" ? (
        /* All tiles in a single horizontal row */
        <Group orientation="horizontal" id="mosaic-cols" className="min-h-0 flex-1">
          {selectedWorkspaces.map((ws, i) => (
            <MosaicPanel key={ws.id} ws={ws} isLast={i === tileCount - 1}>
              {renderTile(ws, i)}
            </MosaicPanel>
          ))}
        </Group>
      ) : layout === "rows" ? (
        /* All tiles stacked vertically */
        <Group orientation="vertical" id="mosaic-rows-layout" className="min-h-0 flex-1">
          {selectedWorkspaces.map((ws, i) => (
            <MosaicRowPanel key={ws.id} rowIdx={i} isLast={i === tileCount - 1}>
              {renderTile(ws, i)}
            </MosaicRowPanel>
          ))}
        </Group>
      ) : gridRows.length === 1 ? (
        /* Grid with single row — horizontal panels */
        <Group orientation="horizontal" id="mosaic-row-0" className="min-h-0 flex-1">
          {gridRows[0].map((ws, i) => (
            <MosaicPanel key={ws.id} ws={ws} isLast={i === gridRows[0].length - 1}>
              {renderTile(ws, i)}
            </MosaicPanel>
          ))}
        </Group>
      ) : (
        /* Grid with multiple rows */
        <Group orientation="vertical" id="mosaic-grid" className="min-h-0 flex-1">
          {gridRows.map((row, rowIdx) => {
            const globalOffset = rowIdx * colCount;
            return (
              <MosaicRowPanel key={rowIdx} rowIdx={rowIdx} isLast={rowIdx === gridRows.length - 1}>
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
