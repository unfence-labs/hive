import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Trash2 } from "lucide-react";
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
import { getProjectColor } from "@/lib/project-colors";
import { cn } from "@/lib/utils";
import type { Project } from "@/types";

interface ProjectDetailProps {
  projects: Project[];
  onDeleteProject: (id: string) => Promise<void>;
}

export default function ProjectDetail({ projects, onDeleteProject }: ProjectDetailProps) {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const project = projects.find((p) => p.id === projectId);
  if (!project) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Project not found
      </div>
    );
  }

  const color = getProjectColor(project.name);
  const hasWorkspaces = (project.workspaces ?? []).length > 0;

  const handleDelete = async () => {
    await onDeleteProject(project.id);
    navigate("/settings/appearance");
  };

  return (
    <div className="flex h-full flex-col overflow-auto">
      <div className="border-b border-border/50 px-6 py-4">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "flex h-6 w-6 shrink-0 items-center justify-center rounded text-xs font-bold",
              color.bg,
              color.text,
            )}
          >
            {project.name[0]?.toUpperCase() ?? "?"}
          </span>
          <h1 className="text-sm font-semibold">{project.name}</h1>
        </div>
      </div>

      <div className="max-w-xl space-y-6 p-6">
        <InfoRow label="Repository URL" value={project.url} mono />

        {project.repoPath && (
          <InfoRow label="Bare repo path" value={project.repoPath} mono />
        )}

        {project.workspacesPath && (
          <InfoRow label="Workspaces path" value={project.workspacesPath} mono />
        )}

        <InfoRow
          label="Active workspaces"
          value={String((project.workspaces ?? []).length)}
        />

        <section className="border-t border-border/50 pt-6">
          <h2 className="mb-1 text-sm font-medium text-destructive">Danger zone</h2>
          <p className="mb-4 text-xs text-muted-foreground">
            {hasWorkspaces
              ? "Cannot delete a project with active workspaces. Archive all workspaces first."
              : "This will permanently delete the repository and all its data."}
          </p>
          <button
            type="button"
            disabled={hasWorkspaces}
            onClick={() => setShowDeleteConfirm(true)}
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors",
              hasWorkspaces
                ? "cursor-not-allowed text-muted-foreground opacity-50"
                : "text-destructive hover:bg-destructive/10",
            )}
          >
            <Trash2 className="h-4 w-4" />
            Delete project
          </button>
        </section>
      </div>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete project</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the repository and all its data. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleDelete()}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="mb-1 text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className={cn("text-sm text-foreground", mono && "font-mono text-xs")}>{value}</dd>
    </div>
  );
}
