import { useState } from "react";
import {
  AlertTriangle,
  Bot,
  FileCode2,
  Loader2,
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
import { SettingsHeader } from "@/components/AppLayout";
import { CenterCard } from "@/components/CenterCard";
import {
  CompactSyncStatusIcon as CompactStatusIcon,
  SettingsActionButton as EditorActionButton,
  SettingsBanner as Banner,
  SyncStatusBadge as StatusBadge,
} from "@/components/settings/ProviderSync";
import { SettingsEditorFrame } from "@/components/settings/SettingsEditorFrame";
import {
  SettingsEmptySelection,
  SettingsResourceEmptyList,
  SettingsResourceList,
  SettingsResourceListItem,
} from "@/components/settings/SettingsResourceList";
import {
  resolveSettingsResourceSelection,
  type SettingsResourceSelection,
} from "@/components/settings/resource-selection";
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

type AgentSelection = SettingsResourceSelection;

interface NewAgentDraft {
  provider: CustomAgentProviderId;
  content: string;
  initialContent: string;
  error: string | null;
  conflictContent: string | null;
}

export default function SubagentsSettings() {
  const { data, isLoading, isError } = useCustomAgents();
  const agents = data?.agents ?? [];
  const [selection, setSelection] = useState<AgentSelection>(null);
  const [draftAgent, setDraftAgent] = useState<NewAgentDraft | null>(null);
  const resolvedSelection = resolveSettingsResourceSelection(selection, agents, draftAgent !== null);
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
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <SettingsHeader>
        <h1 className="text-sm font-medium">Subagents</h1>
      </SettingsHeader>

      <CenterCard>
      {isLoading ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-xs text-muted-foreground">
          <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
          Loading subagents…
        </div>
      ) : isError ? (
        <div className="flex flex-1 items-center justify-center text-xs text-destructive">
          Could not load subagents.
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden max-md:flex-col">
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
      </CenterCard>
    </div>
  );
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
    <SettingsResourceList
      showEmpty={agents.length === 0 && !draftAgent}
      empty={<SettingsResourceEmptyList>No global subagents found.</SettingsResourceEmptyList>}
      actionLabel="New Agent"
      actionActive={selection?.kind === "draft"}
      onAction={onNewAgent}
    >
      {draftAgent && (
        <SettingsResourceListItem
          icon={<Bot className="h-3.5 w-3.5" />}
          title="New Agent"
          description={`${PROVIDER_LABELS[draftAgent.provider]} draft`}
          ariaLabel={`New ${PROVIDER_LABELS[draftAgent.provider]} agent draft`}
          trailing={
            <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[10px]">
              Unsaved
            </Badge>
          }
          selected={selection?.kind === "draft"}
          onClick={onSelectDraft}
        />
      )}
      {agents.map((agent) => (
        <SettingsResourceListItem
          key={agent.id}
          icon={<Bot className="h-3.5 w-3.5" />}
          title={agent.name}
          description={agent.description}
          ariaLabel={`${agent.name} subagent`}
          trailing={<CompactStatusIcon status={agent.status} />}
          selected={selection?.kind === "existing" && agent.id === selection.id}
          onClick={() => onSelect(agent.id)}
        />
      ))}
    </SettingsResourceList>
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
        <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
        Loading subagent…
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-destructive">
        Could not load this subagent.
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
      <div
        className="flex shrink-0 items-center gap-1 border-b border-border/30 px-5 pt-4"
        aria-label="Subagent provider"
      >
        {PROVIDERS.map((provider) => (
          <button
            key={provider}
            type="button"
            aria-pressed={activeProvider === provider}
            onClick={() => setActiveProvider(provider)}
            className={cn(
              "inline-flex cursor-pointer items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
              activeProvider === provider
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {PROVIDER_LABELS[provider]}
            <span
              aria-hidden="true"
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                data.providers[provider].present ? "bg-success" : "bg-muted-foreground/40",
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
      setError(err instanceof Error ? err.message : "Failed to save subagent");
    }
  };

  const handleDelete = async () => {
    setError(null);
    try {
      await deleteMutation.mutateAsync({ id: data.id, provider });
      setShowDeleteConfirm(false);
      onProviderDeleted(data.id, provider);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete subagent");
    }
  };

  return (
    <>
      <SettingsEditorFrame
        title={data.name}
        badge={<StatusBadge status={data.status} />}
        description={data.description}
        banner={<CustomAgentBanner data={data} provider={provider} />}
        value={draft}
        onChange={setDraft}
        language={provider === "codex" ? "toml" : "markdown"}
        placeholder={PLACEHOLDERS[provider]}
        ariaLabel={`${data.name} ${PROVIDER_LABELS[provider]} subagent`}
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
              <span role="alert" className="text-xs text-destructive">
                {error}
              </span>
            )}
          </>
        }
      />

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete subagent</AlertDialogTitle>
            <AlertDialogDescription>
              Delete the {PROVIDER_LABELS[provider]} version of &ldquo;{data.name}&rdquo;? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleDelete()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? <Loader2 aria-hidden="true" className="h-3 w-3 animate-spin" /> : "Delete"}
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
      </div>

      <div className="flex flex-1 items-center justify-center">
        <div className="max-w-sm text-center">
          <FileCode2 aria-hidden="true" className="mx-auto mb-3 h-8 w-8 text-muted-foreground/60" />
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
              "mt-4 inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors outline-none hover:bg-primary/90 focus-visible:ring-[3px] focus-visible:ring-ring/50",
              (!canCreate || counterpartMutation.isPending) && "pointer-events-none opacity-60",
            )}
          >
            {counterpartMutation.isPending ? (
              <Loader2 aria-hidden="true" className="h-3 w-3 animate-spin" />
            ) : (
              <Sparkles aria-hidden="true" className="h-3 w-3" />
            )}
            Create {PROVIDER_LABELS[provider]} version
          </button>
          {error && (
            <p role="alert" className="mt-3 text-xs text-destructive">
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
          ? "Subagent already exists"
          : err instanceof Error
            ? err.message
            : "Failed to create subagent",
        conflict,
      );
    }
  };

  return (
    <SettingsEditorFrame
      title="New Subagent"
      badge={
        <Badge variant="secondary" className="bg-primary/10 text-[10px] text-primary">
          Unsaved
        </Badge>
      }
      description={`${PROVIDER_LABELS[draft.provider]} global subagent`}
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
      ariaLabel="New subagent"
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
            <span role="alert" className="text-xs text-destructive">
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
          aria-pressed={value === provider}
          onClick={() => onChange(provider)}
          className={cn(
            "cursor-pointer rounded-sm px-2.5 py-1 text-[11px] font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
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
        {data.providers[provider].error ?? data.invalidReason ?? "This subagent could not be read."}
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
      This subagent exists only in {PROVIDER_LABELS[provider]}. Use the other provider tab to create a counterpart.
    </Banner>
  );
}

function EmptyState() {
  return (
    <SettingsEmptySelection>Select a subagent to edit</SettingsEmptySelection>
  );
}
