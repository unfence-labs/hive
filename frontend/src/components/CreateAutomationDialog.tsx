import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
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
import { useCreateAutomation, useUpdateAutomation } from "@/hooks/useAutomations";
import { api } from "@/hooks/useApi";
import type { Automation, AutomationTriggerType, GitHubEventType, ModelCatalogEntry, ModelCatalogResponse } from "@/types";

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

const GITHUB_EVENT_OPTIONS: { value: GitHubEventType; label: string; group: string }[] = [
  { value: "pull_request.opened", label: "PR opened", group: "Pull Requests" },
  { value: "pull_request.synchronize", label: "PR updated (new commits)", group: "Pull Requests" },
  { value: "pull_request.reopened", label: "PR reopened", group: "Pull Requests" },
  { value: "pull_request.comment", label: "PR comment", group: "Pull Requests" },
  { value: "pull_request.review_submitted", label: "PR review submitted", group: "Pull Requests" },
  { value: "issues.opened", label: "Issue opened", group: "Issues" },
  { value: "issues.comment", label: "Issue comment", group: "Issues" },
];

export default function AutomationDialog({ open, onOpenChange, automation }: AutomationDialogProps) {
  const navigate = useNavigate();
  const { projects } = useProjects();
  const { data: templates } = usePromptTemplates();
  const createMutation = useCreateAutomation();
  const updateMutation = useUpdateAutomation();

  const [name, setName] = useState("");
  const [projectId, setProjectId] = useState("");
  const [schedulePreset, setSchedulePreset] = useState("0 2 * * *");
  const [customCron, setCustomCron] = useState("");
  const [modelId, setModelId] = useState("");
  const [models, setModels] = useState<ModelCatalogEntry[]>([]);

  // System prompt
  const [systemPromptMode, setSystemPromptMode] = useState<"none" | "template" | "custom">("none");
  const [systemPromptId, setSystemPromptId] = useState("");
  const [systemPromptInline, setSystemPromptInline] = useState("");

  // User prompt
  const [userPromptMode, setUserPromptMode] = useState<"custom" | "template">("custom");
  const [userPromptId, setUserPromptId] = useState("");
  const [userPromptInline, setUserPromptInline] = useState("");

  // Notifications
  const [notifyComplete, setNotifyComplete] = useState(true);
  const [notifyFailure, setNotifyFailure] = useState(true);

  // GitHub event trigger
  const [triggerType, setTriggerType] = useState<AutomationTriggerType>("cron");
  const [githubEvents, setGithubEvents] = useState<GitHubEventType[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [filterLabels, setFilterLabels] = useState("");
  const [postResultAsComment, setPostResultAsComment] = useState(true);

  const isEditMode = !!automation;

  useEffect(() => {
    if (!open) return;

    if (automation) {
      // Edit mode: pre-fill from automation
      setName(automation.name);
      setProjectId(automation.projectId ?? "");

      const triggerExpression = automation.trigger.type === "cron" ? automation.trigger.expression : "";
      const presetMatch = SCHEDULE_PRESETS.find(
        (p) => p.expression === triggerExpression && p.expression !== "",
      );
      if (presetMatch) {
        setSchedulePreset(presetMatch.expression);
        setCustomCron("");
      } else {
        setSchedulePreset("");
        setCustomCron(triggerExpression);
      }

      setModelId(automation.action.modelId);

      if (automation.action.systemPromptId) {
        setSystemPromptMode("template");
        setSystemPromptId(automation.action.systemPromptId);
        setSystemPromptInline("");
      } else if (automation.action.systemPromptInline) {
        setSystemPromptMode("custom");
        setSystemPromptInline(automation.action.systemPromptInline);
        setSystemPromptId("");
      } else {
        setSystemPromptMode("none");
        setSystemPromptId("");
        setSystemPromptInline("");
      }

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

      if (automation.trigger.type === "github_event") {
        setTriggerType("github_event");
        setGithubEvents(automation.trigger.events as GitHubEventType[]);
        setFilterLabels(automation.trigger.labelFilter?.join(", ") ?? "");
        setShowFilters(!!automation.trigger.labelFilter?.length);
      } else {
        setTriggerType("cron");
        setGithubEvents([]);
        setFilterLabels("");
        setShowFilters(false);
      }
      setPostResultAsComment(automation.action.postResultAsComment ?? false);
    } else {
      // Create mode: reset to defaults
      setName("");
      setProjectId("");
      setSchedulePreset("0 2 * * *");
      setCustomCron("");
      setModelId("");
      setSystemPromptMode("none");
      setSystemPromptId("");
      setSystemPromptInline("");
      setUserPromptMode("custom");
      setUserPromptId("");
      setUserPromptInline("");
      setNotifyComplete(true);
      setNotifyFailure(true);
      setTriggerType("cron");
      setGithubEvents([]);
      setShowFilters(false);
      setFilterLabels("");
      setPostResultAsComment(true);
    }

    api.get<ModelCatalogResponse>("/api/models")
      .then((data) => {
        setModels(data.models);
        // In create mode, default to the API's default model
        if (!automation) setModelId((prev) => prev || data.defaultModelId);
      })
      .catch(() => {});
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const cronExpression = schedulePreset || customCron;
  const systemTemplates = templates?.filter((t) => t.type === "system") ?? [];
  const userTemplates = templates?.filter((t) => t.type === "user") ?? [];

  const triggerValid = triggerType === "cron"
    ? cronExpression.trim()
    : (githubEvents.length > 0 && !!projectId);

  const isValid =
    name.trim() &&
    triggerValid &&
    modelId &&
    (userPromptMode === "custom" ? userPromptInline.trim() : userPromptId);

  const isPending = createMutation.isPending || updateMutation.isPending;

  const handleSubmit = async () => {
    if (!isValid) return;

    const triggerPayload = triggerType === "cron"
      ? { type: "cron" as const, expression: cronExpression }
      : {
          type: "github_event" as const,
          events: githubEvents,
          ...(filterLabels.trim() ? { labelFilter: filterLabels.split(",").map(l => l.trim()).filter(Boolean) } : {}),
        };

    const actionPayload = {
      type: "agent" as const,
      modelId,
      ...(systemPromptMode === "template" && systemPromptId ? { systemPromptId } : {}),
      ...(systemPromptMode === "custom" && systemPromptInline.trim() ? { systemPromptInline: systemPromptInline.trim() } : {}),
      ...(userPromptMode === "template" && userPromptId ? { userPromptId } : {}),
      ...(userPromptMode === "custom" && userPromptInline.trim() ? { userPromptInline: userPromptInline.trim() } : {}),
      ...(triggerType === "github_event" && postResultAsComment ? { postResultAsComment: true } : {}),
    };

    if (automation) {
      await updateMutation.mutateAsync({
        id: automation.id,
        name: name.trim(),
        trigger: triggerPayload,
        action: actionPayload,
        notification: { onComplete: notifyComplete, onFailure: notifyFailure },
      });
      onOpenChange(false);
    } else {
      const auto = await createMutation.mutateAsync({
        name: name.trim(),
        projectId: projectId || undefined,
        trigger: triggerPayload,
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
              ? "Update trigger, prompts, model, and notification behavior."
              : "Create an automation with a schedule or GitHub event trigger."}
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
          <Field label={triggerType === "github_event" ? "Project (required)" : "Project (optional)"}>
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

          {/* Trigger Type */}
          <Field label="Trigger Type">
            <div className="flex gap-2 text-xs">
              {(["cron", "github_event"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTriggerType(t)}
                  className={cn(
                    "rounded-md px-2.5 py-1 transition-colors",
                    triggerType === t
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t === "cron" ? "Schedule (Cron)" : "GitHub Event"}
                </button>
              ))}
            </div>
          </Field>

          {/* Schedule (cron only) */}
          {triggerType === "cron" && (
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
          )}

          {/* GitHub Event trigger sections */}
          {triggerType === "github_event" && (
            <>
              {/* GitHub Events */}
              <Field label="Events">
                <div className="space-y-1.5">
                  {GITHUB_EVENT_OPTIONS.map((opt) => (
                    <label key={opt.value} className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={githubEvents.includes(opt.value)}
                        onChange={(e) => {
                          setGithubEvents(prev =>
                            e.target.checked
                              ? [...prev, opt.value]
                              : prev.filter(v => v !== opt.value)
                          );
                        }}
                        className="rounded border-border"
                      />
                      {opt.label}
                    </label>
                  ))}
                </div>
              </Field>

              {/* Label filter */}
              <Field label="Filters (optional)">
                <button
                  type="button"
                  onClick={() => setShowFilters(!showFilters)}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showFilters ? "Hide filters" : "Add label filter..."}
                </button>
                {showFilters && (
                  <Input
                    value={filterLabels}
                    onChange={(e) => setFilterLabels(e.target.value)}
                    placeholder="bug, needs-review (comma separated)"
                    className="mt-2 text-sm"
                  />
                )}
              </Field>

              {/* Output */}
              <Field label="Output">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={postResultAsComment}
                    onChange={(e) => setPostResultAsComment(e.target.checked)}
                    className="rounded border-border"
                  />
                  Post result as GitHub comment
                </label>
              </Field>

              {/* Template Variables Preview */}
              <div className="rounded-md bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                <p className="mb-1 font-medium">Available template variables:</p>
                <div className="font-mono space-y-0.5">
                  {githubEvents.some(e => e.startsWith("pull_request.")) && (
                    <>
                      <p>{"{PR_NUMBER}"}, {"{PR_TITLE}"}, {"{PR_URL}"}</p>
                      <p>{"{PR_DIFF}"}, {"{PR_DESCRIPTION}"}, {"{PR_AUTHOR}"}</p>
                      <p>{"{PR_FILES}"}, {"{HEAD_SHA}"}</p>
                    </>
                  )}
                  {githubEvents.some(e => e.startsWith("issues.")) && (
                    <p>{"{ISSUE_NUMBER}"}, {"{ISSUE_TITLE}"}, {"{ISSUE_URL}"}, {"{ISSUE_BODY}"}</p>
                  )}
                  {githubEvents.some(e => e.endsWith(".comment")) && (
                    <p>{"{COMMENT_BODY}"}, {"{COMMENT_AUTHOR}"}</p>
                  )}
                  <p>{"{PREVIOUS_REVIEW}"}</p>
                </div>
              </div>
            </>
          )}

          {/* Model */}
          <Field label="Model">
            <select
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>{m.label} ({m.providerLabel})</option>
              ))}
            </select>
          </Field>

          {/* System Prompt */}
          <Field label="System Prompt">
            <div className="flex gap-2 text-xs">
              {(["none", "template", "custom"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setSystemPromptMode(mode)}
                  className={cn(
                    "rounded-md px-2.5 py-1 transition-colors",
                    systemPromptMode === mode
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:text-foreground",
                  )}
                >
                  {mode === "none" ? "None" : mode === "template" ? "Template" : "Custom"}
                </button>
              ))}
            </div>
            {systemPromptMode === "template" && (
              <select
                value={systemPromptId}
                onChange={(e) => setSystemPromptId(e.target.value)}
                className="mt-2 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
              >
                <option value="">Select a template...</option>
                {systemTemplates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            )}
            {systemPromptMode === "custom" && (
              <textarea
                value={systemPromptInline}
                onChange={(e) => setSystemPromptInline(e.target.value)}
                placeholder="System instructions..."
                rows={3}
                className="mt-2 flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
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
                rows={4}
                className="mt-2 flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
      <p className="mt-1.5 text-xs text-red-400">Invalid cron expression</p>
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
