import { useCallback, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronRightIcon, FilePlusIcon, PencilIcon, Trash2Icon } from "lucide-react";
import {
  FileIcon as SymbolFileIcon,
  FolderIcon as SymbolFolderIcon,
} from "@react-symbols/icons/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { WorkspaceFileTreeNode } from "@/types";

interface BrainFileTreeProps {
  nodes: WorkspaceFileTreeNode[];
  selectedPath: string;
  error?: string | null;
  onSelect: (path: string) => void;
  onCreate: (path: string) => void;
  onRename: (from: string, to: string) => void;
  onDelete: (path: string) => void;
}

/** Fixed row height (px) — must match the `py-1 text-xs` row styling below. */
const ROW_HEIGHT = 28;
/** Indentation (px) applied per tree depth level. */
const INDENT_PER_DEPTH = 12;
/** Extra rows rendered above/below the viewport to smooth fast scrolling. */
const OVERSCAN = 12;

/** A single visible tree row, flattened from the nested node structure. */
interface FlatRow {
  node: WorkspaceFileTreeNode;
  depth: number;
  isExpanded: boolean;
}

/**
 * Flatten the nested tree into the list of currently *visible* rows: a folder's
 * children are emitted only when the folder is expanded. This keeps the
 * virtualized list bounded by what the user can actually see.
 */
function flattenVisible(
  nodes: WorkspaceFileTreeNode[],
  expanded: Set<string>,
  depth = 0,
  acc: FlatRow[] = [],
): FlatRow[] {
  for (const node of nodes) {
    if (node.type === "directory") {
      const isExpanded = expanded.has(node.path);
      acc.push({ node, depth, isExpanded });
      if (isExpanded && node.children) {
        flattenVisible(node.children, expanded, depth + 1, acc);
      }
    } else {
      acc.push({ node, depth, isExpanded: false });
    }
  }
  return acc;
}

/**
 * Right-column Brain file tree. Renders a windowed (virtualized) flat list of
 * the visible nodes so it stays fluid with thousands of notes, while preserving
 * selection, expand/collapse, depth indentation, and the create (new note),
 * rename, and delete affordances scoped to the Brain repo.
 */
export function BrainFileTree({
  nodes,
  selectedPath,
  error,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: BrainFileTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);

  const submitCreate = useCallback(() => {
    const trimmed = newName.trim();
    if (trimmed) onCreate(trimmed);
    setNewName("");
    setCreating(false);
  }, [newName, onCreate]);

  const submitRename = useCallback(() => {
    const trimmed = renameValue.trim();
    if (renameTarget && trimmed && trimmed !== renameTarget) {
      onRename(renameTarget, trimmed);
    }
    setRenameTarget(null);
  }, [renameTarget, renameValue, onRename]);

  const toggleExpanded = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const rows = useMemo(() => flattenVisible(nodes, expanded), [nodes, expanded]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
  });

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border/50 px-3">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">Notes</span>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="New note"
          className="cursor-pointer"
          onClick={() => setCreating(true)}
        >
          <FilePlusIcon className="size-3.5" />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col p-2">
        {creating && (
          <div className="mb-2 px-1">
            <Input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitCreate();
                if (e.key === "Escape") {
                  setNewName("");
                  setCreating(false);
                }
              }}
              onBlur={submitCreate}
              placeholder="path/to/note.md"
              aria-label="New note path"
              className="h-7 text-xs"
            />
          </div>
        )}

        {error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
            {error}
          </div>
        ) : rows.length === 0 ? (
          <div className="px-2 py-1 text-xs text-muted-foreground">No notes yet.</div>
        ) : (
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto font-mono text-xs" role="tree">
            <div
              style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative", width: "100%" }}
            >
              {virtualizer.getVirtualItems().map((item) => {
                const row = rows[item.index];
                return (
                  <div
                    key={row.node.path}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      height: `${item.size}px`,
                      transform: `translateY(${item.start}px)`,
                    }}
                  >
                    {row.node.type === "directory" ? (
                      <FolderRow
                        row={row}
                        onToggle={() => toggleExpanded(row.node.path)}
                      />
                    ) : (
                      <FileRow
                        row={row}
                        isSelected={selectedPath === row.node.path}
                        onSelect={() => onSelect(row.node.path)}
                        onRename={() => {
                          setRenameTarget(row.node.path);
                          setRenameValue(row.node.path);
                        }}
                        onDelete={() => setDeleteTarget(row.node.path)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Rename dialog */}
      <Dialog open={renameTarget !== null} onOpenChange={(open) => !open && setRenameTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename note</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitRename();
            }}
            aria-label="New path"
          />
          <DialogFooter>
            <Button variant="ghost" className="cursor-pointer" onClick={() => setRenameTarget(null)}>
              Cancel
            </Button>
            <Button className="cursor-pointer" onClick={submitRename}>
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete note?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget} will be removed from disk. This change is staged for the next Save.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="cursor-pointer">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="cursor-pointer"
              onClick={() => {
                if (deleteTarget) onDelete(deleteTarget);
                setDeleteTarget(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** A virtualized folder row: chevron + folder icon + expand/collapse toggle. */
function FolderRow({ row, onToggle }: { row: FlatRow; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="treeitem"
      aria-expanded={row.isExpanded}
      onClick={onToggle}
      style={{ paddingLeft: `${row.depth * INDENT_PER_DEPTH + 8}px` }}
      className="flex h-full w-full cursor-pointer items-center gap-1 rounded py-1 pr-2 text-left transition-colors duration-150 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <ChevronRightIcon
        className={cn(
          "size-4 shrink-0 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none",
          row.isExpanded && "rotate-90",
        )}
        aria-hidden="true"
      />
      <span className="shrink-0">
        <SymbolFolderIcon folderName={row.node.name} className="size-4" />
      </span>
      <span className="truncate">{row.node.name}</span>
    </button>
  );
}

/** A virtualized file row: file icon + name + hover rename/delete actions. */
function FileRow({
  row,
  isSelected,
  onSelect,
  onRename,
  onDelete,
}: {
  row: FlatRow;
  isSelected: boolean;
  onSelect: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onSelect();
      }
    },
    [onSelect],
  );

  return (
    <div
      role="treeitem"
      aria-selected={isSelected}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={handleKeyDown}
      style={{ paddingLeft: `${row.depth * INDENT_PER_DEPTH + 8}px` }}
      className={cn(
        "group flex h-full cursor-pointer items-center gap-1 rounded py-1 pr-2 transition-colors duration-150 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        isSelected && "bg-muted",
      )}
    >
      {/* Spacer keeps file rows aligned with folder chevrons. */}
      <span className="size-4 shrink-0" aria-hidden="true" />
      <span className="shrink-0">
        <SymbolFileIcon fileName={row.node.name} autoAssign className="size-4" />
      </span>
      <span className="truncate">{row.node.name}</span>
      <div className="ml-auto flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
        <button
          type="button"
          aria-label={`Rename ${row.node.path}`}
          className="cursor-pointer rounded p-0.5 text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          onClick={(e) => {
            e.stopPropagation();
            onRename();
          }}
        >
          <PencilIcon className="size-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label={`Delete ${row.node.path}`}
          className="cursor-pointer rounded p-0.5 text-muted-foreground transition-colors duration-150 hover:text-destructive focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          <Trash2Icon className="size-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
