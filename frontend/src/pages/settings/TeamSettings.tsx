import { useEffect, useState, useMemo } from "react";
import { Bot, Trash2, Save, X } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { PromptEditor } from "@/components/PromptEditor";
import { SettingsHeader } from "@/components/AppLayout";
import { CenterCard } from "@/components/CenterCard";
import { SettingsActionButton } from "@/components/settings/ProviderSync";
import { TEMPLATE_VARIABLES } from "@/lib/prompt-variables";
import {
  SettingsEmptySelection,
  SettingsResourceEmptyList,
  SettingsResourceList,
  SettingsResourceListItem,
} from "@/components/settings/SettingsResourceList";
import { cn } from "@/lib/utils";
import {
  useAgents,
  useCreateAgent,
  useUpdateAgent,
  useDeleteAgent,
} from "@/hooks/useAgents";
import { useModels } from "@/hooks/useModels";
import type { Agent, ModelCatalogEntry, ThinkingLevel } from "@/types";

// ── Types ──────────────────────────────────────────────────────────────

type Selection =
  | { kind: "agent"; id: string }
  | { kind: "create" }
  | null;

// ── Main page ──────────────────────────────────────────────────────────

export default function TeamSettings() {
  const { data: agents, isLoading } = useAgents();
  const { models, defaultModelId } = useModels();
  const [selection, setSelection] = useState<Selection>(null);
  const [deleteTarget, setDeleteTarget] = useState<Agent | null>(null);

  // Resolve the selected agent object
  const selectedAgent = useMemo(() => {
    if (selection?.kind !== "agent") return null;
    return agents?.find((a) => a.id === selection.id) ?? null;
  }, [selection, agents]);

  // If selected agent was deleted externally, fall back to empty state
  if (selection?.kind === "agent" && agents && !selectedAgent) {
    setSelection(null);
  }

  if (isLoading) return null;

  const handleDelete = (agent: Agent) => {
    setDeleteTarget(agent);
  };

  const handleDeleteDone = () => {
    if (deleteTarget && selection?.kind === "agent" && selection.id === deleteTarget.id) {
      setSelection(null);
    }
    setDeleteTarget(null);
  };

  const handleCreated = (id: string) => {
    setSelection({ kind: "agent", id });
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <SettingsHeader>
        <h1 className="text-sm font-medium">Team</h1>
      </SettingsHeader>

      <CenterCard>
      <div className="flex flex-1 overflow-hidden">
        {/* ── Left Panel ─────────────────────────────────────────── */}
        <LeftPanel
          selection={selection}
          onSelect={setSelection}
          agents={agents ?? []}
        />

        {/* ── Right Panel ────────────────────────────────────────── */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <RightPanel
            selection={selection}
            selectedAgent={selectedAgent}
            models={models}
            defaultModelId={defaultModelId}
            onDelete={handleDelete}
            onCreated={handleCreated}
            onCancel={() => setSelection(null)}
          />
        </div>
      </div>

      {/* Delete confirmation */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && handleDeleteDone()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete agent</AlertDialogTitle>
            <AlertDialogDescription>
              Delete &ldquo;{deleteTarget?.name}&rdquo;? This cannot be undone. Agents referenced
              by automations cannot be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <DeleteButton agent={deleteTarget} onDone={handleDeleteDone} />
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </CenterCard>
    </div>
  );
}

// ── Left Panel ─────────────────────────────────────────────────────────

function LeftPanel({
  selection,
  onSelect,
  agents,
}: {
  selection: Selection;
  onSelect: (s: Selection) => void;
  agents: Agent[];
}) {
  return (
    <SettingsResourceList
      showEmpty={agents.length === 0}
      empty={<SettingsResourceEmptyList>No agents yet — add one to get started.</SettingsResourceEmptyList>}
      actionLabel="Add Agent"
      actionActive={selection?.kind === "create"}
      onAction={() => onSelect({ kind: "create" })}
    >
      {agents.map((agent) => (
        <SettingsResourceListItem
          key={agent.id}
          icon={<Bot className="h-3.5 w-3.5 text-muted-foreground" />}
          title={agent.name}
          description={agent.description}
          selected={selection?.kind === "agent" && selection.id === agent.id}
          onClick={() => onSelect({ kind: "agent", id: agent.id })}
        />
      ))}
    </SettingsResourceList>
  );
}

// ── Right Panel ────────────────────────────────────────────────────────

function RightPanel({
  selection,
  selectedAgent,
  models,
  defaultModelId,
  onDelete,
  onCreated,
  onCancel,
}: {
  selection: Selection;
  selectedAgent: Agent | null;
  models: ModelCatalogEntry[];
  defaultModelId: string;
  onDelete: (a: Agent) => void;
  onCreated: (id: string) => void;
  onCancel: () => void;
}) {
  if (selection?.kind === "agent" && selectedAgent) {
    return (
      <AgentDetail
        key={selectedAgent.id}
        agent={selectedAgent}
        models={models}
        onDelete={() => onDelete(selectedAgent)}
      />
    );
  }

  if (selection?.kind === "create") {
    return (
      <CreateAgentForm
        models={models}
        defaultModelId={defaultModelId}
        onCreated={onCreated}
        onCancel={onCancel}
      />
    );
  }

  return <SettingsEmptySelection>Select an agent to edit, or add a new one</SettingsEmptySelection>;
}

// ── Shared form fields ─────────────────────────────────────────────────

function FormFields({
  name,
  setName,
  description,
  setDescription,
  systemPrompt,
  setSystemPrompt,
  modelId,
  setModelId,
  thinkingLevel,
  setThinkingLevel,
  models,
  readOnly,
  setReadOnly,
}: {
  name: string;
  setName: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  systemPrompt: string;
  setSystemPrompt: (v: string) => void;
  modelId: string;
  setModelId: (v: string) => void;
  thinkingLevel: ThinkingLevel | undefined;
  setThinkingLevel: (v: ThinkingLevel | undefined) => void;
  models: ModelCatalogEntry[];
  readOnly: boolean;
  setReadOnly: (v: boolean) => void;
}) {
  const selectedModel = modelForId(models, modelId);
  const resolvedThinkingLevel = resolveThinkingLevel(selectedModel, thinkingLevel);
  const thinkingLevels = selectedModel?.capabilities.thinkingLevels
    ?? (resolvedThinkingLevel ? [resolvedThinkingLevel] : []);

  useEffect(() => {
    if (resolvedThinkingLevel !== thinkingLevel) {
      setThinkingLevel(resolvedThinkingLevel);
    }
  }, [resolvedThinkingLevel, setThinkingLevel, thinkingLevel]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* Name + Model */}
      <div className="grid shrink-0 grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Name">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Code Auditor"
            className="text-sm"
          />
        </Field>
        <Field label="Model">
          <ModelSelect value={modelId} onChange={setModelId} models={models} />
        </Field>
      </div>

      {/* Hidden for models with no thinking-level control (e.g. Kimi). */}
      {resolvedThinkingLevel && thinkingLevels.length > 0 && (
        <Field label="Thinking">
          <ThinkingLevelChips
            value={resolvedThinkingLevel}
            onChange={setThinkingLevel}
            levels={thinkingLevels}
          />
        </Field>
      )}

      {/* Description */}
      <Field label="Description (optional)">
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Short summary shown in the list"
          className="text-sm"
        />
      </Field>

      {/* System prompt — fills the remaining height */}
      <div className="flex min-h-0 flex-1 flex-col">
        <label className="mb-1.5 block shrink-0 text-xs font-medium text-muted-foreground">
          Agent Instructions
        </label>
        <div className="min-h-0 flex-1">
          <PromptEditor
            value={systemPrompt}
            onChange={setSystemPrompt}
            maxHeight="100%"
            placeholder="You are a code auditor..."
          />
        </div>
        <div className="mt-2 flex shrink-0 flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground/70">
          <span className="font-medium text-muted-foreground">Variables:</span>
          {TEMPLATE_VARIABLES.map((v) => (
            <span key={v.token}>
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">{v.token}</code>{" "}
              <span className="text-muted-foreground/50">{v.desc}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Flags */}
      <div className="shrink-0 space-y-2">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={readOnly}
            onChange={(e) => setReadOnly(e.target.checked)}
            className="rounded border-border"
          />
          Read-only (block file edits)
        </label>
      </div>
    </div>
  );
}

// ── Agent Detail ───────────────────────────────────────────────────────

function AgentDetail({
  agent,
  models,
  onDelete,
}: {
  agent: Agent;
  models: ModelCatalogEntry[];
  onDelete: () => void;
}) {
  const updateMutation = useUpdateAgent();
  const [name, setName] = useState(agent.name);
  const [description, setDescription] = useState(agent.description ?? "");
  const [systemPrompt, setSystemPrompt] = useState(agent.systemPrompt);
  const [modelId, setModelId] = useState(agent.modelId);
  const [thinkingLevel, setThinkingLevel] = useState(agent.thinkingLevel);
  const [readOnly, setReadOnly] = useState(agent.readOnly);
  const resolvedThinkingLevel = resolveThinkingLevel(modelForId(models, modelId), thinkingLevel);

  const isDirty =
    name !== agent.name ||
    description !== (agent.description ?? "") ||
    systemPrompt !== agent.systemPrompt ||
    modelId !== agent.modelId ||
    resolvedThinkingLevel !== agent.thinkingLevel ||
    readOnly !== agent.readOnly;
  const isValid = name.trim() && systemPrompt.trim() && modelId;

  const handleSave = async () => {
    if (!isValid) return;
    await updateMutation.mutateAsync({
      id: agent.id,
      name: name.trim(),
      description: description.trim(),
      systemPrompt: systemPrompt.trim(),
      modelId,
      // Omitted for models with no thinking-level control (e.g. Kimi); the
      // backend rejects any level supplied for them.
      ...(resolvedThinkingLevel && { thinkingLevel: resolvedThinkingLevel }),
      readOnly,
    });
  };

  return (
    <div className="flex h-full flex-col overflow-hidden px-5 pt-5 pb-2">
      <div className="mb-4 shrink-0">
        <h2 className="text-base font-medium text-foreground">Edit Agent</h2>
      </div>

      <FormFields
        name={name}
        setName={setName}
        description={description}
        setDescription={setDescription}
        systemPrompt={systemPrompt}
        setSystemPrompt={setSystemPrompt}
        modelId={modelId}
        setModelId={setModelId}
        thinkingLevel={thinkingLevel}
        setThinkingLevel={setThinkingLevel}
        models={models}
        readOnly={readOnly}
        setReadOnly={setReadOnly}
      />

      {/* Actions */}
      <div className="mt-4 flex shrink-0 items-center gap-2">
        <SettingsActionButton
          variant="primary"
          onClick={() => void handleSave()}
          disabled={!isDirty || !isValid || updateMutation.isPending}
          pending={updateMutation.isPending}
          icon={<Save className="h-3 w-3" />}
        >
          Save
        </SettingsActionButton>
        <SettingsActionButton
          variant="danger"
          onClick={onDelete}
          icon={<Trash2 className="h-3 w-3" />}
        >
          Delete
        </SettingsActionButton>
      </div>
    </div>
  );
}

// ── Create Agent Form ──────────────────────────────────────────────────

function CreateAgentForm({
  models,
  defaultModelId,
  onCreated,
  onCancel,
}: {
  models: ModelCatalogEntry[];
  defaultModelId: string;
  onCreated: (id: string) => void;
  onCancel: () => void;
}) {
  const createMutation = useCreateAgent();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [modelId, setModelId] = useState("");
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel | undefined>("high");
  const [readOnly, setReadOnly] = useState(false);

  const resolvedModelId = modelId || defaultModelId;
  const resolvedThinkingLevel = resolveThinkingLevel(modelForId(models, resolvedModelId), thinkingLevel);

  const isValid = name.trim() && systemPrompt.trim() && resolvedModelId;

  const handleSubmit = async () => {
    if (!isValid) return;
    const result = await createMutation.mutateAsync({
      name: name.trim(),
      ...(description.trim() && { description: description.trim() }),
      systemPrompt: systemPrompt.trim(),
      modelId: resolvedModelId,
      // Omitted for models with no thinking-level control (e.g. Kimi).
      ...(resolvedThinkingLevel && { thinkingLevel: resolvedThinkingLevel }),
      readOnly,
    });
    onCreated(result.id);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden px-5 pt-5 pb-2">
      <div className="mb-4 shrink-0">
        <h2 className="text-base font-medium text-foreground">New Agent</h2>
      </div>

      <FormFields
        name={name}
        setName={setName}
        description={description}
        setDescription={setDescription}
        systemPrompt={systemPrompt}
        setSystemPrompt={setSystemPrompt}
        modelId={resolvedModelId}
        setModelId={setModelId}
        thinkingLevel={thinkingLevel}
        setThinkingLevel={setThinkingLevel}
        models={models}
        readOnly={readOnly}
        setReadOnly={setReadOnly}
      />

      {/* Actions */}
      <div className="mt-4 flex shrink-0 items-center gap-2">
        <SettingsActionButton
          variant="primary"
          onClick={() => void handleSubmit()}
          disabled={!isValid || createMutation.isPending}
          pending={createMutation.isPending}
          icon={<Save className="h-3 w-3" />}
        >
          Create
        </SettingsActionButton>
        <SettingsActionButton
          variant="secondary"
          onClick={onCancel}
          icon={<X className="h-3 w-3" />}
        >
          Cancel
        </SettingsActionButton>
      </div>
    </div>
  );
}

// ── Delete Button ──────────────────────────────────────────────────────

function DeleteButton({ agent, onDone }: { agent: Agent | null; onDone: () => void }) {
  const deleteMutation = useDeleteAgent();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-destructive">{error}</span>}
      <AlertDialogAction
        onClick={async (e) => {
          if (!agent) return;
          // Keep the dialog open so a 409 error can surface inline.
          e.preventDefault();
          setError(null);
          try {
            await deleteMutation.mutateAsync(agent.id);
            onDone();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to delete");
          }
        }}
        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
      >
        Delete
      </AlertDialogAction>
    </div>
  );
}

// ── Field ──────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

// ── Model catalog + select ─────────────────────────────────────────────
function ModelSelect({
  value,
  onChange,
  models,
}: {
  value: string;
  onChange: (id: string) => void;
  models: ModelCatalogEntry[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {models.map((m) => (
        <option key={m.id} value={m.id}>
          {m.label} ({m.providerLabel})
        </option>
      ))}
    </select>
  );
}

function ThinkingLevelChips({
  value,
  onChange,
  levels,
}: {
  value: ThinkingLevel;
  onChange: (value: ThinkingLevel) => void;
  levels: ThinkingLevel[];
}) {
  const options = levels.length > 0 ? levels : [value];
  return (
    <div className="flex min-h-7 flex-wrap items-center gap-1.5">
      {options.map((level) => (
        <Badge
          key={level}
          asChild
          variant="outline"
          className={cn(
            "h-6 cursor-pointer rounded-full px-2.5 text-[11px] font-medium leading-none transition-colors",
            level === value
              ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15"
              : "border-border/60 bg-muted/20 text-muted-foreground hover:border-border hover:bg-muted/40 hover:text-foreground",
          )}
        >
          <button
            type="button"
            aria-pressed={level === value}
            onClick={() => onChange(level)}
          >
            {thinkingLevelLabel(level)}
          </button>
        </Badge>
      ))}
    </div>
  );
}

function modelForId(models: ModelCatalogEntry[], modelId: string): ModelCatalogEntry | undefined {
  return models.find((model) => model.id === modelId);
}

function resolveThinkingLevel(
  model: ModelCatalogEntry | undefined,
  thinkingLevel: ThinkingLevel | undefined,
): ThinkingLevel | undefined {
  const levels = model?.capabilities.thinkingLevels;
  if (!levels) return thinkingLevel; // model not in catalog: keep as stored
  if (levels.length === 0) return undefined; // no thinking-level control (e.g. Kimi)
  if (thinkingLevel && levels.includes(thinkingLevel)) return thinkingLevel;
  return levels.includes("high") ? "high" : levels[0];
}

function thinkingLevelLabel(level: ThinkingLevel): string {
  return level === "xhigh"
    ? "Extra high"
    : level.charAt(0).toUpperCase() + level.slice(1);
}
