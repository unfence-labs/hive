import { useState } from "react";
import {
  AlertTriangle,
  Bot,
  FileCode2,
  Loader2,
  Plus,
  Save,
  Sparkles,
  Trash2,
  X,
  XCircle,
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
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SettingsHeader } from "@/components/AppLayout";
import {
  CompactSyncStatusIcon as CompactStatusIcon,
  ProviderBadge,
  ProviderMiniBadge,
  SettingsActionButton as EditorActionButton,
  SettingsBanner as Banner,
  SyncStatusBadge as StatusBadge,
} from "@/components/settings/ProviderSync";
import { SettingsEditorFrame } from "@/components/settings/SettingsEditorFrame";
import {
  useCreateCustomAgent,
  useCreateCustomAgentCounterpart,
  useCustomAgent,
  useCustomAgents,
  useDeleteCustomAgentProvider,
  useUpdateCustomAgentProvider,
} from "@/hooks/useCustomAgents";
import { ApiError } from "@/hooks/useApi";
import { cn } from "@/lib/utils";
import type {
  CustomAgentDetail,
  CustomAgentProviderId,
  CustomAgentSummary,
} from "@/types";

const PROVIDERS: CustomAgentProviderId[] = ["claude", "codex"];
const PROVIDER_LABELS: Record<CustomAgentProviderId, string> = {
  claude: "Claude",
  codex: "Codex",
};

const DEFAULT_CLAUDE_AGENT = `---
name: new-agent
description: Describe when this agent should be used.
---

# New Agent

Describe this agent's role, workflow, and constraints.
`;

const DEFAULT_CODEX_AGENT = `name = "new-agent"
description = "Describe when this agent should be used."
developer_instructions = """
Describe this agent's role, workflow, and constraints.
"""
`;

const PLACEHOLDERS: Record<CustomAgentProviderId, string> = {
  claude: "---\nname: reviewer\ndescription: Reviews changes\n---\n\n# Reviewer",
  codex: "name = \"reviewer\"\ndescription = \"Reviews changes\"\ndeveloper_instructions = \"Review code changes.\"",
};

type AgentSelection = { kind: "existing"; id: string } | { kind: "draft" } | null;

interface NewAgentDraft {
  provider: CustomAgentProviderId;
  content: string;
  initialContent: string;
  error: string | null;
  conflictContent: string | null;
}

export default function CustomAgentsSettings() {
  const { data, isLoading, isError } = useCustomAgents();
  const agents = data?.agents ?? [];
  const [selection, setSelection] = useState<AgentSelection>(null);
  const [draftAgent, setDraftAgent] = useState<NewAgentDraft | null>(null);
  const resolvedSelection = resolveAgentSelection(selection, agents, draftAgent !== null);
  const selectedExistingId = resolvedSelection?.kind === "existing" ? resolvedSelection.id : null;

  const handleNewAgent = () => {
    setDraftAgent((current) =>
      current ?? {
        provider: "claude",
        content: DEFAULT_CLAUDE_AGENT,
        initialContent: DEFAULT_CLAUDE_AGENT,
        error: null,
        conflictContent: null,
      },
    );
    setSelection({ kind: "draft" });
  };

  const handleDraftChange = (content: string) => {
    setDraftAgent((current) => {
      if (!current) return current;
      const conflictContent = current.conflictContent === content ? current.conflictContent : null;
      return {
        ...current,
        content,
        conflictContent,
        error: conflictContent ? current.error : null,
      };
    });
  };

  const handleDraftProviderChange = (provider: CustomAgentProviderId) => {
    setDraftAgent((current) => {
      const nextContent = provider === "claude" ? DEFAULT_CLAUDE_AGENT : DEFAULT_CODEX_AGENT;
      if (!current) {
        return {
          provider,
          content: nextContent,
          initialContent: nextContent,
          error: null,
          conflictContent: null,
        };
      }
      return {
        provider,
        content: current.content === current.initialContent ? nextContent : current.content,
        initialContent: nextContent,
        error: null,
        conflictContent: null,
      };
    });
  };

  const handleDraftError = (message: string, conflict: boolean) => {
    setDraftAgent((current) => {
      if (!current) return current;
      return {
        ...current,
        error: message,
        conflictContent: conflict ? current.content : null,
      };
    });
  };

  const handleDraftDiscard = () => {
    setDraftAgent(null);
    setSelection(agents[0] ? { kind: "existing", id: agents[0].id } : null);
  };

  const handleDraftCreated = (id: string) => {
    setDraftAgent(null);
    setSelection({ kind: "existing", id });
  };

  const handleProviderDeleted = (id: string, provider: CustomAgentProviderId) => {
    setSelection((current) => {
      if (current?.kind !== "existing" || current.id !== id) return current;
      const deletedAgent = agents.find((agent) => agent.id === id);
      const otherProvider: CustomAgentProviderId = provider === "claude" ? "codex" : "claude";
      if (deletedAgent?.providers[otherProvider].present) return current;
      const nextAgent = agents.find((agent) => agent.id !== id);
      if (nextAgent) return { kind: "existing", id: nextAgent.id };
      return draftAgent ? { kind: "draft" } : null;
    });
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <SettingsHeader>
        <h1 className="text-sm font-medium">Custom Agents</h1>
      </SettingsHeader>

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading custom agents
        </div>
      ) : isError ? (
        <div className="flex flex-1 items-center justify-center text-xs text-red-400">
          Could not load custom agents.
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          <CustomAgentsList
            agents={agents}
            draftAgent={draftAgent}
            selection={resolvedSelection}
            onSelect={(id) => setSelection({ kind: "existing", id })}
            onSelectDraft={() => setSelection({ kind: "draft" })}
            onNewAgent={handleNewAgent}
          />
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            {selectedExistingId ? (
              <CustomAgentDetailPanel
                id={selectedExistingId}
                onSelectedIdChange={(id) => setSelection({ kind: "existing", id })}
                onProviderDeleted={handleProviderDeleted}
              />
            ) : resolvedSelection?.kind === "draft" && draftAgent ? (
              <NewCustomAgentPanel
                draft={draftAgent}
                onChange={handleDraftChange}
                onProviderChange={handleDraftProviderChange}
                onCreated={handleDraftCreated}
                onDiscard={handleDraftDiscard}
                onError={handleDraftError}
              />
            ) : (
              <EmptyState />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function resolveAgentSelection(
  selection: AgentSelection,
  agents: CustomAgentSummary[],
  hasDraft: boolean,
): AgentSelection {
  if (selection?.kind === "draft") return hasDraft ? selection : null;
  if (selection?.kind === "existing" && agents.some((agent) => agent.id === selection.id)) {
    return selection;
  }
  if (agents[0]) return { kind: "existing", id: agents[0].id };
  return hasDraft ? { kind: "draft" } : null;
}

function CustomAgentsList({
  agents,
  draftAgent,
  selection,
  onSelect,
  onSelectDraft,
  onNewAgent,
}: {
  agents: CustomAgentSummary[];
  draftAgent: NewAgentDraft | null;
  selection: AgentSelection;
  onSelect: (id: string) => void;
  onSelectDraft: () => void;
  onNewAgent: () => void;
}) {
  return (
    <div className="flex w-64 shrink-0 flex-col border-r border-border/50">
      <ScrollArea className="flex-1">
        <div className="p-2">
          {draftAgent && (
            <DraftAgentListItem
              provider={draftAgent.provider}
              selected={selection?.kind === "draft"}
              onClick={onSelectDraft}
            />
          )}
          {agents.length === 0 && !draftAgent ? (
            <div className="px-2 py-8 text-center text-xs text-muted-foreground">
              No global custom agents found.
            </div>
          ) : (
            agents.map((agent) => (
              <CustomAgentListItem
                key={agent.id}
                agent={agent}
                selected={selection?.kind === "existing" && agent.id === selection.id}
                onClick={() => onSelect(agent.id)}
              />
            ))
          )}
        </div>
      </ScrollArea>
      <div className="border-t border-border/30 p-2">
        <button
          type="button"
          onClick={onNewAgent}
          className={cn(
            "inline-flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-md border border-dashed border-primary/40 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:border-primary hover:bg-primary/10",
            selection?.kind === "draft" && "border-primary bg-primary/10",
          )}
        >
          <Plus className="h-3 w-3" />
          New Agent
        </button>
      </div>
    </div>
  );
}

function DraftAgentListItem({
  provider,
  selected,
  onClick,
}: {
  provider: CustomAgentProviderId;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "mb-1 flex w-full cursor-pointer flex-col gap-1.5 rounded-md px-2 py-2 text-left text-sm transition-colors",
        selected
          ? "bg-primary/15 text-foreground"
          : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <Bot className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate font-medium">New Agent</span>
        <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[10px]">
          Unsaved
        </Badge>
      </div>
      <p className="text-xs leading-snug text-muted-foreground">
        {PROVIDER_LABELS[provider]} draft
      </p>
    </button>
  );
}

function CustomAgentListItem({
  agent,
  selected,
  onClick,
}: {
  agent: CustomAgentSummary;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "mb-1 flex w-full cursor-pointer flex-col gap-1.5 rounded-md px-2 py-2 text-left text-sm transition-colors",
        selected
          ? "bg-primary/15 text-foreground"
          : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <Bot className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate font-medium">{agent.name}</span>
        <CompactStatusIcon status={agent.status} />
      </div>
      {agent.description && (
        <p className="line-clamp-2 text-xs leading-snug text-muted-foreground">
          {agent.description}
        </p>
      )}
      <div className="flex flex-wrap gap-1">
        <ProviderMiniBadge label="Claude" present={agent.providers.claude.present} />
        <ProviderMiniBadge label="Codex" present={agent.providers.codex.present} />
      </div>
    </button>
  );
}

function CustomAgentDetailPanel({
  id,
  onSelectedIdChange,
  onProviderDeleted,
}: {
  id: string;
  onSelectedIdChange: (id: string) => void;
  onProviderDeleted: (id: string, provider: CustomAgentProviderId) => void;
}) {
  const { data, isLoading, isError } = useCustomAgent(id);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading custom agent
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-red-400">
        Could not load this custom agent.
      </div>
    );
  }

  return (
    <LoadedCustomAgentDetailPanel
      key={data.id}
      data={data}
      onSelectedIdChange={onSelectedIdChange}
      onProviderDeleted={onProviderDeleted}
    />
  );
}

function LoadedCustomAgentDetailPanel({
  data,
  onSelectedIdChange,
  onProviderDeleted,
}: {
  data: CustomAgentDetail;
  onSelectedIdChange: (id: string) => void;
  onProviderDeleted: (id: string, provider: CustomAgentProviderId) => void;
}) {
  const defaultProvider = data.providers.claude.present ? "claude" : "codex";
  const [activeProvider, setActiveProvider] = useState<CustomAgentProviderId>(defaultProvider);
  const providerState = data.providers[activeProvider];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-border/30 px-5 pt-4">
        {PROVIDERS.map((provider) => (
          <button
            key={provider}
            type="button"
            onClick={() => setActiveProvider(provider)}
            className={cn(
              "inline-flex cursor-pointer items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors",
              activeProvider === provider
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {PROVIDER_LABELS[provider]}
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                data.providers[provider].present ? "bg-emerald-400" : "bg-muted-foreground/40",
              )}
            />
          </button>
        ))}
      </div>

      {providerState.present ? (
        <CustomAgentProviderEditor
          key={`${data.id}:${activeProvider}:${providerState.hash ?? "no-hash"}`}
          data={data}
          provider={activeProvider}
          onSelectedIdChange={onSelectedIdChange}
          onProviderDeleted={onProviderDeleted}
        />
      ) : (
        <MissingProviderPanel
          data={data}
          provider={activeProvider}
          onSelectedIdChange={onSelectedIdChange}
        />
      )}
    </div>
  );
}

function CustomAgentProviderEditor({
  data,
  provider,
  onSelectedIdChange,
  onProviderDeleted,
}: {
  data: CustomAgentDetail;
  provider: CustomAgentProviderId;
  onSelectedIdChange: (id: string) => void;
  onProviderDeleted: (id: string, provider: CustomAgentProviderId) => void;
}) {
  const updateMutation = useUpdateCustomAgentProvider();
  const deleteMutation = useDeleteCustomAgentProvider();
  const [draft, setDraft] = useState(data.contents[provider] ?? "");
  const [error, setError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const isDirty = draft !== (data.contents[provider] ?? "");

  const handleSave = async () => {
    if (!draft.trim()) return;
    setError(null);
    try {
      const saved = await updateMutation.mutateAsync({ id: data.id, provider, content: draft });
      onSelectedIdChange(saved.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save custom agent");
    }
  };

  const handleDelete = async () => {
    setError(null);
    try {
      await deleteMutation.mutateAsync({ id: data.id, provider });
      setShowDeleteConfirm(false);
      onProviderDeleted(data.id, provider);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete custom agent");
    }
  };

  return (
    <>
      <SettingsEditorFrame
        title={data.name}
        badge={<StatusBadge status={data.status} />}
        description={data.description}
        providers={
          <>
            <ProviderBadge label="Claude" state={data.providers.claude} />
            <ProviderBadge label="Codex" state={data.providers.codex} />
          </>
        }
        banner={<CustomAgentBanner data={data} provider={provider} />}
        value={draft}
        onChange={setDraft}
        language={provider === "codex" ? "toml" : "markdown"}
        placeholder={PLACEHOLDERS[provider]}
        ariaLabel={`${data.name} ${PROVIDER_LABELS[provider]} custom agent`}
        actions={
          <>
            <EditorActionButton
              variant="primary"
              onClick={() => void handleSave()}
              disabled={!isDirty || !draft.trim() || updateMutation.isPending}
              pending={updateMutation.isPending}
              icon={<Save className="h-3 w-3" />}
            >
              Save
            </EditorActionButton>
            <EditorActionButton
              variant="danger"
              onClick={() => setShowDeleteConfirm(true)}
              disabled={deleteMutation.isPending}
              pending={deleteMutation.isPending}
              icon={<Trash2 className="h-3 w-3" />}
            >
              Delete {PROVIDER_LABELS[provider]}
            </EditorActionButton>
            {error && (
              <span role="alert" className="text-xs text-red-400">
                {error}
              </span>
            )}
          </>
        }
      />

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete custom agent</AlertDialogTitle>
            <AlertDialogDescription>
              Delete the {PROVIDER_LABELS[provider]} version of &ldquo;{data.name}&rdquo;? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleDelete()}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {deleteMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function MissingProviderPanel({
  data,
  provider,
  onSelectedIdChange,
}: {
  data: CustomAgentDetail;
  provider: CustomAgentProviderId;
  onSelectedIdChange: (id: string) => void;
}) {
  const counterpartMutation = useCreateCustomAgentCounterpart();
  const [error, setError] = useState<string | null>(null);
  const sourceProvider: CustomAgentProviderId = provider === "claude" ? "codex" : "claude";
  const canCreate = data.providers[sourceProvider].present;

  const handleCreateCounterpart = async () => {
    if (!canCreate) return;
    setError(null);
    try {
      const created = await counterpartMutation.mutateAsync({ id: data.id, provider });
      onSelectedIdChange(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create counterpart");
    }
  };

  return (
    <div className="flex h-full flex-col px-5 pt-5 pb-2">
      <div className="mb-4">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-medium text-foreground">{data.name}</h2>
          <StatusBadge status={data.status} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <ProviderBadge label="Claude" state={data.providers.claude} />
          <ProviderBadge label="Codex" state={data.providers.codex} />
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center">
        <div className="max-w-sm text-center">
          <FileCode2 className="mx-auto mb-3 h-8 w-8 text-muted-foreground/60" />
          <h3 className="text-sm font-medium text-foreground">
            No {PROVIDER_LABELS[provider]} version
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Create a provider-native counterpart from the existing {PROVIDER_LABELS[sourceProvider]} agent.
          </p>
          <button
            type="button"
            onClick={() => void handleCreateCounterpart()}
            disabled={!canCreate || counterpartMutation.isPending}
            className={cn(
              "mt-4 inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90",
              (!canCreate || counterpartMutation.isPending) && "pointer-events-none opacity-60",
            )}
          >
            {counterpartMutation.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className="h-3 w-3" />
            )}
            Create {PROVIDER_LABELS[provider]} version
          </button>
          {error && (
            <p role="alert" className="mt-3 text-xs text-red-400">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function NewCustomAgentPanel({
  draft,
  onChange,
  onProviderChange,
  onCreated,
  onDiscard,
  onError,
}: {
  draft: NewAgentDraft;
  onChange: (content: string) => void;
  onProviderChange: (provider: CustomAgentProviderId) => void;
  onCreated: (id: string) => void;
  onDiscard: () => void;
  onError: (message: string, conflict: boolean) => void;
}) {
  const createMutation = useCreateCustomAgent();
  const isDirty = draft.content !== draft.initialContent;
  const hasConflict = draft.conflictContent === draft.content;
  const canSave = isDirty && Boolean(draft.content.trim()) && !hasConflict && !createMutation.isPending;

  const handleSave = async () => {
    if (!canSave) return;
    try {
      const created = await createMutation.mutateAsync({
        provider: draft.provider,
        content: draft.content,
      });
      onCreated(created.id);
    } catch (err) {
      const conflict = err instanceof ApiError && err.status === 409;
      onError(
        conflict
          ? "Custom agent already exists"
          : err instanceof Error
            ? err.message
            : "Failed to create custom agent",
        conflict,
      );
    }
  };

  return (
    <SettingsEditorFrame
      title="New Custom Agent"
      badge={
        <Badge variant="secondary" className="bg-primary/10 text-[10px] text-primary">
          Unsaved
        </Badge>
      }
      description={`${PROVIDER_LABELS[draft.provider]} global agent`}
      providers={
        <ProviderSelector
          value={draft.provider}
          onChange={onProviderChange}
        />
      }
      value={draft.content}
      onChange={onChange}
      language={draft.provider === "codex" ? "toml" : "markdown"}
      placeholder={PLACEHOLDERS[draft.provider]}
      ariaLabel="New custom agent"
      actions={
        <>
          <EditorActionButton
            variant="primary"
            onClick={() => void handleSave()}
            disabled={!canSave}
            pending={createMutation.isPending}
            icon={<Save className="h-3 w-3" />}
          >
            Save
          </EditorActionButton>
          <EditorActionButton
            onClick={onDiscard}
            icon={<X className="h-3 w-3" />}
          >
            Discard
          </EditorActionButton>
          {draft.error && (
            <span role="alert" className="text-xs text-red-400">
              {draft.error}
            </span>
          )}
          {!isDirty && (
            <span className="text-xs text-muted-foreground">
              Edit the template before saving.
            </span>
          )}
        </>
      }
    />
  );
}

function ProviderSelector({
  value,
  onChange,
}: {
  value: CustomAgentProviderId;
  onChange: (provider: CustomAgentProviderId) => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-border/50 p-0.5">
      {PROVIDERS.map((provider) => (
        <button
          key={provider}
          type="button"
          onClick={() => onChange(provider)}
          className={cn(
            "cursor-pointer rounded-sm px-2.5 py-1 text-[11px] font-medium transition-colors",
            value === provider
              ? "bg-primary/15 text-primary"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {PROVIDER_LABELS[provider]}
        </button>
      ))}
    </div>
  );
}

function CustomAgentBanner({
  data,
  provider,
}: {
  data: CustomAgentDetail;
  provider: CustomAgentProviderId;
}) {
  if (data.status === "invalid") {
    return (
      <Banner tone="danger" icon={<XCircle className="h-3.5 w-3.5" />}>
        {data.providers[provider].error ?? data.invalidReason ?? "This custom agent could not be read."}
      </Banner>
    );
  }

  if (data.status === "both") {
    return (
      <Banner tone="info" icon={<Bot className="h-3.5 w-3.5" />}>
        Claude and Codex use separate native files. Saving edits only the selected provider version.
      </Banner>
    );
  }

  return (
    <Banner tone="warning" icon={<AlertTriangle className="h-3.5 w-3.5" />}>
      This custom agent exists only in {PROVIDER_LABELS[provider]}. Use the other provider tab to create a counterpart.
    </Banner>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      Select a custom agent to edit
    </div>
  );
}
