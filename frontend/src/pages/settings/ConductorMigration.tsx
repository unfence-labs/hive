import { useEffect, useState, useCallback } from "react";
import { ArrowDownToLine, CheckCircle2, Loader2, AlertCircle, Package, GitBranch, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/hooks/useApi";
import { getServerUrl } from "@/hooks/useServerUrl";

// ── Types ───────────────────────────────────────────────────────────

interface ConductorProjectSummary {
  id: string;
  name: string;
  remoteUrl: string;
  workspaceCount: number;
  sessionCount: number;
  messageCount: number;
  alreadyImported: boolean;
}

interface ScanResult {
  found: boolean;
  dbPath: string;
  projects: ConductorProjectSummary[];
  totals: {
    projects: number;
    workspaces: number;
    sessions: number;
    messages: number;
  };
}

type ImportProgressEvent =
  | { type: "start"; totalProjects: number; totalWorkspaces: number }
  | { type: "project_start"; projectIndex: number; projectName: string; workspaceCount: number }
  | { type: "project_cloning"; projectIndex: number; projectName: string }
  | { type: "project_cloned"; projectIndex: number; projectName: string }
  | { type: "workspace_importing"; projectIndex: number; workspaceName: string; branch: string }
  | { type: "workspace_imported"; projectIndex: number; workspaceName: string; sessionCount: number }
  | { type: "workspace_skipped"; projectIndex: number; workspaceName: string; reason: string }
  | { type: "project_done"; projectIndex: number; projectName: string }
  | { type: "done"; imported: { projects: number; workspaces: number; sessions: number } }
  | { type: "error"; message: string; projectName?: string };

type Phase = "scanning" | "ready" | "importing" | "done" | "error" | "not_found";

interface ProjectProgress {
  name: string;
  workspaceCount: number;
  status: "pending" | "cloning" | "importing" | "done" | "error";
  importedWorkspaces: number;
  importedSessions: number;
  errorMessage?: string;
}

// ── Component ───────────────────────────────────────────────────────

export default function ConductorMigration() {
  const [phase, setPhase] = useState<Phase>("scanning");
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [projectProgress, setProjectProgress] = useState<ProjectProgress[]>([]);
  const [importResult, setImportResult] = useState<{ projects: number; workspaces: number; sessions: number } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    api.get<ScanResult>("/api/conductor/scan")
      .then((data) => {
        setScan(data);
        setPhase(data.found ? "ready" : "not_found");
      })
      .catch(() => {
        setPhase("not_found");
      });
  }, []);

  const startImport = useCallback(async () => {
    if (!scan) return;

    setPhase("importing");
    setErrorMessage(null);

    // Initialize progress state
    const initialProgress: ProjectProgress[] = scan.projects
      .filter((p) => !p.alreadyImported)
      .map((p) => ({
        name: p.name,
        workspaceCount: p.workspaceCount,
        status: "pending" as const,
        importedWorkspaces: 0,
        importedSessions: 0,
      }));
    setProjectProgress(initialProgress);

    try {
      const base = getServerUrl();
      const authToken = import.meta.env.VITE_HIVE_AUTH_TOKEN?.trim();
      const headers: Record<string, string> = {};
      if (authToken) headers.Authorization = `Bearer ${authToken}`;

      const response = await fetch(`${base}/api/conductor/import`, {
        method: "POST",
        headers,
      });

      if (!response.ok || !response.body) {
        throw new Error("Import request failed");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event: ImportProgressEvent = JSON.parse(line);
            handleProgressEvent(event, setProjectProgress, setImportResult, setPhase, setErrorMessage);
          } catch {
            // Skip malformed lines
          }
        }
      }

      // Process remaining buffer
      if (buffer.trim()) {
        try {
          const event: ImportProgressEvent = JSON.parse(buffer);
          handleProgressEvent(event, setProjectProgress, setImportResult, setPhase, setErrorMessage);
        } catch {
          // Skip
        }
      }
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Import failed");
      setPhase("error");
    }
  }, [scan]);

  if (phase === "scanning") {
    return (
      <PageShell>
        <div className="flex items-center gap-3 py-12 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Scanning for Conductor data...</span>
        </div>
      </PageShell>
    );
  }

  if (phase === "not_found") {
    return (
      <PageShell>
        <section className="rounded-lg border border-border/50 bg-card/50 p-5">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div>
              <h2 className="text-sm font-medium text-foreground">No Conductor installation found</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Could not find a Conductor database. Make sure Conductor is installed and has been used at least once.
              </p>
            </div>
          </div>
        </section>
      </PageShell>
    );
  }

  const importableProjects = scan?.projects.filter((p) => !p.alreadyImported) ?? [];
  const alreadyImportedProjects = scan?.projects.filter((p) => p.alreadyImported) ?? [];

  return (
    <PageShell>
      {/* Summary card */}
      {phase === "ready" && scan && (
        <section className="rounded-lg border border-border/50 bg-card/50 p-5">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-sm font-medium text-foreground">
                {scan.totals.projects} project{scan.totals.projects !== 1 ? "s" : ""} detected on Conductor
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {scan.totals.workspaces} workspace{scan.totals.workspaces !== 1 ? "s" : ""},{" "}
                {scan.totals.sessions} session{scan.totals.sessions !== 1 ? "s" : ""},{" "}
                {scan.totals.messages.toLocaleString()} messages
              </p>
            </div>
          </div>

          {/* Project list */}
          <div className="mt-4 space-y-2">
            {importableProjects.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
            {alreadyImportedProjects.map((project) => (
              <ProjectCard key={project.id} project={project} imported />
            ))}
          </div>

          {/* Import button */}
          {importableProjects.length > 0 ? (
            <div className="mt-5">
              <button
                type="button"
                onClick={() => void startImport()}
                className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <ArrowDownToLine className="h-4 w-4" />
                Import {importableProjects.length} project{importableProjects.length !== 1 ? "s" : ""} to Hive
              </button>
            </div>
          ) : (
            <p className="mt-4 text-xs text-muted-foreground">
              All projects are already imported.
            </p>
          )}
        </section>
      )}

      {/* Import progress */}
      {(phase === "importing" || phase === "done" || phase === "error") && (
        <section className="space-y-3">
          {projectProgress.map((proj, i) => (
            <ImportProgressCard key={i} project={proj} />
          ))}

          {phase === "done" && importResult && (
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
              <p className="text-sm text-emerald-500">
                Migration complete — {importResult.projects} project{importResult.projects !== 1 ? "s" : ""},{" "}
                {importResult.workspaces} workspace{importResult.workspaces !== 1 ? "s" : ""},{" "}
                {importResult.sessions} session{importResult.sessions !== 1 ? "s" : ""} imported.
                Refresh the app to see your workspaces.
              </p>
            </div>
          )}

          {phase === "error" && errorMessage && (
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/5 p-4">
              <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />
              <p className="text-sm text-red-500">{errorMessage}</p>
            </div>
          )}
        </section>
      )}
    </PageShell>
  );
}

// ── Sub-components ──────────────────────────────────────────────────

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col overflow-auto">
      <div className="border-b border-border/50 px-8 py-5" data-tauri-drag-region>
        <h1 className="text-base font-semibold">Import from Conductor</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Migrate your Conductor projects, workspaces, and chat history to Hive.
        </p>
      </div>
      <div className="max-w-2xl space-y-6 px-8 py-6">{children}</div>
    </div>
  );
}

function ProjectCard({ project, imported }: { project: ConductorProjectSummary; imported?: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center justify-between rounded-md border px-3 py-2.5",
        imported
          ? "border-border/30 bg-muted/20 opacity-60"
          : "border-border/50 bg-background/50",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Package className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm font-medium">{project.name}</span>
          {imported && (
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              Already imported
            </span>
          )}
        </div>
        <div className="mt-1 flex items-center gap-3 pl-5.5 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <GitBranch className="h-3 w-3" />
            {project.workspaceCount} workspace{project.workspaceCount !== 1 ? "s" : ""}
          </span>
          <span className="flex items-center gap-1">
            <MessageSquare className="h-3 w-3" />
            {project.sessionCount} session{project.sessionCount !== 1 ? "s" : ""}
          </span>
        </div>
      </div>
    </div>
  );
}

function ImportProgressCard({ project }: { project: ProjectProgress }) {
  const progress = project.workspaceCount > 0
    ? Math.round((project.importedWorkspaces / project.workspaceCount) * 100)
    : project.status === "done" ? 100 : 0;

  return (
    <div className="rounded-lg border border-border/50 bg-card/50 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {project.status === "done" ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          ) : project.status === "error" ? (
            <AlertCircle className="h-4 w-4 text-red-500" />
          ) : project.status === "pending" ? (
            <Package className="h-4 w-4 text-muted-foreground" />
          ) : (
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          )}
          <span className="text-sm font-medium">{project.name}</span>
        </div>
        <span className="text-xs text-muted-foreground">
          {project.status === "cloning" && "Cloning repository..."}
          {project.status === "importing" && `${project.importedWorkspaces}/${project.workspaceCount} workspaces`}
          {project.status === "done" && `${project.importedWorkspaces} workspaces, ${project.importedSessions} sessions`}
          {project.status === "error" && project.errorMessage}
        </span>
      </div>

      {/* Progress bar */}
      {(project.status === "cloning" || project.status === "importing" || project.status === "done") && (
        <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-muted/40">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-300",
              project.status === "done" ? "bg-emerald-500" : "bg-primary",
              project.status === "cloning" && "animate-pulse",
            )}
            style={{ width: `${project.status === "cloning" ? 15 : progress}%` }}
          />
        </div>
      )}
    </div>
  );
}

// ── Progress event handler ──────────────────────────────────────────

function handleProgressEvent(
  event: ImportProgressEvent,
  setProjectProgress: React.Dispatch<React.SetStateAction<ProjectProgress[]>>,
  setImportResult: React.Dispatch<React.SetStateAction<{ projects: number; workspaces: number; sessions: number } | null>>,
  setPhase: React.Dispatch<React.SetStateAction<Phase>>,
  setErrorMessage: React.Dispatch<React.SetStateAction<string | null>>,
) {
  switch (event.type) {
    case "project_start":
      setProjectProgress((prev) => {
        const next = [...prev];
        if (next[event.projectIndex]) {
          next[event.projectIndex] = {
            ...next[event.projectIndex],
            status: "pending",
            workspaceCount: event.workspaceCount,
          };
        }
        return next;
      });
      break;

    case "project_cloning":
      setProjectProgress((prev) => {
        const next = [...prev];
        if (next[event.projectIndex]) {
          next[event.projectIndex] = { ...next[event.projectIndex], status: "cloning" };
        }
        return next;
      });
      break;

    case "project_cloned":
      setProjectProgress((prev) => {
        const next = [...prev];
        if (next[event.projectIndex]) {
          next[event.projectIndex] = { ...next[event.projectIndex], status: "importing" };
        }
        return next;
      });
      break;

    case "workspace_imported":
      setProjectProgress((prev) => {
        const next = [...prev];
        if (next[event.projectIndex]) {
          next[event.projectIndex] = {
            ...next[event.projectIndex],
            status: "importing",
            importedWorkspaces: next[event.projectIndex].importedWorkspaces + 1,
            importedSessions: next[event.projectIndex].importedSessions + event.sessionCount,
          };
        }
        return next;
      });
      break;

    case "project_done":
      setProjectProgress((prev) => {
        const next = [...prev];
        if (next[event.projectIndex]) {
          next[event.projectIndex] = { ...next[event.projectIndex], status: "done" };
        }
        return next;
      });
      break;

    case "done":
      setImportResult(event.imported);
      setPhase("done");
      break;

    case "error":
      if (event.projectName) {
        setProjectProgress((prev) => {
          const idx = prev.findIndex((p) => p.name === event.projectName);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = { ...next[idx], status: "error", errorMessage: event.message };
            return next;
          }
          return prev;
        });
      } else {
        setErrorMessage(event.message);
        setPhase("error");
      }
      break;
  }
}
