import { useState, useEffect, useMemo, useCallback } from "react";
import {
  FileTextIcon,
  Loader2Icon,
  AlertCircleIcon,
  Columns2Icon,
  Rows3Icon,
} from "lucide-react";
import { FileDiff } from "@pierre/diffs/react";
import { parsePatchFiles, type FileDiffMetadata } from "@pierre/diffs";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useThemeType } from "@/hooks/useThemeType";
import { api } from "@/hooks/useApi";

interface FileDiffModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wsId: string;
  filePath: string;
}

type DiffStyle = "split" | "unified";

function getStatusColor(type: string) {
  switch (type) {
    case "new":
      return "text-green-500";
    case "deleted":
      return "text-red-500";
    case "rename-pure":
    case "rename-changed":
      return "text-yellow-500";
    default:
      return "text-blue-500";
  }
}

export function FileDiffModal({
  open,
  onOpenChange,
  wsId,
  filePath,
}: FileDiffModalProps) {
  const [rawDiff, setRawDiff] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [diffStyle, setDiffStyle] = useState<DiffStyle>("split");
  const themeType = useThemeType();

  const loadDiff = useCallback(async () => {
    if (!wsId) return;
    setIsLoading(true);
    setError(null);
    try {
      const { diff } = await api.get<{ diff: string }>(
        `/api/workspaces/${wsId}/diff`,
      );
      setRawDiff(diff);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [wsId]);

  useEffect(() => {
    if (open) {
      loadDiff();
    } else {
      setRawDiff("");
      setError(null);
      setIsLoading(false);
    }
  }, [open, loadDiff]);

  const parsedFiles = useMemo(() => {
    if (!rawDiff) return [];
    try {
      return parsePatchFiles(rawDiff);
    } catch (e) {
      console.error("Failed to parse patch:", e);
      return [];
    }
  }, [rawDiff]);

  const matchingFile = useMemo((): {
    fileDiff: FileDiffMetadata;
    fileName: string;
  } | null => {
    if (!filePath || parsedFiles.length === 0) return null;
    for (const patch of parsedFiles) {
      for (const file of patch.files) {
        const fileName = file.name || file.prevName || "";
        if (
          fileName === filePath ||
          fileName.endsWith(`/${filePath}`) ||
          filePath.endsWith(`/${fileName}`)
        ) {
          return { fileDiff: file, fileName };
        }
      }
    }
    return null;
  }, [parsedFiles, filePath]);

  const stats = useMemo(() => {
    if (!matchingFile) return { additions: 0, deletions: 0 };
    let additions = 0;
    let deletions = 0;
    for (const hunk of matchingFile.fileDiff.hunks) {
      additions += hunk.additionCount;
      deletions += hunk.deletionCount;
    }
    return { additions, deletions };
  }, [matchingFile]);

  const fileDiffOptions = useMemo(
    () => ({
      theme: {
        dark: "github-dark" as const,
        light: "github-light" as const,
      },
      themeType,
      diffStyle,
      enableLineSelection: false,
      disableFileHeader: true,
      unsafeCSS:
        "pre { font-family: var(--font-mono, ui-monospace, monospace) !important; font-size: 13px !important; line-height: 1.5 !important; }",
    }),
    [themeType, diffStyle],
  );

  const displayFilename = filePath.split("/").pop() ?? filePath;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex !h-dvh !max-h-none !w-screen !max-w-screen flex-col overflow-hidden !rounded-none bg-background/95 p-0 backdrop-blur-sm sm:!h-[85vh] sm:!w-[calc(100vw-4rem)] sm:!max-w-[calc(100vw-4rem)] sm:!rounded-lg sm:p-4">
        <TooltipProvider>
        <DialogTitle className="flex items-center gap-2 shrink-0">
          <FileTextIcon
            className={cn(
              "h-4 w-4",
              matchingFile && getStatusColor(matchingFile.fileDiff.type),
            )}
          />
          <span className="truncate">{displayFilename}</span>
          {matchingFile && (
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {stats.additions > 0 && (
                <span className="text-green-500">+{stats.additions}</span>
              )}
              {stats.deletions > 0 && (
                <span className="ml-1 text-red-500">-{stats.deletions}</span>
              )}
            </span>
          )}
          <div className="ml-2 flex items-center rounded-lg bg-muted p-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setDiffStyle("split")}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors",
                    diffStyle === "split"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Columns2Icon className="h-3.5 w-3.5" />
                  Split
                </button>
              </TooltipTrigger>
              <TooltipContent>Side-by-side view</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setDiffStyle("unified")}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors",
                    diffStyle === "unified"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Rows3Icon className="h-3.5 w-3.5" />
                  Stacked
                </button>
              </TooltipTrigger>
              <TooltipContent>Unified view</TooltipContent>
            </Tooltip>
          </div>
        </DialogTitle>

        <div className="mt-2 min-h-0 flex-1 overflow-y-auto">
          {isLoading && (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <Loader2Icon className="mr-2 h-5 w-5 animate-spin" />
              Loading diff...
            </div>
          )}

          {error && !isLoading && (
            <div className="flex h-full items-center justify-center">
              <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-4 text-destructive">
                <AlertCircleIcon className="h-4 w-4 shrink-0" />
                <span className="text-sm">{error}</span>
              </div>
            </div>
          )}

          {rawDiff && !matchingFile && !isLoading && !error && (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              No changes for this file
            </div>
          )}

          {matchingFile && !isLoading && (
            <div className="border border-border">
              <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-muted px-3 py-2">
                <FileTextIcon
                  className={cn(
                    "h-[1em] w-[1em] shrink-0",
                    getStatusColor(matchingFile.fileDiff.type),
                  )}
                />
                <span className="truncate text-sm">
                  {matchingFile.fileName}
                </span>
                {matchingFile.fileDiff.prevName &&
                  matchingFile.fileDiff.prevName !== matchingFile.fileName && (
                    <span className="truncate text-sm text-muted-foreground">
                      &larr; {matchingFile.fileDiff.prevName}
                    </span>
                  )}
              </div>
              <FileDiff
                fileDiff={matchingFile.fileDiff}
                options={fileDiffOptions}
              />
            </div>
          )}
        </div>
        </TooltipProvider>
      </DialogContent>
    </Dialog>
  );
}
