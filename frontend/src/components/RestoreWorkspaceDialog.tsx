import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { CircleDot, GitPullRequest, Trash2 } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/time";
import {
  useArchivedWorkspaces,
  useDeleteArchivedWorkspace,
  useRestoreWorkspace,
} from "@/hooks/useArchivedWorkspaces";
import type { ArchivedWorkspaceItem } from "@/types";

interface RestoreWorkspaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId?: string;
}

function SourceBadge({ source }: { source: ArchivedWorkspaceItem["source"] }) {
  if (!source?.number || (source.kind !== "pr" && source.kind !== "issue")) return null;
  const Icon = source.kind === "pr" ? GitPullRequest : CircleDot;
  return (
    <>
        <Icon className="size-3.5 shrink-0 text-pr-open" />
        <span className="shrink-0 tabular-nums">#{source.number}</span>
    </>
  );
}

/** Lists a project's archived workspaces; each can be restored from its kept branch or permanently deleted. */
export default function RestoreWorkspaceDialog({ open, onOpenChange, projectId }: RestoreWorkspaceDialogProps) {
  const navigate = useNavigate();
  const archives = useArchivedWorkspaces(projectId, open);
  const restore = useRestoreWorkspace(projectId);
  const deleteArchive = useDeleteArchivedWorkspace(projectId);
  const [deleteTarget, setDeleteTarget] = useState<ArchivedWorkspaceItem | null>(null);
  const items = archives.data ?? [];

  async function handleRestore(wsId: string) {
    if (restore.isPending) return;
    try {
      const workspace = await restore.mutateAsync(wsId);
      onOpenChange(false);
      navigate(`/workspaces/${workspace.id}`);
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Failed to restore workspace");
    }
  }

  async function handleDelete(item: ArchivedWorkspaceItem) {
    setDeleteTarget(null);
    try {
      await deleteArchive.mutateAsync(item.id);
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Failed to delete archived workspace");
    }
  }

  // Branches that pre-existed the workspace are kept; only mention removal when it will happen.

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className={cn(SPOTLIGHT_DIALOG_CLASS, "gap-0 bg-popover p-0 text-popover-foreground")}
          showCloseButton={false}
          aria-describedby={undefined}
        >
          <DialogTitle className="border-b px-3 py-3 text-sm font-medium">Restore workspace</DialogTitle>
          <div className={cn(SPOTLIGHT_LIST_CLASS, "overflow-y-auto p-1")} role="list" aria-label="Archived workspaces">
            {archives.isLoading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                <Spinner className="size-4" />
                Loading…
              </div>
            ) : archives.isError ? (
              <div className="py-8 text-center text-sm text-muted-foreground">Failed to load archived workspaces</div>
            ) : items.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">No archived workspaces</div>
            ) : (
              items.map((item) => {
                const isRestoring = restore.isPending && restore.variables === item.id;
                return (
                  <div
                    key={item.id}
                    role="listitem"
                    className={cn(
                      "flex w-full items-center gap-2 rounded-sm px-2 py-2 text-sm",
                      !item.branchExists && "text-muted-foreground opacity-60",
                    )}
                  >
                    <span className="min-w-0 truncate">{item.name}</span>
                    <span className="flex min-w-0 items-center gap-1 truncate text-xs text-muted-foreground">
                      <SourceBadge source={item.source} />
                      <span className="truncate">{item.branch}</span>
                      {!item.branchExists && <span className="shrink-0">· Branch missing</span>}
                    </span>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                      {formatRelativeTime(item.archivedAt)}
                    </span>
                    <Button
                      variant="outline"
                      size="xs"
                      className="shrink-0"
                      disabled={!item.branchExists || restore.isPending}
                      onClick={() => void handleRestore(item.id)}
                      aria-label={`Restore ${item.name}`}
                    >
                      {isRestoring && <Spinner className="size-3" />}
                      Restore
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="shrink-0"
                      disabled={deleteArchive.isPending}
                      onClick={() => setDeleteTarget(item)}
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
                if (deleteTarget) void handleDelete(deleteTarget);
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
