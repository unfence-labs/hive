import { useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Link2,
  Loader2,
  RefreshCw,
  Save,
  Trash2,
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
  ProviderBadge,
  SettingsActionButton as EditorActionButton,
  SettingsBanner as Banner,
  SyncStatusBadge as StatusBadge,
} from "@/components/settings/ProviderSync";
import { SettingsEditorFrame } from "@/components/settings/SettingsEditorFrame";
import {
  useDeleteInstructions,
  useInstructions,
  useSyncInstructions,
  useUpdateInstructions,
} from "@/hooks/useInstructions";
import type { InstructionDetail, InstructionProviderId, InstructionSyncStatus } from "@/types";

const SYNCABLE_STATUSES = new Set<InstructionSyncStatus>(["claude_only", "codex_only", "synced"]);
const INSTRUCTIONS_PLACEHOLDER = `# Global Agent Instructions

## General

- Keep changes focused.
- Follow the existing codebase conventions.
`;

export default function InstructionsSettings() {
  const { data, isLoading, isError } = useInstructions();

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <SettingsHeader>
        <h1 className="text-sm font-medium">
          Instructions <span className="text-[11px] font-normal text-muted-foreground">(AGENTS.md / CLAUDE.md)</span>
        </h1>
      </SettingsHeader>

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading instructions
        </div>
      ) : isError || !data ? (
        <div className="flex flex-1 items-center justify-center text-xs text-red-400">
          Could not load instructions.
        </div>
      ) : (
        <LoadedInstructionsPanel
          key={[
            data.syncStatus,
            data.providers.claude.hash ?? "no-claude",
            data.providers.codex.hash ?? "no-codex",
            data.override.hash ?? "no-override",
          ].join(":")}
          data={data}
        />
      )}
    </div>
  );
}

function LoadedInstructionsPanel({ data }: { data: InstructionDetail }) {
  const updateMutation = useUpdateInstructions();
  const syncMutation = useSyncInstructions();
  const deleteMutation = useDeleteInstructions();
  const [draft, setDraft] = useState(data.content);
  const [error, setError] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const isDirty = draft !== data.content;
  const canSync = SYNCABLE_STATUSES.has(data.syncStatus);
  const canDelete = data.providers.claude.present || data.providers.codex.present;
  const banner = hasInstructionBanner(data) ? (
    <InstructionBanners
      data={data}
      onViewDiff={() => setShowDiff(true)}
      onUseProvider={(provider) => {
        const content = data.providerContents[provider];
        if (content !== undefined) setDraft(content);
      }}
    />
  ) : null;

  const handleSave = async () => {
    if (!draft.trim()) return;
    setError(null);
    try {
      await updateMutation.mutateAsync({ content: draft });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save instructions");
    }
  };

  const handleSync = async () => {
    setError(null);
    try {
      await syncMutation.mutateAsync();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to sync instructions");
    }
  };

  const handleDelete = async () => {
    setError(null);
    try {
      await deleteMutation.mutateAsync();
      setDraft("");
      setShowDeleteConfirm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete instructions");
    }
  };

  return (
    <>
      <SettingsEditorFrame
        title="Global Instructions"
        badge={<StatusBadge status={data.syncStatus} />}
        providers={
          <>
            <ProviderBadge label="Claude" state={data.providers.claude} />
            <ProviderBadge label="Codex" state={data.providers.codex} />
          </>
        }
        banner={banner}
        value={draft}
        onChange={setDraft}
        placeholder={INSTRUCTIONS_PLACEHOLDER}
        ariaLabel="Global instructions AGENTS.md"
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
              disabled={!canDelete || deleteMutation.isPending}
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

      <InstructionDiffDialog
        data={data}
        open={showDiff}
        onOpenChange={setShowDiff}
      />

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete instructions</AlertDialogTitle>
            <AlertDialogDescription>
              Delete global instructions from Claude and Codex? `AGENTS.override.md` will not be modified.
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

function hasInstructionBanner(data: InstructionDetail) {
  return (
    data.override.active ||
    data.syncStatus === "missing" ||
    data.syncStatus === "invalid" ||
    data.syncStatus === "diverged" ||
    data.syncStatus === "claude_only" ||
    data.syncStatus === "codex_only" ||
    (data.syncStatus === "synced" && data.providers.claude.present && !data.providers.claude.isSymlink)
  );
}

function InstructionBanners({
  data,
  onViewDiff,
  onUseProvider,
}: {
  data: InstructionDetail;
  onViewDiff: () => void;
  onUseProvider: (provider: InstructionProviderId) => void;
}) {
  const banners: ReactNode[] = [];

  if (data.override.active) {
    banners.push(
      <Banner key="override" tone="warning" icon={<AlertTriangle className="h-3.5 w-3.5" />}>
        <span className="min-w-0 flex-1">
          `AGENTS.override.md` is active. Codex reads it before `AGENTS.md`; Hive will not modify it.
        </span>
      </Banner>,
    );
  }

  if (data.syncStatus === "missing") {
    banners.push(
      <Banner key="missing" tone="info" icon={<Link2 className="h-3.5 w-3.5" />}>
        Saving will create `~/.codex/AGENTS.md` and link Claude to it.
      </Banner>,
    );
  } else if (data.syncStatus === "invalid") {
    banners.push(
      <Banner key="invalid" tone="danger" icon={<XCircle className="h-3.5 w-3.5" />}>
        {data.invalidReason ?? "This instructions file could not be read."}
      </Banner>,
    );
  } else if (data.syncStatus === "diverged") {
    banners.push(
      <Banner key="diverged" tone="warning" icon={<AlertTriangle className="h-3.5 w-3.5" />}>
        <span className="min-w-0 flex-1">
          Claude and Codex instructions differ. The editor is using the canonical Codex copy.
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
      </Banner>,
    );
  } else if (data.syncStatus === "claude_only") {
    banners.push(
      <Banner key="claude-only" tone="warning" icon={<AlertTriangle className="h-3.5 w-3.5" />}>
        Saving or syncing will move Claude instructions into `~/.codex/AGENTS.md` and replace `~/.claude/CLAUDE.md` with a symlink.
      </Banner>,
    );
  } else if (data.syncStatus === "codex_only") {
    banners.push(
      <Banner key="codex-only" tone="info" icon={<Link2 className="h-3.5 w-3.5" />}>
        Saving or syncing will add a Claude symlink to the canonical Codex instructions.
      </Banner>,
    );
  } else if (data.syncStatus === "synced" && data.providers.claude.present && !data.providers.claude.isSymlink) {
    banners.push(
      <Banner key="synced" tone="info" icon={<Link2 className="h-3.5 w-3.5" />}>
        Both copies match. Saving or syncing will replace `~/.claude/CLAUDE.md` with a symlink.
      </Banner>,
    );
  }

  if (banners.length === 0) return null;
  return <div className="flex shrink-0 flex-col gap-2">{banners}</div>;
}

function InstructionDiffDialog({
  data,
  open,
  onOpenChange,
}: {
  data: InstructionDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const claudeContent = data.providerContents.claude ?? "";
  const codexContent = data.providerContents.codex ?? "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-hidden sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Instructions diff</DialogTitle>
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
            filePath="AGENTS.md"
            className="text-xs"
            scrollClassName="max-h-[60vh]"
          />
        </div>
        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}
