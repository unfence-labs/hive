import { ChevronRight, Folder, FolderOpen, Pencil, Trash2 } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { SidebarProjectFolderView } from "@/hooks/useSidebarProjectFolders";
import type { Project } from "@/types";

interface SidebarFolderItemProps {
  folder: SidebarProjectFolderView;
  expanded: boolean;
  isActiveDropTarget: boolean;
  containsActiveProject: boolean;
  isDraggedFolder: boolean;
  isRenaming: boolean;
  isEmptyFolder: boolean;
  draggingFolderId: string | null;
  folderInsertIndicator: "before" | "after" | null;
  renameDraft: string;
  onOpenChange: (open: boolean) => void;
  onFolderDragOver: (event: React.DragEvent<HTMLDivElement>, folderId: string) => void;
  onFolderDrop: (event: React.DragEvent<HTMLDivElement>, folderId: string) => void;
  onFolderDragStart: (event: React.DragEvent<HTMLButtonElement>, folderId: string) => void;
  onFolderDragEnd: () => void;
  onFolderReorderDragOver: (
    event: React.DragEvent<HTMLDivElement>,
    folderId: string,
    position: "before" | "after",
  ) => void;
  onFolderReorderDrop: (
    event: React.DragEvent<HTMLDivElement>,
    folderId: string,
    position: "before" | "after",
  ) => void;
  onStartRenaming: (folderId: string, currentName: string) => void;
  onDeleteRequest: (folderId: string, folderName: string) => void;
  onRenameDraftChange: (value: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  renderProjectItem: (project: Project, folderId: string) => React.ReactNode;
}

export function SidebarFolderItem({
  folder,
  expanded,
  isActiveDropTarget,
  containsActiveProject,
  isDraggedFolder,
  isRenaming,
  isEmptyFolder,
  draggingFolderId,
  folderInsertIndicator,
  renameDraft,
  onOpenChange,
  onFolderDragOver,
  onFolderDrop,
  onFolderDragStart,
  onFolderDragEnd,
  onFolderReorderDragOver,
  onFolderReorderDrop,
  onStartRenaming,
  onDeleteRequest,
  onRenameDraftChange,
  onCommitRename,
  onCancelRename,
  renderProjectItem,
}: SidebarFolderItemProps) {
  return (
    <Collapsible
      key={folder.id}
      open={expanded}
      onOpenChange={onOpenChange}
    >
      <div
        data-sidebar-folder={folder.id}
        onDragOver={(event) => onFolderDragOver(event, folder.id)}
        onDrop={(event) => onFolderDrop(event, folder.id)}
        className="relative rounded-lg"
      >
        {draggingFolderId !== null && draggingFolderId !== folder.id && (
          <>
            <div
              data-folder-reorder="before"
              className="absolute inset-x-0 top-0 z-20 h-3"
              onDragOver={(event) => onFolderReorderDragOver(event, folder.id, "before")}
              onDrop={(event) => onFolderReorderDrop(event, folder.id, "before")}
            />
            <div
              data-folder-reorder="after"
              className="absolute inset-x-0 bottom-0 z-20 h-3"
              onDragOver={(event) => onFolderReorderDragOver(event, folder.id, "after")}
              onDrop={(event) => onFolderReorderDrop(event, folder.id, "after")}
            />
          </>
        )}
        {folderInsertIndicator && (
          <div
            className={cn(
              "pointer-events-none absolute inset-x-1 z-10 h-0.5 rounded-full bg-primary",
              folderInsertIndicator === "before" ? "top-0" : "bottom-0",
            )}
          />
        )}

        {isRenaming ? (
          <form
            className="flex w-full items-center gap-1.5 rounded py-1 pl-0 pr-1.5"
            onSubmit={(event) => {
              event.preventDefault();
              onCommitRename();
            }}
          >
            <ChevronRight className={cn("h-3.5 w-3.5 shrink-0", expanded && "rotate-90")} />
            {expanded ? (
              <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
              <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <Input
              value={renameDraft}
              onChange={(event) => onRenameDraftChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  onCancelRename();
                }
              }}
              onFocus={(event) => event.currentTarget.select()}
              onBlur={onCommitRename}
              autoFocus
              aria-label="Rename folder"
              className="h-6 min-w-0 flex-1 bg-background/80 px-1.5 py-0 text-[12px] font-medium"
            />
          </form>
        ) : (
          <div className="group/folder relative flex w-full items-center">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                draggable
                onDragStart={(event) => onFolderDragStart(event, folder.id)}
                onDragEnd={onFolderDragEnd}
                aria-grabbed={isDraggedFolder}
                className={cn(
                  "flex w-full items-center gap-1.5 rounded py-1 pl-0 pr-12 text-left transition-colors hover:bg-sidebar-accent/40",
                  containsActiveProject ? "text-sidebar-foreground" : "text-muted-foreground",
                  isActiveDropTarget && "bg-primary/10 text-sidebar-foreground ring-1 ring-primary/20",
                  isDraggedFolder && "cursor-grabbing opacity-45",
                )}
              >
                <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 transition-transform", expanded && "rotate-90")} />
                {expanded ? (
                  <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1 truncate text-[12px] font-medium">
                  {folder.name}
                </span>
              </button>
            </CollapsibleTrigger>

            <div className="pointer-events-none absolute inset-y-0 right-1 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/folder:pointer-events-auto group-hover/folder:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100">
              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onStartRenaming(folder.id, folder.name);
                }}
                className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50"
                aria-label={`Rename folder ${folder.name}`}
              >
                <Pencil className="h-3 w-3" />
              </button>
              {isEmptyFolder && (
                <button
                  type="button"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onDeleteRequest(folder.id, folder.name);
                  }}
                  className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-destructive/60"
                  aria-label={`Delete folder ${folder.name}`}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>
        )}

        <CollapsibleContent>
          <div className="ml-2 mt-px border-l border-sidebar-border/40 pl-2">
            {folder.projects.length > 0 ? (
              <div className="space-y-px py-0.5">
                {folder.projects.map((project) => renderProjectItem(project, folder.id))}
              </div>
            ) : (
              <div
                className={cn(
                  "py-1.5 text-xs text-muted-foreground/70 transition-colors",
                  isActiveDropTarget && "text-primary",
                )}
              >
                Drop repositories here
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
