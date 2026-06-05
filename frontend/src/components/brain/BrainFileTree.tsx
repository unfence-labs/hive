import { useCallback, useMemo, useState } from "react";
import { FilePlusIcon, PencilIcon, Trash2Icon } from "lucide-react";
import {
  FileTree,
  FileTreeActions,
  FileTreeFile,
  FileTreeFolder,
} from "@/components/ai-elements/file-tree";
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

/**
 * Right-column Brain file tree. Reuses the shared `FileTree` primitives and adds
 * create (new note), rename, and delete affordances scoped to the Brain repo.
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

  const renderNodes = useCallback(
    (items: WorkspaceFileTreeNode[]) =>
      items.map((node) => {
        if (node.type === "directory") {
          return (
            <FileTreeFolder key={node.path} path={node.path} name={node.name}>
              {node.children ? renderNodes(node.children) : null}
            </FileTreeFolder>
          );
        }
        return (
          <FileTreeFile key={node.path} path={node.path} name={node.name} className="group">
            {/* Spacer keeps alignment with folder rows. */}
            <span className="size-4" />
            <span className="truncate">{node.name}</span>
            <FileTreeActions className="opacity-0 transition-opacity group-hover:opacity-100">
              <button
                type="button"
                aria-label={`Rename ${node.path}`}
                className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setRenameTarget(node.path);
                  setRenameValue(node.path);
                }}
              >
                <PencilIcon className="size-3.5" />
              </button>
              <button
                type="button"
                aria-label={`Delete ${node.path}`}
                className="rounded p-0.5 text-muted-foreground hover:text-destructive"
                onClick={() => setDeleteTarget(node.path)}
              >
                <Trash2Icon className="size-3.5" />
              </button>
            </FileTreeActions>
          </FileTreeFile>
        );
      }),
    [],
  );

  const tree = useMemo(() => renderNodes(nodes), [renderNodes, nodes]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border/50 px-3">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">Notes</span>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="New note"
          onClick={() => setCreating(true)}
        >
          <FilePlusIcon className="size-3.5" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-2">
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
        ) : (
          <FileTree
            expanded={expanded}
            onExpandedChange={setExpanded}
            onPathSelect={onSelect}
            selectedPath={selectedPath}
          >
            {nodes.length ? (
              tree
            ) : (
              <div className="px-2 py-1 text-xs text-muted-foreground">No notes yet.</div>
            )}
          </FileTree>
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
            <Button variant="ghost" onClick={() => setRenameTarget(null)}>
              Cancel
            </Button>
            <Button onClick={submitRename}>Rename</Button>
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
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
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
