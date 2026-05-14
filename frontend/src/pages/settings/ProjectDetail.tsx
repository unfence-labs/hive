import { useState, type ReactNode } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Trash2, ExternalLink, Save, Pencil, Plus, X, Eye } from "lucide-react";
import { SettingsHeader } from "@/components/AppLayout";
import { EnvEditor } from "@/components/EnvEditor";
import { ProjectEnvStructuredEditor } from "@/components/ProjectEnvStructuredEditor";
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
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ProjectAvatar } from "@/components/ProjectAvatar";
import { useProjects } from "@/hooks/useProjects";
import { useProjectEnv, useUpdateProjectEnv, useDeleteProjectEnv } from "@/hooks/useProjectEnv";
import { cn } from "@/lib/utils";
import type { Project, ProjectEnvConfig, ProjectEnvData } from "@/types";
import {
  countProjectEnvVariables,
  EMPTY_PROJECT_ENV_CONFIG,
  generateProjectEnvContent,
  normalizeProjectEnvConfig,
  validateProjectEnvConfig,
} from "@hive/shared/project-env";

export default function ProjectDetail() {
  const { projects, deleteProject } = useProjects();
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const project = projects.find((p) => p.id === projectId);
  const envQuery = useProjectEnv(project?.id);
  const [editingEnvProjectId, setEditingEnvProjectId] = useState<string | null>(null);

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Project not found
      </div>
    );
  }

  const hasWorkspaces = (project.workspaces ?? []).length > 0;
  const workspaceCount = (project.workspaces ?? []).length;
  const envEditorOpen = editingEnvProjectId === project.id;
  const envConfig = envQuery.data?.config ?? EMPTY_PROJECT_ENV_CONFIG;
  const envConfigured = envQuery.data?.exists ?? false;
  const envPath = envQuery.data?.path;
  const envRevision = getEnvRevision(envQuery.data);

  const handleDelete = async () => {
    await deleteProject(project.id);
    navigate("/settings/appearance");
  };

  return (
    <div className="flex h-full flex-col overflow-auto">
      <SettingsHeader>
        <div className="flex items-center gap-2.5">
          <ProjectAvatar name={project.name} projectId={project.id} hasFavicon={project.hasFavicon} />
          <h1 className="text-sm font-medium">{project.name}</h1>
        </div>
      </SettingsHeader>

      <div className="max-w-2xl space-y-4 px-4 py-5">
        <section className="rounded-lg border border-border/50 bg-card/50 p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-sm font-medium text-foreground">Overview</h2>
            <span className="rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-medium tabular-nums text-primary">
              {workspaceCount} workspace{workspaceCount !== 1 ? "s" : ""}
            </span>
          </div>

          <div className="space-y-3">
            <InfoRow label="Repository" mono>
              {project.url ? (
                <span className="inline-flex max-w-full items-center gap-1.5">
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
            <InfoRow label="Bare repo" mono>
              {project.repoPath ?? "\u2014"}
            </InfoRow>
            <InfoRow label="Workspaces" mono>
              {project.workspacesPath ?? "\u2014"}
            </InfoRow>
            {envConfigured && envPath && (
              <InfoRow label="Env config" mono>
                {envPath}
              </InfoRow>
            )}
          </div>
        </section>

        <ProjectEnvSection
          project={project}
          envConfigured={envConfigured}
          envConfig={envConfig}
          envRevision={envRevision}
          envLoading={envQuery.isLoading}
          editorOpen={envEditorOpen}
          onOpenEditor={() => setEditingEnvProjectId(project.id)}
          onCloseEditor={() => setEditingEnvProjectId(null)}
        />

        <section className="rounded-lg border border-destructive/20 bg-destructive/5 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-medium text-destructive">Danger zone</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {hasWorkspaces
                  ? "Cannot delete a project with active workspaces. Archive all workspaces first."
                  : "This will permanently delete the bare repository and all associated data."}
              </p>
            </div>
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
          </div>
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

function ProjectEnvSection({
  project,
  envConfigured,
  envConfig,
  envRevision,
  envLoading,
  editorOpen,
  onOpenEditor,
  onCloseEditor,
}: {
  project: Project;
  envConfigured: boolean;
  envConfig: ProjectEnvConfig;
  envRevision: string;
  envLoading: boolean;
  editorOpen: boolean;
  onOpenEditor: () => void;
  onCloseEditor: () => void;
}) {
  const updateEnv = useUpdateProjectEnv(project.id);
  const deleteEnv = useDeleteProjectEnv(project.id);
  const [viewerOpen, setViewerOpen] = useState(false);
  const envEntryCount = countProjectEnvVariables(envConfig);
  const envStatusLabel = getEnvStatusLabel(envLoading, envConfigured);
  const envDescription = getEnvDescription(envLoading, envConfigured, envEntryCount);

  const handleDeleteEnv = async () => {
    await deleteEnv.mutateAsync();
    onCloseEditor();
  };

  const handleSaveEnv = async (config: ProjectEnvConfig) => {
    await updateEnv.mutateAsync(config);
    onCloseEditor();
  };

  return (
    <section className="rounded-lg border border-border/50 bg-card/50 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-medium text-foreground">Environment</h2>
            {envConfigured && !envLoading ? (
              <button
                type="button"
                onClick={() => setViewerOpen(true)}
                className="inline-flex cursor-pointer items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/15"
                title="View generated .env"
              >
                {envStatusLabel}
                <Eye className="h-3 w-3" aria-hidden="true" />
              </button>
            ) : (
              <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                {envStatusLabel}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {envDescription}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {envConfigured && (
            <button
              type="button"
              disabled={deleteEnv.isPending}
              onClick={() => void handleDeleteEnv()}
              className={cn(
                "inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-destructive/40 px-2.5 py-1 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10",
                deleteEnv.isPending && "cursor-not-allowed opacity-50",
              )}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </button>
          )}
          <button
            type="button"
            disabled={envLoading}
            onClick={editorOpen ? onCloseEditor : onOpenEditor}
            title={getEnvToggleTitle(envLoading, editorOpen, envConfigured)}
            aria-label={getEnvToggleTitle(envLoading, editorOpen, envConfigured)}
            className={cn(
              "inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border border-border/50 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground",
              envLoading && "cursor-not-allowed opacity-50 hover:bg-transparent hover:text-muted-foreground",
            )}
          >
            {envLoading ? (
              <span className="h-3.5 w-3.5" />
            ) : editorOpen ? (
              <X className="h-3.5 w-3.5" />
            ) : envConfigured ? (
              <Pencil className="h-3.5 w-3.5" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>

      {editorOpen && (
        <ProjectEnvEditor
          key={`${project.id}:${envRevision}`}
          initialConfig={envConfig}
          loading={envLoading}
          saving={updateEnv.isPending}
          onSave={(config) => void handleSaveEnv(config)}
        />
      )}

      <ProjectEnvViewer
        open={viewerOpen}
        onOpenChange={setViewerOpen}
        config={envConfig}
      />
    </section>
  );
}

function ProjectEnvViewer({
  open,
  onOpenChange,
  config,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: ProjectEnvConfig;
}) {
  const content = generateProjectEnvContent(config);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Generated .env</DialogTitle>
          <DialogDescription>
            Read-only view of the file generated for new workspaces.
          </DialogDescription>
        </DialogHeader>
        {content ? (
          <EnvEditor
            value={content}
            readOnly
            maxHeight="22rem"
            ariaLabel="Generated environment file"
            className="bg-background/70"
          />
        ) : (
          <div className="rounded-md border border-border/50 bg-background/60 px-3 py-2 text-xs text-muted-foreground">
            No variables configured.
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ProjectEnvEditor({
  initialConfig,
  loading,
  saving,
  onSave,
}: {
  initialConfig: ProjectEnvConfig;
  loading: boolean;
  saving: boolean;
  onSave: (config: ProjectEnvConfig) => void;
}) {
  const [draft, setDraft] = useState(initialConfig);
  const normalizedInitial = normalizeProjectEnvConfig(initialConfig);
  const normalizedDraft = normalizeProjectEnvConfig(draft);
  const validation = validateProjectEnvConfig(normalizedDraft);
  const dirty = JSON.stringify(normalizedDraft) !== JSON.stringify(normalizedInitial);
  const actionsDisabled = loading || saving || !dirty;
  const saveDisabled = actionsDisabled || !validation.valid;

  return (
    <div className="mt-4 border-t border-border/50 pt-4">
      <ProjectEnvStructuredEditor
        value={draft}
        onChange={setDraft}
        readOnly={loading}
      />

      <div className="mt-3 flex justify-end">
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            disabled={actionsDisabled}
            onClick={() => setDraft(initialConfig)}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground",
              actionsDisabled && "cursor-not-allowed opacity-50 hover:bg-transparent hover:text-muted-foreground",
            )}
          >
            Discard
          </button>
          <button
            type="button"
            disabled={saveDisabled}
            onClick={() => onSave(draft)}
            className={cn(
              "inline-flex cursor-pointer items-center gap-2 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90",
              saveDisabled && "cursor-not-allowed opacity-50 hover:opacity-50",
            )}
          >
            <Save className="h-3.5 w-3.5" />
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function getEnvStatusLabel(envLoading: boolean, envConfigured: boolean): string {
  if (envLoading) return "Loading";
  return envConfigured ? "Configured" : "Not configured";
}

function getEnvToggleTitle(
  envLoading: boolean,
  editorOpen: boolean,
  envConfigured: boolean,
): string {
  if (envLoading) return "Loading";
  if (editorOpen) return "Close";
  return envConfigured ? "Edit environment" : "Configure environment";
}

function getEnvDescription(
  envLoading: boolean,
  envConfigured: boolean,
  envVariableCount: number,
): string {
  if (envLoading) return "Loading project-level variables.";
  if (!envConfigured) return "Add project-level variables for generated workspace .env files.";
  return `${envVariableCount} variable${envVariableCount === 1 ? "" : "s"} stored locally for new workspaces.`;
}

function getEnvRevision(data: ProjectEnvData | undefined): string {
  if (!data) return "loading";
  if (!data.exists) return "missing";
  return data.updatedAt ?? `${data.sizeBytes ?? 0}:${JSON.stringify(data.config)}`;
}

function InfoRow({ label, mono, children }: { label: string; mono?: boolean; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[112px_minmax(0,1fr)] items-baseline gap-3">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className={cn("min-w-0 text-sm text-foreground", mono && "break-all font-mono text-xs")}>{children}</dd>
    </div>
  );
}
