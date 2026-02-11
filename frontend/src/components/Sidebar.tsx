import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
import type { Project } from "@/types";

interface SidebarProps {
  projects: Project[];
  loading: boolean;
  onAddProject: () => void;
  onDeleteProject: (id: string) => Promise<void>;
}

export default function Sidebar({
  projects,
  loading,
  onAddProject,
  onDeleteProject,
}: SidebarProps) {
  const { id: activeProjectId, wsId: activeWsId } = useParams();
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);

  return (
    <div className="flex h-full w-60 flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <Link to="/" className="text-lg font-bold">
          Hive
        </Link>
      </div>

      <ScrollArea className="flex-1 px-2 py-2">
        <div className="mb-2 px-2 text-xs font-semibold uppercase text-muted-foreground">
          Projects
        </div>
        {loading ? (
          <div className="space-y-2 px-2">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-6 w-full" />
          </div>
        ) : (
          projects.map((project) => (
            <div key={project.id} className="mb-1">
              <div className="group flex items-center">
                <Link
                  to={`/projects/${project.id}`}
                  className={`flex-1 rounded-md px-2 py-1.5 text-sm font-medium hover:bg-sidebar-accent ${
                    activeProjectId === project.id ? "bg-sidebar-accent" : ""
                  }`}
                >
                  {project.name}
                </Link>
                <button
                  className="mr-1 hidden rounded p-0.5 text-muted-foreground hover:text-destructive group-hover:block"
                  onClick={() => setDeleteTarget(project)}
                  title="Delete project"
                >
                  <svg
                    className="h-3.5 w-3.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>
              {(project.workspaces ?? []).map((ws) => (
                <Link
                  key={ws.id}
                  to={`/workspaces/${ws.id}`}
                  className={`flex items-center gap-1.5 rounded-md px-4 py-1 text-sm hover:bg-sidebar-accent ${
                    activeWsId === ws.id ? "bg-sidebar-accent" : ""
                  }`}
                >
                  <span
                    className={`inline-block h-2 w-2 rounded-full ${
                      ws.status === "running" ? "bg-green-500" : "bg-muted-foreground/40"
                    }`}
                  />
                  {ws.name}
                </Link>
              ))}
            </div>
          ))
        )}
      </ScrollArea>

      <div className="border-t p-2">
        <Button variant="outline" className="w-full" onClick={onAddProject}>
          + Add Project
        </Button>
      </div>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete project?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{deleteTarget?.name}</strong> and all
              its workspaces. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (deleteTarget) {
                  await onDeleteProject(deleteTarget.id);
                  setDeleteTarget(null);
                }
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
