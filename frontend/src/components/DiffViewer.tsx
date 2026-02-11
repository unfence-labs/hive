import { useState, useEffect } from "react";
import { html, parse } from "diff2html";
import "diff2html/bundles/css/diff2html.min.css";
import { api } from "@/hooks/useApi";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
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

interface DiffViewerProps {
  wsId: string;
  onMerged?: () => void;
  onDiscarded?: () => void;
}

export default function DiffViewer({ wsId, onMerged, onDiscarded }: DiffViewerProps) {
  const [diffText, setDiffText] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"merge" | "discard" | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const data = await api.get<{ diff: string }>(`/api/workspaces/${wsId}/diff`);
        setDiffText(data.diff);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to fetch diff");
      } finally {
        setLoading(false);
      }
    })();
  }, [wsId]);

  const handleMerge = async () => {
    setMerging(true);
    try {
      await api.post(`/api/workspaces/${wsId}/merge`);
      onMerged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Merge failed");
    } finally {
      setMerging(false);
      setConfirmAction(null);
    }
  };

  const handleDiscard = async () => {
    try {
      await api.delete(`/api/workspaces/${wsId}`);
      onDiscarded?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Discard failed");
    } finally {
      setConfirmAction(null);
    }
  };

  if (loading) return <Skeleton className="h-96 w-full" />;
  if (error) return <div className="text-sm text-destructive">{error}</div>;

  const diffHtml = diffText
    ? html(parse(diffText), {
        drawFileList: true,
        outputFormat: "side-by-side",
        matching: "lines",
      })
    : "";

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button onClick={() => setConfirmAction("merge")} disabled={merging}>
          {merging ? "Merging..." : "Merge into main"}
        </Button>
        <Button
          variant="destructive"
          onClick={() => setConfirmAction("discard")}
        >
          Discard workspace
        </Button>
      </div>

      {!diffText ? (
        <div className="text-sm text-muted-foreground">No changes.</div>
      ) : (
        <ScrollArea className="max-h-[70vh] rounded-lg border">
          <div
            className="p-2 text-sm"
            dangerouslySetInnerHTML={{ __html: diffHtml }}
          />
        </ScrollArea>
      )}

      <AlertDialog
        open={!!confirmAction}
        onOpenChange={(open) => !open && setConfirmAction(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction === "merge" ? "Merge workspace?" : "Discard workspace?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction === "merge"
                ? "This will merge the workspace branch into main."
                : "This will permanently delete the workspace and all its changes."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmAction === "merge" ? handleMerge : handleDiscard}
            >
              {confirmAction === "merge" ? "Merge" : "Discard"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
