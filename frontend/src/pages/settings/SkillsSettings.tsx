import { useState } from "react";
import {
  AlertTriangle,
  FileCode2,
  Link2,
  Loader2,
  RefreshCw,
  Save,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SettingsHeader } from "@/components/AppLayout";
import { DiffView } from "@/components/diff/DiffView";
import {
  CompactSyncStatusIcon as CompactStatusIcon,
  ProviderBadge,
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
  useCreateSkill,
  useDeleteSkill,
  useSkill,
  useSkills,
  useSyncMissingSkills,
  useSyncSkill,
  useUpdateSkill,
} from "@/hooks/useSkills";
import { ApiError } from "@/hooks/useApi";
import { cn } from "@/lib/utils";
import type { SkillDetail, SkillProviderId, SkillSummary, SkillSyncStatus } from "@/types";

const SYNCABLE_STATUSES = new Set<SkillSyncStatus>(["claude_only", "codex_only", "synced"]);
const DEFAULT_SKILL_TEMPLATE = `---
name: new-skill
description: Describe when this skill should be used.
---

# New Skill

## Instructions

Describe the workflow, rules, and context this skill should provide.
`;
const SKILL_EDITOR_PLACEHOLDER = "---\nname: my-skill\ndescription: When to use this skill\n---\n\n# My Skill";

type SkillSelection = SettingsResourceSelection;

interface NewSkillDraft {
  content: string;
  initialContent: string;
  error: string | null;
  conflictContent: string | null;
}

export default function SkillsSettings() {
  const { data, isLoading, isError } = useSkills();
  const syncMissingMutation = useSyncMissingSkills();
  const skills = data?.skills ?? [];
  const [selection, setSelection] = useState<SkillSelection>(null);
  const [draftSkill, setDraftSkill] = useState<NewSkillDraft | null>(null);
  const resolvedSelection = resolveSettingsResourceSelection(selection, skills, draftSkill !== null);

  const syncableCount = skills.filter((skill) => SYNCABLE_STATUSES.has(skill.syncStatus)).length;
  const selectedExistingId = resolvedSelection?.kind === "existing" ? resolvedSelection.id : null;

  const handleNewSkill = () => {
    setDraftSkill((current) =>
      current ?? {
        content: DEFAULT_SKILL_TEMPLATE,
        initialContent: DEFAULT_SKILL_TEMPLATE,
        error: null,
        conflictContent: null,
      },
    );
    setSelection({ kind: "draft" });
  };

  const handleDraftChange = (content: string) => {
    setDraftSkill((current) => {
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

  const handleDraftError = (message: string, conflict: boolean) => {
    setDraftSkill((current) => {
      if (!current) return current;
      return {
        ...current,
        error: message,
        conflictContent: conflict ? current.content : null,
      };
    });
  };

  const handleDraftDiscard = () => {
    setDraftSkill(null);
    setSelection(skills[0] ? { kind: "existing", id: skills[0].id } : null);
  };

  const handleDraftCreated = (id: string) => {
    setDraftSkill(null);
    setSelection({ kind: "existing", id });
  };

  const handleSkillDeleted = (id: string) => {
    setSelection((current) => {
      if (current?.kind !== "existing" || current.id !== id) return current;
      const nextSkill = skills.find((skill) => skill.id !== id);
      if (nextSkill) return { kind: "existing", id: nextSkill.id };
      return draftSkill ? { kind: "draft" } : null;
    });
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <SettingsHeader>
        <h1 className="text-sm font-medium">Skills</h1>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => void syncMissingMutation.mutateAsync()}
          disabled={syncableCount === 0 || syncMissingMutation.isPending}
          className={cn(
            "inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-muted-foreground transition-colors outline-none hover:bg-muted/40 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50",
            (syncableCount === 0 || syncMissingMutation.isPending) && "pointer-events-none opacity-50",
          )}
        >
          {syncMissingMutation.isPending ? (
            <Loader2 aria-hidden="true" className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw aria-hidden="true" className="h-3 w-3" />
          )}
          Sync pending{syncableCount > 0 ? ` (${syncableCount})` : ""}
        </button>
      </SettingsHeader>

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-xs text-muted-foreground">
          <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
          Loading skills…
        </div>
      ) : isError ? (
        <div className="flex flex-1 items-center justify-center text-xs text-red-400">
          Could not load skills.
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden max-md:flex-col">
          <SkillsList
            skills={skills}
            draftSkill={draftSkill}
            selection={resolvedSelection}
            onSelect={(id) => setSelection({ kind: "existing", id })}
            onSelectDraft={() => setSelection({ kind: "draft" })}
            onNewSkill={handleNewSkill}
          />
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            {selectedExistingId ? (
              <SkillDetailPanel
                id={selectedExistingId}
                onSelectedIdChange={(id) => setSelection({ kind: "existing", id })}
                onDeleted={handleSkillDeleted}
              />
            ) : resolvedSelection?.kind === "draft" && draftSkill ? (
              <NewSkillDetailPanel
                draft={draftSkill}
                onChange={handleDraftChange}
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

function SkillsList({
  skills,
  draftSkill,
  selection,
  onSelect,
  onSelectDraft,
  onNewSkill,
}: {
  skills: SkillSummary[];
  draftSkill: NewSkillDraft | null;
  selection: SkillSelection;
  onSelect: (id: string) => void;
  onSelectDraft: () => void;
  onNewSkill: () => void;
}) {
  return (
    <SettingsResourceList
      showEmpty={skills.length === 0 && !draftSkill}
      empty={<SettingsResourceEmptyList>No global skills found.</SettingsResourceEmptyList>}
      actionLabel="New Skill"
      actionActive={selection?.kind === "draft"}
      onAction={onNewSkill}
    >
      {draftSkill && (
        <SettingsResourceListItem
          icon={<FileCode2 className="h-3.5 w-3.5" />}
          title="New Skill"
          description="Local draft"
          ariaLabel="New Skill draft"
          trailing={
            <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[10px]">
              Unsaved
            </Badge>
          }
          selected={selection?.kind === "draft"}
          onClick={onSelectDraft}
        />
      )}
      {skills.map((skill) => (
        <SettingsResourceListItem
          key={skill.id}
          icon={<FileCode2 className="h-3.5 w-3.5" />}
          title={skill.name}
          description={skill.description}
          ariaLabel={`${skill.name} skill`}
          trailing={<CompactStatusIcon status={skill.syncStatus} />}
          selected={selection?.kind === "existing" && skill.id === selection.id}
          onClick={() => onSelect(skill.id)}
        />
      ))}
    </SettingsResourceList>
  );
}

function SkillDetailPanel({
  id,
  onSelectedIdChange,
  onDeleted,
}: {
  id: string;
  onSelectedIdChange: (id: string) => void;
  onDeleted: (id: string) => void;
}) {
  const { data, isLoading, isError } = useSkill(id);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
        <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
        Loading skill…
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-red-400">
        Could not load this skill.
      </div>
    );
  }

  return (
    <LoadedSkillDetailPanel
      key={data.id}
      data={data}
      onSelectedIdChange={onSelectedIdChange}
      onDeleted={onDeleted}
    />
  );
}

function LoadedSkillDetailPanel({
  data,
  onSelectedIdChange,
  onDeleted,
}: {
  data: SkillDetail;
  onSelectedIdChange: (id: string) => void;
  onDeleted: (id: string) => void;
}) {
  const updateMutation = useUpdateSkill();
  const syncMutation = useSyncSkill();
  const deleteMutation = useDeleteSkill();
  const [draft, setDraft] = useState(data.content);
  const [error, setError] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const isDirty = draft !== data.content;
  const canSync = SYNCABLE_STATUSES.has(data.syncStatus);

  const handleSave = async () => {
    if (!draft.trim()) return;
    setError(null);
    try {
      const saved = await updateMutation.mutateAsync({ id: data.id, content: draft });
      onSelectedIdChange(saved.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save skill");
    }
  };

  const handleSync = async () => {
    setError(null);
    try {
      const synced = await syncMutation.mutateAsync(data.id);
      onSelectedIdChange(synced.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to sync skill");
    }
  };

  const handleDelete = async () => {
    setError(null);
    try {
      await deleteMutation.mutateAsync(data.id);
      setShowDeleteConfirm(false);
      onDeleted(data.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete skill");
    }
  };

  return (
    <>
      <SettingsEditorFrame
        title={data.name}
        badge={<StatusBadge status={data.syncStatus} />}
        description={data.description}
        providers={
          <>
            <ProviderBadge label="Claude" state={data.providers.claude} />
            <ProviderBadge label="Codex" state={data.providers.codex} />
          </>
        }
        banner={
          <SkillBanner
            data={data}
            onViewDiff={() => setShowDiff(true)}
            onUseProvider={(provider) => {
              const content = data.providerContents[provider];
              if (content !== undefined) setDraft(content);
            }}
          />
        }
        value={draft}
        onChange={setDraft}
        placeholder={SKILL_EDITOR_PLACEHOLDER}
        ariaLabel={`${data.name} SKILL.md`}
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
            {canSync && (
              <EditorActionButton
                onClick={() => void handleSync()}
                disabled={syncMutation.isPending}
                pending={syncMutation.isPending}
                icon={<RefreshCw className="h-3 w-3" />}
              >
                Sync
              </EditorActionButton>
            )}
            <EditorActionButton
              variant="danger"
              onClick={() => setShowDeleteConfirm(true)}
              disabled={deleteMutation.isPending}
              pending={deleteMutation.isPending}
              icon={<Trash2 className="h-3 w-3" />}
            >
              Delete
            </EditorActionButton>
            {error && (
              <span role="alert" className="text-xs text-red-400">
                {error}
              </span>
            )}
          </>
        }
      />

      <SkillDiffDialog
        data={data}
        open={showDiff}
        onOpenChange={setShowDiff}
      />

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete skill</AlertDialogTitle>
            <AlertDialogDescription>
              Delete &ldquo;{data.name}&rdquo; from Claude and Codex? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleDelete()}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {deleteMutation.isPending ? <Loader2 aria-hidden="true" className="h-3 w-3 animate-spin" /> : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function NewSkillDetailPanel({
  draft,
  onChange,
  onCreated,
  onDiscard,
  onError,
}: {
  draft: NewSkillDraft;
  onChange: (content: string) => void;
  onCreated: (id: string) => void;
  onDiscard: () => void;
  onError: (message: string, conflict: boolean) => void;
}) {
  const createMutation = useCreateSkill();
  const isDirty = draft.content !== draft.initialContent;
  const hasConflict = draft.conflictContent === draft.content;
  const canSave = isDirty && Boolean(draft.content.trim()) && !hasConflict && !createMutation.isPending;

  const handleSave = async () => {
    if (!canSave) return;
    try {
      const created = await createMutation.mutateAsync({ content: draft.content });
      onCreated(created.id);
    } catch (err) {
      const conflict = err instanceof ApiError && err.status === 409;
      onError(
        conflict
          ? "Skill already exists"
          : err instanceof Error
            ? err.message
            : "Failed to create skill",
        conflict,
      );
    }
  };

  return (
    <SettingsEditorFrame
      title="New Skill"
      badge={
        <Badge variant="secondary" className="text-[10px] bg-primary/10 text-primary">
          Unsaved
        </Badge>
      }
      description="Local draft"
      value={draft.content}
      onChange={onChange}
      placeholder={SKILL_EDITOR_PLACEHOLDER}
      ariaLabel="New skill SKILL.md"
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
        </>
      }
    />
  );
}

function SkillBanner({
  data,
  onViewDiff,
  onUseProvider,
}: {
  data: SkillDetail;
  onViewDiff: () => void;
  onUseProvider: (provider: SkillProviderId) => void;
}) {
  if (data.syncStatus === "linked") return null;

  if (data.syncStatus === "invalid") {
    return (
      <Banner tone="danger" icon={<XCircle className="h-3.5 w-3.5" />}>
        {data.invalidReason ?? "This skill could not be read."}
      </Banner>
    );
  }

  if (data.syncStatus === "diverged") {
    return (
      <Banner tone="warning" icon={<AlertTriangle className="h-3.5 w-3.5" />}>
        <span className="min-w-0 flex-1">
          Claude and Codex copies differ. The editor is using the canonical Codex copy.
        </span>
        {data.providerContents.claude && (
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={onViewDiff}
              className="cursor-pointer rounded-md px-2 py-0.5 text-[11px] font-medium text-amber-200 transition-colors outline-none hover:bg-amber-500/15 focus-visible:ring-[3px] focus-visible:ring-amber-300/40"
            >
              View diff
            </button>
            <button
              type="button"
              onClick={() => onUseProvider("claude")}
              className="cursor-pointer rounded-md px-2 py-0.5 text-[11px] font-medium text-amber-200 transition-colors outline-none hover:bg-amber-500/15 focus-visible:ring-[3px] focus-visible:ring-amber-300/40"
            >
              Use Claude copy
            </button>
          </div>
        )}
      </Banner>
    );
  }

  if (data.syncStatus === "claude_only") {
    return (
      <Banner tone="warning" icon={<AlertTriangle className="h-3.5 w-3.5" />}>
        This skill exists only in Claude. Saving or syncing will move it into `.agents/skills` and replace the Claude folder with a symlink.
      </Banner>
    );
  }

  if (data.syncStatus === "codex_only") {
    return (
      <Banner tone="info" icon={<Link2 className="h-3.5 w-3.5" />}>
        This skill exists only in Codex. Saving or syncing will add a Claude symlink to the canonical `.agents/skills` folder.
      </Banner>
    );
  }

  if (data.syncStatus === "synced" && data.providers.claude.present && !data.providers.claude.isSymlink) {
    return (
      <Banner tone="info" icon={<Link2 className="h-3.5 w-3.5" />}>
        Both copies match. Saving will keep `.agents/skills` as the source and replace the Claude copy with a symlink.
      </Banner>
    );
  }

  return null;
}

function SkillDiffDialog({
  data,
  open,
  onOpenChange,
}: {
  data: SkillDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const claudeContent = data.providerContents.claude ?? "";
  const codexContent = data.providerContents.codex ?? "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-hidden sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Skill diff</DialogTitle>
          <DialogDescription>
            Claude is shown as removed lines, Codex canonical content as added lines.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0">
          <div className="mb-2 flex items-center gap-3 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-red-400" />
              Claude
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-green-400" />
              Codex
            </span>
          </div>
          <DiffView
            oldText={claudeContent}
            newText={codexContent}
            filePath="SKILL.md"
            className="text-xs"
            scrollClassName="max-h-[60vh]"
          />
        </div>
        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}

function EmptyState() {
  return (
    <SettingsEmptySelection>Select a skill to edit</SettingsEmptySelection>
  );
}
