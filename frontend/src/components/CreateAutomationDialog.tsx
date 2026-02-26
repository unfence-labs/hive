import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useProjects } from "@/hooks/useProjects";
import { usePromptTemplates } from "@/hooks/usePromptTemplates";
import { useCreateAutomation } from "@/hooks/useAutomations";
import { api } from "@/hooks/useApi";
import type { ModelCatalogEntry, ModelCatalogResponse } from "@/types";

interface CreateAutomationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
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

export default function CreateAutomationDialog({ open, onOpenChange }: CreateAutomationDialogProps) {
  const navigate = useNavigate();
  const { projects } = useProjects();
  const { data: templates } = usePromptTemplates();
  const createMutation = useCreateAutomation();

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

  useEffect(() => {
    if (!open) return;
    api.get<ModelCatalogResponse>("/api/models")
      .then((data) => {
        setModels(data.models);
        if (!modelId) setModelId(data.defaultModelId);
      })
      .catch(() => {});
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const cronExpression = schedulePreset || customCron;
  const systemTemplates = templates?.filter((t) => t.type === "system") ?? [];
  const userTemplates = templates?.filter((t) => t.type === "user") ?? [];

  const isValid =
    name.trim() &&
    cronExpression.trim() &&
    modelId &&
    (userPromptMode === "custom" ? userPromptInline.trim() : userPromptId);

  const handleSubmit = async () => {
    if (!isValid) return;

    const auto = await createMutation.mutateAsync({
      name: name.trim(),
      projectId: projectId || undefined,
      trigger: { type: "cron", expression: cronExpression },
      action: {
        type: "agent",
        modelId,
        ...(systemPromptMode === "template" && systemPromptId ? { systemPromptId } : {}),
        ...(systemPromptMode === "custom" && systemPromptInline.trim() ? { systemPromptInline: systemPromptInline.trim() } : {}),
        ...(userPromptMode === "template" && userPromptId ? { userPromptId } : {}),
        ...(userPromptMode === "custom" && userPromptInline.trim() ? { userPromptInline: userPromptInline.trim() } : {}),
      },
      notification: { onComplete: notifyComplete, onFailure: notifyFailure },
    });

    onOpenChange(false);
    navigate(`/automations/${auto.id}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Automation</DialogTitle>
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
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
          </Field>

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
            disabled={!isValid || createMutation.isPending}
            className={cn(
              "flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90",
              (!isValid || createMutation.isPending) && "pointer-events-none opacity-60",
            )}
          >
            {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Create Automation
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
