import { useMemo, useState } from "react";
import { parsePatchFiles } from "@pierre/diffs";
import { AlertCircleIcon, AlertTriangleIcon, Loader2Icon } from "lucide-react";
import { useThemeType } from "@/hooks/useThemeType";
import { useBrainDiff } from "@/hooks/useBrainGit";
import { FileDiffCard } from "@/components/diff/FileDiffCard";
import { Button } from "@/components/ui/button";

interface BrainReviewChangesProps {
  /** Commit + push the whole working tree with an optional message. */
  onConfirm: (message: string) => void;
  /** Return to the editor without committing. */
  onCancel: () => void;
  /** Whether a save is currently in flight (disables the buttons). */
  isSaving: boolean;
}

/**
 * Review panel shown when the user clicks Save: renders the complete
 * working-tree-vs-HEAD diff (modified + new + deleted files) and a confirmation
 * bar to commit + push. This reflects exactly what `save` will commit.
 */
export function BrainReviewChanges({ onConfirm, onCancel, isSaving }: BrainReviewChangesProps) {
  const { data, isLoading, error } = useBrainDiff(true);
  const themeType = useThemeType();
  const [message, setMessage] = useState("");
  const omittedFileCount = data?.omittedFileCount ?? 0;

  const files = useMemo(() => {
    const diff = data?.diff;
    if (!diff) return [];
    const patches = parsePatchFiles(diff);
    return patches.flatMap((patch, patchIndex) =>
      patch.files.map((fileDiff, fileIndex) => {
        let additions = 0;
        let deletions = 0;
        for (const hunk of fileDiff.hunks) {
          additions += hunk.additionLines;
          deletions += hunk.deletionLines;
        }
        return {
          fileDiff,
          fileName: fileDiff.name || fileDiff.prevName || "unknown",
          key: `${patchIndex}-${fileIndex}`,
          additions,
          deletions,
        };
      }),
    );
  }, [data?.diff]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border/50 px-4 py-2">
        <span className="text-sm font-medium text-foreground">Review changes</span>
        <span className="text-xs text-muted-foreground">
          {files.length} file{files.length === 1 ? "" : "s"} will be committed and pushed
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {omittedFileCount > 0 && (
          <div
            role="alert"
            className="mb-4 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-amber-700 dark:text-amber-300"
          >
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span className="text-sm">
              {omittedFileCount} more file{omittedFileCount === 1 ? "" : "s"} not shown in this
              diff (they will still be committed).
            </span>
          </div>
        )}
        {isLoading && (
          <div role="status" className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2Icon className="mr-2 size-5 animate-spin" aria-hidden="true" />
            Loading changes...
          </div>
        )}
        {error && !isLoading && (
          <div role="alert" className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-4 text-destructive">
            <AlertCircleIcon className="size-4 shrink-0" aria-hidden="true" />
            <span className="text-sm">{error.message}</span>
          </div>
        )}
        {!isLoading && !error && files.length === 0 && (
          <div className="py-10 text-center text-sm text-muted-foreground">
            No pending changes.
          </div>
        )}
        {!isLoading && !error && files.length > 0 && (
          <div className="flex flex-col gap-4">
            {files.map((file) => (
              <FileDiffCard
                key={file.key}
                fileDiff={file.fileDiff}
                fileName={file.fileName}
                additions={file.additions}
                deletions={file.deletions}
                themeType={themeType}
                diffStyle="unified"
              />
            ))}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-border/50 px-4 py-3">
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Commit message (optional)"
          aria-label="Commit message"
          disabled={isSaving}
          className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
        />
        <Button
          variant="ghost"
          size="sm"
          className="cursor-pointer"
          onClick={onCancel}
          disabled={isSaving}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          className="cursor-pointer"
          onClick={() => onConfirm(message.trim())}
          disabled={isSaving || files.length === 0}
        >
          {isSaving && <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />}
          Save &amp; Push
        </Button>
      </div>
    </div>
  );
}
