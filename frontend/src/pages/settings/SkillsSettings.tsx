import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileCode2,
  Link2,
  Loader2,
  RefreshCw,
  Save,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SettingsHeader } from "@/components/AppLayout";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import { DiffView } from "@/components/diff/DiffView";
import {
  useSkill,
  useSkills,
  useSyncMissingSkills,
  useSyncSkill,
  useUpdateSkill,
} from "@/hooks/useSkills";
import { cn } from "@/lib/utils";
import type { SkillDetail, SkillProviderId, SkillSummary, SkillSyncStatus } from "@/types";

const SYNCABLE_STATUSES = new Set<SkillSyncStatus>(["claude_only", "codex_only", "synced"]);

export default function SkillsSettings() {
  const { data, isLoading, isError } = useSkills();
  const syncMissingMutation = useSyncMissingSkills();
  const skills = useMemo(() => data?.skills ?? [], [data]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (skills.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !skills.some((skill) => skill.id === selectedId)) {
      setSelectedId(skills[0].id);
    }
  }, [selectedId, skills]);

  const syncableCount = skills.filter((skill) => SYNCABLE_STATUSES.has(skill.syncStatus)).length;

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
            "inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground",
            (syncableCount === 0 || syncMissingMutation.isPending) && "pointer-events-none opacity-50",
          )}
        >
          {syncMissingMutation.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          Sync pending{syncableCount > 0 ? ` (${syncableCount})` : ""}
        </button>
      </SettingsHeader>

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading skills
        </div>
      ) : isError ? (
        <div className="flex flex-1 items-center justify-center text-xs text-red-400">
          Could not load skills.
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          <SkillsList
            skills={skills}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            {selectedId ? (
              <SkillDetailPanel id={selectedId} onSelectedIdChange={setSelectedId} />
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
  selectedId,
  onSelect,
}: {
  skills: SkillSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex w-72 shrink-0 flex-col border-r border-border/50">
      <ScrollArea className="flex-1">
        <div className="p-2">
          {skills.length === 0 ? (
            <div className="px-2 py-8 text-center text-xs text-muted-foreground">
              No global skills found.
            </div>
          ) : (
            skills.map((skill) => (
              <SkillListItem
                key={skill.id}
                skill={skill}
                selected={skill.id === selectedId}
                onClick={() => onSelect(skill.id)}
              />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function SkillListItem({
  skill,
  selected,
  onClick,
}: {
  skill: SkillSummary;
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
        <FileCode2 className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate font-medium">{skill.name}</span>
        <CompactStatusIcon status={skill.syncStatus} />
      </div>
      {skill.description && (
        <p className="line-clamp-2 text-xs leading-snug text-muted-foreground">
          {skill.description}
        </p>
      )}
      <div className="flex flex-wrap gap-1">
        <ProviderMiniBadge label="Claude" present={skill.providers.claude.present} />
        <ProviderMiniBadge label="Codex" present={skill.providers.codex.present} />
      </div>
    </button>
  );
}

function SkillDetailPanel({
  id,
  onSelectedIdChange,
}: {
  id: string;
  onSelectedIdChange: (id: string) => void;
}) {
  const { data, isLoading, isError } = useSkill(id);
  const updateMutation = useUpdateSkill();
  const syncMutation = useSyncSkill();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(false);

  useEffect(() => {
    if (!data) return;
    setDraft(data.content);
    setError(null);
  }, [data?.id, data?.content, data]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading skill
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

  return (
    <div className="flex h-full flex-col overflow-hidden px-5 pt-5 pb-2">
      <div className="mb-4 shrink-0">
        <div className="flex items-center gap-2">
          <h2 className="min-w-0 truncate text-base font-medium text-foreground">
            {data.name}
          </h2>
          <StatusBadge status={data.syncStatus} />
        </div>
        {data.description && (
          <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
            {data.description}
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <ProviderBadge provider="claude" data={data} />
          <ProviderBadge provider="codex" data={data} />
        </div>
      </div>

      <SkillBanner
        data={data}
        onViewDiff={() => setShowDiff(true)}
        onUseProvider={(provider) => {
          const content = data.providerContents[provider];
          if (content !== undefined) setDraft(content);
        }}
      />

      <div className="mt-3 min-h-0 flex-1">
        <MarkdownEditor
          value={draft}
          onChange={setDraft}
          maxHeight="100%"
          placeholder={"---\nname: my-skill\ndescription: When to use this skill\n---\n\n# My Skill"}
          ariaLabel={`${data.name} SKILL.md`}
        />
      </div>

      <div className="mt-4 flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={!isDirty || !draft.trim() || updateMutation.isPending}
          className={cn(
            "inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90",
            (!isDirty || !draft.trim() || updateMutation.isPending) && "pointer-events-none opacity-60",
          )}
        >
          {updateMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          Save
        </button>
        {canSync && (
          <button
            type="button"
            onClick={() => void handleSync()}
            disabled={syncMutation.isPending}
            className={cn(
              "inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border/50 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground",
              syncMutation.isPending && "pointer-events-none opacity-60",
            )}
          >
            {syncMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Sync
          </button>
        )}
        {error && (
          <span role="alert" className="text-xs text-red-400">
            {error}
          </span>
        )}
      </div>

      <SkillDiffDialog
        data={data}
        open={showDiff}
        onOpenChange={setShowDiff}
      />
    </div>
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
              className="cursor-pointer rounded-md px-2 py-0.5 text-[11px] font-medium text-amber-200 transition-colors hover:bg-amber-500/15"
            >
              View diff
            </button>
            <button
              type="button"
              onClick={() => onUseProvider("claude")}
              className="cursor-pointer rounded-md px-2 py-0.5 text-[11px] font-medium text-amber-200 transition-colors hover:bg-amber-500/15"
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

function Banner({
  tone,
  icon,
  children,
}: {
  tone: "info" | "warning" | "danger";
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-2 rounded-md border px-3 py-2 text-xs",
        tone === "info" && "border-sky-500/25 bg-sky-500/10 text-sky-300",
        tone === "warning" && "border-amber-500/25 bg-amber-500/10 text-amber-300",
        tone === "danger" && "border-red-500/25 bg-red-500/10 text-red-300",
      )}
    >
      {icon}
      {children}
    </div>
  );
}

function ProviderBadge({ provider, data }: { provider: SkillProviderId; data: SkillSummary }) {
  const state = data.providers[provider];
  const label = provider === "claude" ? "Claude" : "Codex";
  return (
    <span
      title={state.path}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
        state.present
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
          : "border-border bg-muted/50 text-muted-foreground",
      )}
    >
      {state.present ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
      {label}
      {state.isSymlink && <Link2 className="h-3 w-3" />}
    </span>
  );
}

function ProviderMiniBadge({ label, present }: { label: string; present: boolean }) {
  return (
    <span
      className={cn(
        "rounded-full border px-1.5 py-0 text-[10px] font-medium",
        present
          ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-400"
          : "border-border bg-muted/40 text-muted-foreground/80",
      )}
    >
      {label}
    </span>
  );
}

function StatusBadge({ status }: { status: SkillSyncStatus }) {
  const config = statusConfig(status);
  return (
    <Badge variant="secondary" className={cn("text-[10px]", config.className)}>
      {config.label}
    </Badge>
  );
}

function CompactStatusIcon({ status }: { status: SkillSyncStatus }) {
  if (status === "linked" || status === "synced") {
    return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />;
  }
  if (status === "invalid") {
    return <XCircle className="h-3.5 w-3.5 shrink-0 text-red-400" />;
  }
  return <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-400" />;
}

function statusConfig(status: SkillSyncStatus): { label: string; className: string } {
  switch (status) {
    case "linked":
      return { label: "Linked", className: "bg-emerald-500/10 text-emerald-400" };
    case "synced":
      return { label: "Synced", className: "bg-sky-500/10 text-sky-400" };
    case "claude_only":
      return { label: "Claude only", className: "bg-amber-500/10 text-amber-400" };
    case "codex_only":
      return { label: "Codex only", className: "bg-amber-500/10 text-amber-400" };
    case "diverged":
      return { label: "Diverged", className: "bg-amber-500/10 text-amber-400" };
    case "invalid":
      return { label: "Invalid", className: "bg-red-500/10 text-red-400" };
  }
}

function EmptyState() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      Select a skill to edit
    </div>
  );
}
