import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { getNextRuns } from "@/lib/cron";
import { useProjects } from "@/hooks/useProjects";
import { usePromptTemplates } from "@/hooks/usePromptTemplates";
import { useAgents } from "@/hooks/useAgents";
import { useCreateAutomation, useUpdateAutomation } from "@/hooks/useAutomations";
import type { Automation } from "@/types";

interface AutomationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When provided, the dialog operates in edit mode. */
  automation?: Automation;
}

const SCHEDULE_PRESETS = [
  { label: "Every hour", expression: "0 * * * *" },
  { label: "Every 6 hours", expression: "0 */6 * * *" },
  { label: "Daily at 2:00 AM", expression: "0 2 * * *" },
  { label: "Daily at 8:00 AM", expression: "0 8 * * *" },
  { label: "Daily at midnight", expression: "0 0 * * *" },
  { label: "Weekdays at 9:00 AM", expression: "0 9 * * 1-5" },
  { label: "Weekly on Monday", expression: "0 9 * * 1" },
  { label: "Custom...", expression: "" },
];

export default function AutomationDialog({ open, onOpenChange, automation }: AutomationDialogProps) {
  const navigate = useNavigate();
  const { projects } = useProjects();
  const { data: templates } = usePromptTemplates();
  const { data: agents } = useAgents();
  const createMutation = useCreateAutomation();
  const updateMutation = useUpdateAutomation();

  const [name, setName] = useState("");
  const [projectId, setProjectId] = useState("");
  const [schedulePreset, setSchedulePreset] = useState("0 2 * * *");
  const [customCron, setCustomCron] = useState("");

  // Agent
  const [agentId, setAgentId] = useState("");

  // User prompt
  const [userPromptMode, setUserPromptMode] = useState<"custom" | "template">("custom");
  const [userPromptId, setUserPromptId] = useState("");
  const [userPromptInline, setUserPromptInline] = useState("");

  // Notifications
  const [notifyComplete, setNotifyComplete] = useState(true);
  const [notifyFailure, setNotifyFailure] = useState(true);

  const isEditMode = !!automation;

  useEffect(() => {
    if (!open) return;

    if (automation) {
      // Edit mode: pre-fill from automation
      setName(automation.name);
      setProjectId(automation.projectId ?? "");

      const presetMatch = SCHEDULE_PRESETS.find(
        (p) => p.expression === automation.trigger.expression && p.expression !== "",
      );
      if (presetMatch) {
        setSchedulePreset(presetMatch.expression);
        setCustomCron("");
      } else {
        setSchedulePreset("");
        setCustomCron(automation.trigger.expression);
      }

      setAgentId(automation.action.agentId);

      if (automation.action.userPromptId) {
        setUserPromptMode("template");
        setUserPromptId(automation.action.userPromptId);
        setUserPromptInline("");
      } else {
        setUserPromptMode("custom");
        setUserPromptInline(automation.action.userPromptInline ?? "");
        setUserPromptId("");
      }

      setNotifyComplete(automation.notification.onComplete);
      setNotifyFailure(automation.notification.onFailure);
    } else {
      // Create mode: reset to defaults
      setName("");
      setProjectId("");
      setSchedulePreset("0 2 * * *");
      setCustomCron("");
      setAgentId("");
      setUserPromptMode("custom");
      setUserPromptId("");
      setUserPromptInline("");
      setNotifyComplete(true);
      setNotifyFailure(true);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const cronExpression = schedulePreset || customCron;
  const userTemplates = templates ?? [];
  const agentList = agents ?? [];
  const hasAgents = agentList.length > 0;

  const isValid =
    name.trim() &&
    cronExpression.trim() &&
    agentId &&
    (userPromptMode === "custom" ? userPromptInline.trim() : userPromptId);

  const isPending = createMutation.isPending || updateMutation.isPending;

  const handleSubmit = async () => {
    if (!isValid) return;

    const actionPayload = {
      type: "agent" as const,
      agentId,
      ...(userPromptMode === "template" && userPromptId ? { userPromptId } : {}),
      ...(userPromptMode === "custom" && userPromptInline.trim() ? { userPromptInline: userPromptInline.trim() } : {}),
    };

    if (automation) {
      await updateMutation.mutateAsync({
        id: automation.id,
        name: name.trim(),
        trigger: { type: "cron", expression: cronExpression },
        action: actionPayload,
        notification: { onComplete: notifyComplete, onFailure: notifyFailure },
      });
      onOpenChange(false);
    } else {
      const auto = await createMutation.mutateAsync({
        name: name.trim(),
        projectId: projectId || undefined,
        trigger: { type: "cron", expression: cronExpression },
        action: actionPayload,
        notification: { onComplete: notifyComplete, onFailure: notifyFailure },
      });
      onOpenChange(false);
      navigate(`/automations/${auto.id}`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditMode ? "Edit Automation" : "New Automation"}</DialogTitle>
          <DialogDescription>
            {isEditMode
              ? "Update schedule, agent, prompt, and notification behavior."
              : "Create a scheduled automation with an agent, prompt, and notifications."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Name */}
          <Field label="Name">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Nightly code audit"
              className="text-sm"
            />
          </Field>

          {/* Project */}
          <Field label="Project (optional)">
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              disabled={isEditMode}
              className={cn(
                "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isEditMode && "opacity-60",
              )}
            >
              <option value="">None</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </Field>

          {/* Schedule */}
          <Field label="Schedule">
            <select
              value={schedulePreset}
              onChange={(e) => setSchedulePreset(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {SCHEDULE_PRESETS.map((p) => (
                <option key={p.expression || "custom"} value={p.expression}>{p.label}</option>
              ))}
            </select>
            {schedulePreset === "" && (
              <Input
                value={customCron}
                onChange={(e) => setCustomCron(e.target.value)}
                placeholder="0 */6 * * *"
                className="mt-2 font-mono text-xs"
              />
            )}
            {cronExpression && <CronPreview expression={cronExpression} />}
          </Field>

          {/* Agent */}
          <Field label="Agent">
            {hasAgents ? (
              <select
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">Select an agent...</option>
                {agentList.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            ) : (
              <p className="text-xs text-muted-foreground">
                No agents yet. Create one on the{" "}
                <Link
                  to="/settings/team"
                  onClick={() => onOpenChange(false)}
                  className="text-primary underline-offset-2 hover:underline"
                >
                  Team settings page
                </Link>
                .
              </p>
            )}
          </Field>

          {/* User Prompt */}
          <Field label="User Prompt">
            <div className="flex gap-2 text-xs">
              {(["custom", "template"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setUserPromptMode(mode)}
                  className={cn(
                    "rounded-md px-2.5 py-1 transition-colors",
                    userPromptMode === mode
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:text-foreground",
                  )}
                >
                  {mode === "template" ? "Template" : "Custom"}
                </button>
              ))}
            </div>
            {userPromptMode === "template" ? (
              <select
                value={userPromptId}
                onChange={(e) => setUserPromptId(e.target.value)}
                className="mt-2 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
              >
                <option value="">Select a template...</option>
                {userTemplates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            ) : (
              <textarea
                value={userPromptInline}
                onChange={(e) => setUserPromptInline(e.target.value)}
                placeholder="What should the agent do?"
                rows={6}
                className="mt-2 flex min-h-[140px] w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            )}
          </Field>

          {/* Notifications */}
          <Field label="Notifications">
            <div className="space-y-2">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={notifyComplete}
                  onChange={(e) => setNotifyComplete(e.target.checked)}
                  className="rounded border-border"
                />
                Notify on completion
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={notifyFailure}
                  onChange={(e) => setNotifyFailure(e.target.checked)}
                  className="rounded border-border"
                />
                Notify on failure
              </label>
            </div>
          </Field>

          {/* Submit */}
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!isValid || isPending}
            className={cn(
              "flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90",
              (!isValid || isPending) && "pointer-events-none opacity-60",
            )}
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {isEditMode ? "Save Changes" : "Create Automation"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

function CronPreview({ expression }: { expression: string }) {
  const runs = getNextRuns(expression, 3);
  if (!runs) {
    return (
      <p className="mt-1.5 text-xs text-destructive">Invalid cron expression</p>
    );
  }
  const fmt = new Intl.DateTimeFormat(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
  return (
    <p className="mt-1.5 text-xs text-muted-foreground">
      Next: {runs.map((d) => fmt.format(d)).join(", ")}
    </p>
  );
}
