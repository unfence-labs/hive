import { useEffect, useMemo, useState } from "react";
import { Navigate, useParams, useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Clock,
  FileText,
  Loader2,
  Pencil,
  Play,
  Trash2,
} from "lucide-react";
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
import { SettingsHeader } from "@/components/AppLayout";
import AutomationDialog from "@/components/CreateAutomationDialog";
import AutomationRunLogSheet from "@/components/AutomationRunLogSheet";
import {
  useAutomation,
  useAutomationRuns,
  useUpdateAutomation,
  useDeleteAutomation,
  useTriggerAutomation,
} from "@/hooks/useAutomations";
import { usePromptTemplates } from "@/hooks/usePromptTemplates";
import { useAgents } from "@/hooks/useAgents";
import { useProjects } from "@/hooks/useProjects";
import { ApiError } from "@/hooks/useApi";
import { getNextRun, formatTimeUntil } from "@/lib/cron";
import { formatRelativeTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { AutomationRun } from "@/types";

export default function AutomationDetail() {
  const { automationId } = useParams();
  const navigate = useNavigate();
  const { data: auto, isLoading, error } = useAutomation(automationId);
  const { data: runs } = useAutomationRuns(automationId);
  const updateMutation = useUpdateAutomation();
  const deleteMutation = useDeleteAutomation();
  const triggerMutation = useTriggerAutomation();
  const { data: templates } = usePromptTemplates();
  const { data: agents } = useAgents();
  const { projects } = useProjects();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [logRun, setLogRun] = useState<AutomationRun | null>(null);

  const templateNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const t of templates ?? []) map[t.id] = t.name;
    return map;
  }, [templates]);

  const agentNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const a of agents ?? []) map[a.id] = a.name;
    return map;
  }, [agents]);

  const projectNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of projects) map[p.id] = p.name;
    return map;
  }, [projects]);

  if (error instanceof ApiError && error.status === 404) {
    return <Navigate to="/home" replace />;
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!auto) {
    return <Navigate to="/home" replace />;
  }

  const isRunning = auto.lastRunStatus === "running";

  const handleToggleEnabled = () => {
    updateMutation.mutate({ id: auto.id, enabled: !auto.enabled });
  };

  const handleTrigger = () => {
    triggerMutation.mutate(auto.id);
  };

  const handleDelete = async () => {
    await deleteMutation.mutateAsync(auto.id);
    navigate("/home");
  };

  return (
    <div className="flex h-full flex-col overflow-auto">
      <SettingsHeader>
        <div className="flex flex-1 items-center gap-3">
          <span
            className={cn(
              "h-2 w-2 shrink-0 rounded-full",
              isRunning
                ? "bg-blue-500 animate-pulse"
                : auto.enabled
                  ? "bg-emerald-500"
                  : "bg-muted-foreground/40",
            )}
          />
          <h1 className="text-sm font-medium">{auto.name}</h1>
        </div>
      </SettingsHeader>

      <div className="max-w-2xl space-y-5 px-4 py-5">
        {/* ── Controls ─────────────────────────────────────────────── */}
        <div className="flex items-center gap-3">
          <Toggle
            enabled={auto.enabled}
            onChange={handleToggleEnabled}
            disabled={updateMutation.isPending}
          />
          <span className="text-xs text-muted-foreground">
            {auto.enabled ? "Enabled" : "Disabled"}
          </span>

          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={() => setShowEditDialog(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border/50 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
            >
              <Pencil className="h-3 w-3" />
              Edit
            </button>

            <button
              type="button"
              onClick={handleTrigger}
              disabled={isRunning || triggerMutation.isPending}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border border-border/50 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground",
                (isRunning || triggerMutation.isPending) && "pointer-events-none opacity-60",
              )}
            >
              {triggerMutation.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Play className="h-3 w-3" />
              )}
              Run Now
            </button>

            <button
              type="button"
              onClick={() => setShowDeleteDialog(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-red-500/30 px-3 py-1.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/10"
            >
              <Trash2 className="h-3 w-3" />
              Delete
            </button>
          </div>
        </div>

        {/* ── Configuration ─────────────────────────────────────────── */}
        <section>
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Configuration
          </h2>
          <div className="space-y-px overflow-hidden rounded-lg border border-border/50">
            <ConfigRow label="Schedule" value={auto.trigger.expression} />
            {auto.enabled && <NextRunRow expression={auto.trigger.expression} isRunning={isRunning} />}
            <ConfigRow label="Agent" value={agentNames[auto.action.agentId] ?? auto.action.agentId} />
            {auto.projectId && <ConfigRow label="Project" value={projectNames[auto.projectId] ?? auto.projectId} />}
            {auto.action.userPromptId && (
              <ConfigRow label="User Prompt" value={templateNames[auto.action.userPromptId] ?? auto.action.userPromptId} />
            )}
            {auto.action.userPromptInline && (
              <ConfigBlock label="User Prompt" content={auto.action.userPromptInline} />
            )}
            <ConfigRow
              label="Notifications"
              value={[
                auto.notification.onComplete && "On complete",
                auto.notification.onFailure && "On failure",
              ]
                .filter(Boolean)
                .join(", ") || "None"}
            />
          </div>
        </section>

        {/* ── Run History ──────────────────────────────────────────── */}
        <section>
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Run History
          </h2>
          {!runs || runs.length === 0 ? (
            <div className="rounded-lg border border-border/50 px-4 py-6 text-center">
              <Clock className="mx-auto h-5 w-5 text-muted-foreground/40" />
              <p className="mt-2 text-xs text-muted-foreground">No runs yet</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {runs.map((run) => (
                <RunRow key={run.id} run={run} onViewLog={setLogRun} />
              ))}
            </div>
          )}
        </section>
      </div>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete automation</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete "{auto.name}" and all its run history. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleDelete()}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AutomationDialog
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        automation={auto}
      />

      <AutomationRunLogSheet
        automationId={auto.id}
        run={logRun}
        onClose={() => setLogRun(null)}
      />
    </div>
  );
}

function Toggle({
  enabled,
  onChange,
  disabled,
}: {
  enabled: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={onChange}
      disabled={disabled}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        enabled ? "bg-primary" : "bg-muted-foreground/30",
        disabled && "opacity-60",
      )}
    >
      <span
        className={cn(
          "pointer-events-none block h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
          enabled ? "translate-x-4" : "translate-x-0",
        )}
      />
    </button>
  );
}

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between bg-card/30 px-4 py-2.5 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="max-w-[60%] truncate text-right font-mono text-foreground">{value}</span>
    </div>
  );
}

function ConfigBlock({ label, content }: { label: string; content: string }) {
  return (
    <div className="bg-card/30 px-4 py-2.5 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <pre className="mt-1.5 whitespace-pre-wrap rounded-md bg-muted/20 p-2 font-mono text-foreground/80">
        {content}
      </pre>
    </div>
  );
}

function NextRunRow({ expression, isRunning }: { expression: string; isRunning: boolean }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  if (isRunning) {
    return <ConfigRow label="Next Run" value="Running now" />;
  }

  const nextRun = getNextRun(expression);
  if (!nextRun) return null;

  const diffMs = nextRun.getTime() - now;
  const value = diffMs <= 0 ? "due now" : formatTimeUntil(diffMs);

  return <ConfigRow label="Next Run" value={value} />;
}

function RunRow({ run, onViewLog }: { run: AutomationRun; onViewLog: (run: AutomationRun) => void }) {
  const [expanded, setExpanded] = useState(false);
  const duration = run.durationMs ? `${Math.round(run.durationMs / 1000)}s` : "--";
  const hasDetails = !!(run.summary || run.error);
  const canViewLog = run.status !== "running";

  return (
    <div className="overflow-hidden rounded-lg border border-border/50">
      <button
        type="button"
        onClick={() => hasDetails && setExpanded(!expanded)}
        className={cn(
          "flex w-full items-center gap-2.5 px-3 py-2 text-xs transition-colors",
          hasDetails && "cursor-pointer hover:bg-muted/20",
          !hasDetails && "cursor-default",
        )}
      >
        {/* Status icon */}
        {run.status === "running" ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-blue-400" />
        ) : run.status === "success" ? (
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
        ) : (
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-400" />
        )}

        <span className="text-muted-foreground">
          {formatRelativeTime(run.startedAt)}
        </span>
        <span className="tabular-nums text-muted-foreground/60">{duration}</span>

        {run.summary && (
          <span className="min-w-0 flex-1 truncate text-right text-foreground/60">
            {run.summary.slice(0, 80)}
          </span>
        )}

        {canViewLog && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onViewLog(run);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.stopPropagation(); onViewLog(run); }
            }}
            className="ml-auto shrink-0 inline-flex items-center gap-1 text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
          >
            <FileText className="h-3 w-3" />
            Log
          </span>
        )}

        {hasDetails && (
          <ChevronDown
            className={cn(
              "h-3 w-3 shrink-0 text-muted-foreground/40 transition-transform",
              expanded && "rotate-180",
            )}
          />
        )}
      </button>

      {expanded && hasDetails && (
        <div className="border-t border-border/50 bg-muted/10 px-3 py-2.5 text-xs">
          {run.error && (
            <p className="text-red-400">{run.error}</p>
          )}
          {run.summary && (
            <pre className="whitespace-pre-wrap text-muted-foreground">{run.summary}</pre>
          )}
        </div>
      )}
    </div>
  );
}
