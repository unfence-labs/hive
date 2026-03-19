import { useState } from "react";
import { HardDrive, Loader2, Trash2 } from "lucide-react";
import { SettingsHeader } from "@/components/AppLayout";
import { useDiskUsage, useCleanupPreview, useRunCleanup } from "@/hooks/useCleanupSettings";
import { cn } from "@/lib/utils";

export default function StorageSettings() {
  const { data: diskUsage, isLoading: diskLoading } = useDiskUsage();
  const previewMutation = useCleanupPreview();
  const cleanupMutation = useRunCleanup();
  const [showResult, setShowResult] = useState(false);

  const usedPercent = diskUsage?.usedPercent ?? 0;
  const barColor = usedPercent >= 90 ? "bg-red-500" : usedPercent >= 80 ? "bg-yellow-500" : "bg-emerald-500";

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  const handlePreview = () => {
    setShowResult(false);
    previewMutation.mutate();
  };

  const handleCleanup = () => {
    cleanupMutation.mutate(undefined, {
      onSuccess: () => setShowResult(true),
    });
  };

  return (
    <div className="flex h-full flex-col overflow-auto">
      <SettingsHeader>
        <h1 className="text-sm font-medium">Storage</h1>
      </SettingsHeader>

      <div className="max-w-2xl space-y-6 px-4 py-5">
        {/* Disk usage */}
        <section>
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Disk Usage
          </h2>
          <div className="rounded-lg border border-border/50 p-4">
            {diskLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading...
              </div>
            ) : diskUsage ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <HardDrive className="h-4 w-4" />
                    <span>{usedPercent}% used</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {formatBytes(diskUsage.totalBytes - diskUsage.freeBytes)} / {formatBytes(diskUsage.totalBytes)}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted/30">
                  <div
                    className={cn("h-full rounded-full transition-all", barColor)}
                    style={{ width: `${Math.min(usedPercent, 100)}%` }}
                  />
                </div>
                {usedPercent >= 80 && (
                  <p className={cn("text-xs", usedPercent >= 90 ? "text-red-400" : "text-yellow-400")}>
                    {usedPercent >= 90
                      ? "Critical: Disk usage is very high. New automation runs are blocked."
                      : "Warning: Disk usage is high. Consider running cleanup."}
                  </p>
                )}
              </div>
            ) : null}
          </div>
        </section>

        {/* Cleanup */}
        <section>
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Cleanup
          </h2>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Remove build artifacts (node_modules, dist, etc.), stale archived workspaces, and old automation run sessions.
            </p>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={handlePreview}
                disabled={previewMutation.isPending}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md border border-border/50 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground",
                  previewMutation.isPending && "pointer-events-none opacity-60",
                )}
              >
                {previewMutation.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                Preview
              </button>

              <button
                type="button"
                onClick={handleCleanup}
                disabled={cleanupMutation.isPending}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md border border-border/50 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground",
                  cleanupMutation.isPending && "pointer-events-none opacity-60",
                )}
              >
                {cleanupMutation.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Trash2 className="h-3 w-3" />
                )}
                Clean Now
              </button>
            </div>

            {/* Preview results */}
            {previewMutation.data && !showResult && (
              <div className="rounded-lg border border-border/50 p-3 text-xs">
                <p className="mb-2 font-medium text-foreground">Cleanup Preview</p>
                <div className="space-y-1 text-muted-foreground">
                  <p>Reclaimable: <span className="text-foreground">{formatBytes(previewMutation.data.reclaimableBytes)}</span></p>
                  <p>Artifact directories: <span className="text-foreground">{previewMutation.data.artifactDirs}</span></p>
                  <p>Stale archives: <span className="text-foreground">{previewMutation.data.staleArchives}</span></p>
                  <p>Stale run sessions: <span className="text-foreground">{previewMutation.data.staleRunSessions}</span></p>
                </div>
              </div>
            )}

            {/* Cleanup results */}
            {showResult && cleanupMutation.data && (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs">
                <p className="mb-2 font-medium text-emerald-400">Cleanup Complete</p>
                <div className="space-y-1 text-muted-foreground">
                  <p>Reclaimed: <span className="text-foreground">{formatBytes(cleanupMutation.data.bytesReclaimed)}</span></p>
                  <p>Artifact dirs removed: <span className="text-foreground">{cleanupMutation.data.artifactDirsRemoved}</span></p>
                  <p>Archives removed: <span className="text-foreground">{cleanupMutation.data.archivesRemoved}</span></p>
                  <p>Run sessions removed: <span className="text-foreground">{cleanupMutation.data.runSessionsRemoved}</span></p>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
