import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ChevronDownIcon, CircleDot, GitBranch, GitPullRequest, SearchIcon, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
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
import { SPOTLIGHT_DIALOG_CLASS, SPOTLIGHT_LIST_CLASS } from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/time";
import { useProjects } from "@/hooks/useProjects";
import {
  useArchivedWorkspaces,
  useDeleteArchivedWorkspace,
  useRestoreWorkspace,
} from "@/hooks/useArchivedWorkspaces";
import type { ArchivedWorkspaceItem } from "@/types";

interface RestoreWorkspaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultProjectId?: string;
}

function RowIcon({ source }: { source: ArchivedWorkspaceItem["source"] }) {
  if (source?.kind === "pr") return <GitPullRequest className="size-4 shrink-0 text-pr-open" />;
  if (source?.kind === "issue") return <CircleDot className="size-4 shrink-0 text-pr-open" />;
  return <GitBranch className="size-4 shrink-0 text-muted-foreground" />;
}

/** Spotlight picker: restore an archived workspace from its kept branch, or delete it for good. */
export default function RestoreWorkspaceDialog({
  open,
  onOpenChange,
  defaultProjectId,
}: RestoreWorkspaceDialogProps) {
  const navigate = useNavigate();
  const { projects } = useProjects();
  const [projectId, setProjectId] = useState<string | undefined>(undefined);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<ArchivedWorkspaceItem | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const activeProjectId = projectId ?? defaultProjectId ?? projects[0]?.id;
  const activeProject = projects.find((p) => p.id === activeProjectId);
  const archives = useArchivedWorkspaces(activeProjectId, open);
  const restore = useRestoreWorkspace(activeProjectId);
  const deleteArchive = useDeleteArchivedWorkspace(activeProjectId);
  const restoringId = restore.isPending ? restore.variables : null;

  useEffect(() => {
    if (!open) return;
    setProjectId(undefined);
    setQuery("");
    setSelectedIndex(0);
  }, [open]);

  const normalizedQuery = query.trim().replace(/^#/, "").toLowerCase();
  const rows = useMemo(
    () =>
      (archives.data ?? []).filter(
        (item) =>
          !normalizedQuery ||
          [item.name, item.branch, item.source?.number]
            .some((f) => f !== undefined && String(f).toLowerCase().includes(normalizedQuery)),
      ),
    [archives.data, normalizedQuery],
  );
  const clampedIndex = Math.min(selectedIndex, Math.max(rows.length - 1, 0));

  async function restoreRow(item: ArchivedWorkspaceItem) {
    if (!item.branchExists || restoringId) return;
    try {
      const workspace = await restore.mutateAsync(item.id);
      onOpenChange(false);
      navigate(`/workspaces/${workspace.id}`);
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Failed to restore workspace");
    }
  }

  async function deleteRow(item: ArchivedWorkspaceItem) {
    setDeleteTarget(null);
    try {
      await deleteArchive.mutateAsync(item.id);
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Failed to delete archived workspace");
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, rows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[clampedIndex];
      if (row) void restoreRow(row);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className={cn(SPOTLIGHT_DIALOG_CLASS, "gap-0 bg-popover p-0 text-popover-foreground")}
          showCloseButton={false}
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            inputRef.current?.focus();
          }}
        >
          <DialogTitle className="sr-only">Restore workspace</DialogTitle>
          <div className="flex items-center gap-2 border-b px-3">
            <SearchIcon className="size-4 shrink-0 opacity-50" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelectedIndex(0);
              }}
              onKeyDown={handleKeyDown}
              placeholder="Search archived workspaces"
              className="h-12 w-full bg-transparent text-sm outline-hidden placeholder:text-muted-foreground"
              disabled={restoringId !== null}
            />
          </div>
          <div
            className={cn(
              "flex items-center justify-between border-b px-3 py-2",
              restoringId && "pointer-events-none opacity-50",
            )}
          >
            <span className="px-1 text-xs font-medium text-muted-foreground">Archived workspaces</span>
            {projects.length > 1 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="xs" className="text-muted-foreground hover:text-foreground">
                    {activeProject?.name ?? "Select project"}
                    <ChevronDownIcon className="ml-0.5 size-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[160px]">
                  {projects.map((p) => (
                    <DropdownMenuItem
                      key={p.id}
                      onSelect={() => {
                        setProjectId(p.id);
                        setSelectedIndex(0);
                      }}
                    >
                      {p.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
          <div className={cn(SPOTLIGHT_LIST_CLASS, "overflow-y-auto p-1")} role="listbox" aria-label="Archived workspaces">
            {archives.isLoading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                <Spinner className="size-4" />
                Loading…
              </div>
            ) : archives.isError ? (
              <div className="py-8 text-center text-sm text-muted-foreground">Failed to load archived workspaces</div>
            ) : rows.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                {normalizedQuery ? "No results found." : "No archived workspaces"}
              </div>
            ) : (
              rows.map((item, index) => {
                const selected = index === clampedIndex;
                const isRestoring = item.id === restoringId;
                return (
                  // The row hosts a nested delete button, so it cannot be a button itself.
                  <div
                    key={item.id}
                    role="option"
                    aria-selected={selected}
                    aria-disabled={!item.branchExists || undefined}
                    className={cn(
                      "group/row flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-2 text-sm",
                      selected && "bg-accent text-accent-foreground",
                      !item.branchExists && "cursor-default text-muted-foreground",
                      restoringId && !isRestoring && "opacity-50",
                    )}
                    onMouseMove={() => setSelectedIndex(index)}
                    onClick={() => void restoreRow(item)}
                  >
                    {isRestoring ? <Spinner className="size-4 shrink-0" /> : <RowIcon source={item.source} />}
                    {item.source?.number && (
                      <span className="shrink-0 tabular-nums text-muted-foreground">#{item.source.number}</span>
                    )}
                    <span className="min-w-0 shrink-0 truncate">{item.name}</span>
                    <span className="min-w-0 truncate text-xs text-muted-foreground">{item.branch}</span>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                      {isRestoring
                        ? "Restoring…"
                        : item.branchExists
                          ? formatRelativeTime(item.archivedAt)
                          : "Branch missing"}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      // Same affordance as the sidebar archive button: muted, red on hover.
                      className={cn(
                        "shrink-0 text-muted-foreground opacity-0 transition-[opacity,color] hover:bg-transparent hover:text-destructive focus-visible:opacity-100 group-hover/row:opacity-100",
                        selected && "opacity-100",
                      )}
                      disabled={restoringId !== null || deleteArchive.isPending}
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteTarget(item);
                      }}
                      aria-label={`Delete ${item.name}`}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(isOpen) => !isOpen && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete archived workspace</AlertDialogTitle>
            <AlertDialogDescription>
              &quot;{deleteTarget?.name}&quot; and its conversations will be permanently deleted.
              {deleteTarget?.deletesBranch && <> The branch &quot;{deleteTarget?.branch}&quot; will be removed too.</>}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (deleteTarget) void deleteRow(deleteTarget);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
