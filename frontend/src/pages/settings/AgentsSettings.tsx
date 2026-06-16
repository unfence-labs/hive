import { useState, useMemo } from "react";
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
import { Input } from "@/components/ui/input";
import { SettingsHeader } from "@/components/AppLayout";
import { SettingsActionButton } from "@/components/settings/ProviderSync";
import {
  SettingsEmptySelection,
  SettingsResourceEmptyList,
  SettingsResourceList,
  SettingsResourceListItem,
} from "@/components/settings/SettingsResourceList";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/hooks/useApi";
import {
  useAgents,
  useCreateAgent,
  useUpdateAgent,
  useDeleteAgent,
} from "@/hooks/useAgents";
import type { Agent, ModelCatalogEntry, ModelCatalogResponse } from "@/types";

// ── Types ──────────────────────────────────────────────────────────────

type Selection =
  | { kind: "agent"; id: string }
  | { kind: "create" }
  | null;

// ── Main page ──────────────────────────────────────────────────────────

export default function AgentsSettings() {
  const { data: agents, isLoading } = useAgents();
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
    <div className="flex h-full flex-col overflow-hidden">
      <SettingsHeader>
        <h1 className="text-sm font-medium">Task Agents</h1>
      </SettingsHeader>

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
  onDelete,
  onCreated,
  onCancel,
}: {
  selection: Selection;
  selectedAgent: Agent | null;
  onDelete: (a: Agent) => void;
  onCreated: (id: string) => void;
  onCancel: () => void;
}) {
  if (selection?.kind === "agent" && selectedAgent) {
    return (
      <AgentDetail
        key={selectedAgent.id}
        agent={selectedAgent}
        onDelete={() => onDelete(selectedAgent)}
      />
    );
  }

  if (selection?.kind === "create") {
    return <CreateAgentForm onCreated={onCreated} onCancel={onCancel} />;
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
  injectGitContext,
  setInjectGitContext,
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
  injectGitContext: boolean;
  setInjectGitContext: (v: boolean) => void;
  readOnly: boolean;
  setReadOnly: (v: boolean) => void;
}) {
  const { data: catalog } = useModelCatalog();
  const models = catalog?.models ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
      {/* Name */}
      <Field label="Name">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Code Auditor"
          className="text-sm"
        />
      </Field>

      {/* Description */}
      <Field label="Description (optional)">
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Short summary shown in the list"
          className="text-sm"
        />
      </Field>

      {/* Model */}
      <Field label="Model">
        <ModelSelect value={modelId} onChange={setModelId} models={models} />
      </Field>

      {/* System prompt */}
      <Field label="System Prompt">
        <textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          placeholder="You are a code auditor..."
          rows={10}
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </Field>

      {/* Flags */}
      <div className="space-y-2">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={injectGitContext}
            onChange={(e) => setInjectGitContext(e.target.checked)}
            className="rounded border-border"
          />
          Inject git context
        </label>
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
  onDelete,
}: {
  agent: Agent;
  onDelete: () => void;
}) {
  const updateMutation = useUpdateAgent();
  const [name, setName] = useState(agent.name);
  const [description, setDescription] = useState(agent.description ?? "");
  const [systemPrompt, setSystemPrompt] = useState(agent.systemPrompt);
  const [modelId, setModelId] = useState(agent.modelId);
  const [injectGitContext, setInjectGitContext] = useState(agent.injectGitContext);
  const [readOnly, setReadOnly] = useState(agent.readOnly);

  const isDirty =
    name !== agent.name ||
    description !== (agent.description ?? "") ||
    systemPrompt !== agent.systemPrompt ||
    modelId !== agent.modelId ||
    injectGitContext !== agent.injectGitContext ||
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
      injectGitContext,
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
        injectGitContext={injectGitContext}
        setInjectGitContext={setInjectGitContext}
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
  onCreated,
  onCancel,
}: {
  onCreated: (id: string) => void;
  onCancel: () => void;
}) {
  const createMutation = useCreateAgent();
  const { data: catalog } = useModelCatalog();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [modelId, setModelId] = useState("");
  const [injectGitContext, setInjectGitContext] = useState(true);
  const [readOnly, setReadOnly] = useState(false);

  // Default the model to the catalog default once it loads.
  const resolvedModelId = modelId || catalog?.defaultModelId || "";

  const isValid = name.trim() && systemPrompt.trim() && resolvedModelId;

  const handleSubmit = async () => {
    if (!isValid) return;
    const result = await createMutation.mutateAsync({
      name: name.trim(),
      ...(description.trim() && { description: description.trim() }),
      systemPrompt: systemPrompt.trim(),
      modelId: resolvedModelId,
      injectGitContext,
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
        injectGitContext={injectGitContext}
        setInjectGitContext={setInjectGitContext}
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
      {error && <span className="text-xs text-red-500">{error}</span>}
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
        className="bg-red-600 text-white hover:bg-red-700"
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
// Local to this page: it is the only place that picks a model now that the
// automation dialog selects an agent (which owns its model) instead.

function useModelCatalog() {
  return useQuery({
    queryKey: ["models"],
    queryFn: () => api.get<ModelCatalogResponse>("/api/models"),
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
  });
}

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
