import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Loader2, Play, Trash2 } from "lucide-react";
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
import {
  useAutomation,
  useAutomationRuns,
  useUpdateAutomation,
  useDeleteAutomation,
  useTriggerAutomation,
} from "@/hooks/useAutomations";
import { cn } from "@/lib/utils";
import type { AutomationRun } from "@/types";

export default function AutomationDetail() {
  const { automationId } = useParams();
  const navigate = useNavigate();
  const { data: auto, isLoading } = useAutomation(automationId);
  const { data: runs } = useAutomationRuns(automationId);
  const updateMutation = useUpdateAutomation();
  const deleteMutation = useDeleteAutomation();
  const triggerMutation = useTriggerAutomation();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  if (isLoading || !auto) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
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
    navigate("/projects");
  };

  return (
    <div className="flex h-full flex-col overflow-auto">
      <SettingsHeader>
        <div className="flex flex-1 items-center gap-3">
          <h1 className="text-sm font-medium">{auto.name}</h1>
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              isRunning
                ? "bg-blue-500 animate-pulse"
                : auto.enabled
                  ? "bg-emerald-500"
                  : "bg-muted-foreground/40",
            )}
          />
        </div>
      </SettingsHeader>

      <div className="max-w-2xl space-y-6 px-4 py-5">
        {/* ── Controls ─────────────────────────────────────────────────── */}
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
        <section className="rounded-lg border border-border/50 bg-card/50 p-5">
          <h2 className="text-sm font-medium text-foreground">Configuration</h2>
          <div className="mt-4 space-y-3">
            <ConfigRow label="Schedule" value={auto.trigger.expression} />
            <ConfigRow label="Model" value={auto.action.modelId} />
            {auto.projectId && <ConfigRow label="Project" value={auto.projectId} />}
            {auto.action.systemPromptId && (
              <ConfigRow label="System Prompt" value={`Template: ${auto.action.systemPromptId}`} />
            )}
            {auto.action.systemPromptInline && (
              <ConfigDetail label="System Prompt">
                <pre className="whitespace-pre-wrap text-xs text-muted-foreground">
                  {auto.action.systemPromptInline}
                </pre>
              </ConfigDetail>
            )}
            {auto.action.userPromptId && (
              <ConfigRow label="User Prompt" value={`Template: ${auto.action.userPromptId}`} />
            )}
            {auto.action.userPromptInline && (
              <ConfigDetail label="User Prompt">
                <pre className="whitespace-pre-wrap text-xs text-muted-foreground">
                  {auto.action.userPromptInline}
                </pre>
              </ConfigDetail>
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
        <section className="rounded-lg border border-border/50 bg-card/50 p-5">
          <h2 className="text-sm font-medium text-foreground">Run History</h2>
          {!runs || runs.length === 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">No runs yet</p>
          ) : (
            <div className="mt-3 space-y-2">
              {runs.map((run) => (
                <RunRow key={run.id} run={run} />
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
    <div className="flex items-start justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="max-w-[60%] text-right font-mono text-foreground">{value}</span>
    </div>
  );
}

function ConfigDetail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="text-xs">
      <span className="text-muted-foreground">{label}</span>
      <div className="mt-1 rounded-md bg-muted/30 p-2">{children}</div>
    </div>
  );
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function RunRow({ run }: { run: AutomationRun }) {
  const [expanded, setExpanded] = useState(false);

  const statusIcon =
    run.status === "running" ? "🔵" : run.status === "success" ? "✅" : "❌";
  const duration = run.durationMs ? `${Math.round(run.durationMs / 1000)}s` : "—";

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-muted/30"
      >
        <span>{statusIcon}</span>
        <span className="flex-1 text-left text-muted-foreground">
          {formatRelativeTime(run.startedAt)}
        </span>
        <span className="tabular-nums text-muted-foreground">{duration}</span>
        {run.summary && (
          <span className="max-w-[30%] truncate text-foreground/70">
            {run.summary.slice(0, 60)}
          </span>
        )}
      </button>
      {expanded && (run.summary || run.error) && (
        <div className="mx-2 mb-2 rounded-md bg-muted/20 p-3 text-xs">
          {run.error && <p className="text-red-400">{run.error}</p>}
          {run.summary && (
            <pre className="whitespace-pre-wrap text-muted-foreground">{run.summary}</pre>
          )}
        </div>
      )}
    </div>
  );
}
