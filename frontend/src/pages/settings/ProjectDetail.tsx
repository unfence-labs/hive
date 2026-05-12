import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Trash2, ExternalLink, Save } from "lucide-react";
import { SettingsHeader } from "@/components/AppLayout";
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
import { ProjectAvatar } from "@/components/ProjectAvatar";
import { useProjects } from "@/hooks/useProjects";
import { useProjectEnv, useUpdateProjectEnv, useDeleteProjectEnv } from "@/hooks/useProjectEnv";
import { cn } from "@/lib/utils";

export default function ProjectDetail() {
  const { projects, deleteProject } = useProjects();
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const project = projects.find((p) => p.id === projectId);
  const envQuery = useProjectEnv(project?.id);
  const updateEnv = useUpdateProjectEnv(project?.id);
  const deleteEnv = useDeleteProjectEnv(project?.id);
  const [envDraft, setEnvDraft] = useState("");

  useEffect(() => {
    setEnvDraft(envQuery.data?.content ?? "");
  }, [envQuery.data?.content, project?.id]);

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Project not found
      </div>
    );
  }

  const hasWorkspaces = (project.workspaces ?? []).length > 0;
  const workspaceCount = (project.workspaces ?? []).length;
  const envContent = envQuery.data?.content ?? "";
  const envConfigured = envQuery.data?.exists ?? false;
  const envDirty = envDraft !== envContent;

  const handleDelete = async () => {
    await deleteProject(project.id);
    navigate("/settings/appearance");
  };

  const handleSaveEnv = async () => {
    await updateEnv.mutateAsync(envDraft);
  };

  const handleDeleteEnv = async () => {
    await deleteEnv.mutateAsync();
  };

  return (
    <div className="flex h-full flex-col overflow-auto">
      <SettingsHeader>
        <div className="flex items-center gap-2.5">
          <ProjectAvatar name={project.name} projectId={project.id} hasFavicon={project.hasFavicon} />
          <h1 className="text-sm font-medium">{project.name}</h1>
        </div>
      </SettingsHeader>

      <div className="max-w-2xl space-y-6 px-4 py-5">
        <section className="rounded-lg border border-border/50 bg-card/50 p-5">
          <h2 className="mb-4 text-sm font-medium text-foreground">General</h2>

          <div className="space-y-4">
            <InfoRow label="Repository URL" mono>
              {project.url ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="truncate">{project.url}</span>
                  <a
                    href={project.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                    aria-label="Open repository URL"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </span>
              ) : (
                <span className="text-muted-foreground">Local only</span>
              )}
            </InfoRow>
            <InfoRow label="Bare repo path" mono>
              {project.repoPath ?? "\u2014"}
            </InfoRow>
            <InfoRow label="Workspaces path" mono>
              {project.workspacesPath ?? "\u2014"}
            </InfoRow>
          </div>
        </section>

        <section className="rounded-lg border border-border/50 bg-card/50 p-5">
          <div className="mb-4 flex items-center gap-3">
            <h2 className="text-sm font-medium text-foreground">Environment</h2>
            <span
              className={cn(
                "rounded-md px-2 py-0.5 text-[11px] font-medium",
                envConfigured
                  ? "bg-primary/10 text-primary"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {envConfigured ? "Configured" : "Not configured"}
            </span>
          </div>

          <textarea
            value={envDraft}
            onChange={(event) => setEnvDraft(event.target.value)}
            disabled={envQuery.isLoading}
            spellCheck={false}
            className="min-h-44 w-full resize-y rounded-lg border border-border/50 bg-background/70 p-3 font-mono text-xs leading-5 text-foreground outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-ring"
            placeholder={"DATABASE_URL=...\nAPI_KEY=..."}
          />

          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Stored locally and copied into new workspaces at creation.
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                disabled={!envDirty || updateEnv.isPending}
                onClick={() => setEnvDraft(envContent)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground",
                  (!envDirty || updateEnv.isPending) && "cursor-not-allowed opacity-50 hover:bg-transparent hover:text-muted-foreground",
                )}
              >
                Discard
              </button>
              <button
                type="button"
                disabled={!envConfigured || deleteEnv.isPending}
                onClick={() => void handleDeleteEnv()}
                className={cn(
                  "inline-flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                  envConfigured
                    ? "border-destructive/40 text-destructive hover:bg-destructive/10"
                    : "cursor-not-allowed border-border/30 text-muted-foreground/50",
                )}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </button>
              <button
                type="button"
                disabled={!envDirty || updateEnv.isPending}
                onClick={() => void handleSaveEnv()}
                className={cn(
                  "inline-flex cursor-pointer items-center gap-2 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90",
                  (!envDirty || updateEnv.isPending) && "cursor-not-allowed opacity-50 hover:opacity-50",
                )}
              >
                <Save className="h-3.5 w-3.5" />
                Save
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-border/50 bg-card/50 p-5">
          <h2 className="mb-4 text-sm font-medium text-foreground">Activity</h2>
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center justify-center rounded-md bg-primary/10 px-2.5 py-1 text-sm font-semibold tabular-nums text-primary">
              {workspaceCount}
            </span>
            <span className="text-sm text-muted-foreground">
              active workspace{workspaceCount !== 1 ? "s" : ""}
            </span>
          </div>
        </section>

        <section className="rounded-lg border border-destructive/20 bg-destructive/5 p-5">
          <h2 className="mb-1 text-sm font-medium text-destructive">Danger zone</h2>
          <p className="mb-4 text-xs text-muted-foreground">
            {hasWorkspaces
              ? "Cannot delete a project with active workspaces. Archive all workspaces first."
              : "This will permanently delete the bare repository and all associated data."}
          </p>
          <button
            type="button"
            disabled={hasWorkspaces}
            onClick={() => setShowDeleteConfirm(true)}
            className={cn(
              "inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
              hasWorkspaces
                ? "cursor-not-allowed border-border/30 text-muted-foreground/50"
                : "border-destructive/40 text-destructive hover:bg-destructive/10",
            )}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete project
          </button>
        </section>
      </div>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete project</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{project.name}</strong> and all its data. This action cannot be undone.
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

function InfoRow({ label, mono, children }: { label: string; mono?: boolean; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] items-baseline gap-3">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className={cn("min-w-0 text-sm text-foreground", mono && "font-mono text-xs")}>{children}</dd>
    </div>
  );
}
