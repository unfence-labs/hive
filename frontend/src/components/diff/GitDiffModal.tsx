import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  memo,
  useTransition,
} from "react";
import {
  FileTextIcon,
  Loader2Icon,
  AlertCircleIcon,
  RefreshCwIcon,
  Columns2Icon,
  Rows3Icon,
  MessageSquarePlusIcon,
  XIcon,
} from "lucide-react";
import { FileDiff } from "@pierre/diffs/react";
import {
  parsePatchFiles,
  type SelectedLineRange,
  type DiffLineAnnotation,
  type FileDiffMetadata,
} from "@pierre/diffs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { nanoid } from "nanoid";
import { useThemeType } from "@/hooks/useThemeType";
import { api } from "@/hooks/useApi";

// Stable empty array reference for files without comments
const EMPTY_ANNOTATIONS: DiffLineAnnotation<DiffComment>[] = [];

export interface DiffComment {
  id: string;
  fileName: string;
  side: "deletions" | "additions";
  startLine: number;
  endLine: number;
  comment: string;
}

interface MemoizedFileDiffProps {
  fileDiff: FileDiffMetadata;
  fileName: string;
  additions: number;
  deletions: number;
  annotations: DiffLineAnnotation<DiffComment>[];
  selectedLines: SelectedLineRange | null;
  themeType: "dark" | "light";
  diffStyle: "split" | "unified";
  onLineSelected: (range: SelectedLineRange | null) => void;
  onRemoveComment: (id: string) => void;
}

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

const MemoizedFileDiffComponent = memo(
  function MemoizedFileDiffComponent({
    fileDiff,
    fileName,
    additions,
    deletions,
    annotations,
    selectedLines,
    themeType,
    diffStyle,
    onLineSelected,
    onRemoveComment,
  }: MemoizedFileDiffProps) {
    const options = useMemo(
      () => ({
        theme: {
          dark: "github-dark" as const,
          light: "github-light" as const,
        },
        themeType,
        diffStyle,
        enableLineSelection: true,
        onLineSelected,
        disableFileHeader: true,
        unsafeCSS:
          "pre { font-family: var(--font-mono, ui-monospace, monospace) !important; font-size: 13px !important; line-height: 1.5 !important; }",
      }),
      [themeType, diffStyle, onLineSelected],
    );

    const renderAnnotation = useCallback(
      (annotation: DiffLineAnnotation<DiffComment>) => (
        <div className="flex items-center gap-2 border-l-2 border-primary bg-primary/10 px-2 py-1 text-xs">
          <MessageSquarePlusIcon className="h-3 w-3 shrink-0 text-primary" />
          <span className="text-foreground">
            {annotation.metadata?.comment}
          </span>
          <button
            type="button"
            onClick={() =>
              annotation.metadata && onRemoveComment(annotation.metadata.id)
            }
            className="ml-auto p-0.5 text-muted-foreground hover:text-foreground"
          >
            <XIcon className="h-3 w-3" />
          </button>
        </div>
      ),
      [onRemoveComment],
    );

    return (
      <div className="border border-border">
        <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-muted px-3 py-2">
          <FileTextIcon
            className={cn(
              "h-[1em] w-[1em] shrink-0",
              getStatusColor(fileDiff.type),
            )}
          />
          <span className="truncate">{fileName}</span>
          {fileDiff.prevName && fileDiff.prevName !== fileName && (
            <span className="truncate text-muted-foreground">
              &larr; {fileDiff.prevName}
            </span>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {additions > 0 && (
              <span className="text-green-500">+{additions}</span>
            )}
            {deletions > 0 && (
              <span className="text-red-500">-{deletions}</span>
            )}
          </div>
        </div>
        {fileDiff.hunks.length === 0 ||
        fileDiff.hunks.every((h) => h.hunkContent.length === 0) ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            Empty file
          </div>
        ) : (
          <FileDiff
            fileDiff={fileDiff}
            lineAnnotations={annotations}
            selectedLines={selectedLines}
            options={options}
            renderAnnotation={renderAnnotation}
          />
        )}
      </div>
    );
  },
  (prevProps, nextProps) =>
    prevProps.fileDiff === nextProps.fileDiff &&
    prevProps.fileName === nextProps.fileName &&
    prevProps.additions === nextProps.additions &&
    prevProps.deletions === nextProps.deletions &&
    prevProps.annotations === nextProps.annotations &&
    (prevProps.selectedLines === nextProps.selectedLines ||
      (prevProps.selectedLines === null && nextProps.selectedLines === null)) &&
    prevProps.themeType === nextProps.themeType &&
    prevProps.diffStyle === nextProps.diffStyle &&
    prevProps.onLineSelected === nextProps.onLineSelected &&
    prevProps.onRemoveComment === nextProps.onRemoveComment,
);

interface CommentInputBarProps {
  activeFileName: string | null;
  selectedRange: SelectedLineRange | null;
  onAddComment: (comment: string) => void;
  onCancel: () => void;
}

const CommentInputBar = memo(function CommentInputBar({
  activeFileName,
  selectedRange,
  onAddComment,
  onCancel,
}: CommentInputBarProps) {
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  const handleSubmit = useCallback(() => {
    if (inputValue.trim()) {
      onAddComment(inputValue.trim());
      setInputValue("");
    }
  }, [inputValue, onAddComment]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && inputValue.trim()) {
        handleSubmit();
      } else if (e.key === "Escape") {
        onCancel();
      }
    },
    [inputValue, handleSubmit, onCancel],
  );

  if (!selectedRange) return null;

  const displayName = activeFileName?.split("/").pop() ?? "";

  return (
    <div className="flex h-10 items-center gap-2 rounded-md border border-border bg-muted px-3">
      <MessageSquarePlusIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="shrink-0 text-xs text-muted-foreground">
        {displayName}:{selectedRange.start}
        {selectedRange.end !== selectedRange.start &&
          `-${selectedRange.end}`}
      </span>
      <input
        ref={inputRef}
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="What should I do with this code?"
        className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
      <button
        type="button"
        onClick={handleSubmit}
        disabled={!inputValue.trim()}
        className="rounded bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Add
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="p-1 text-muted-foreground hover:text-foreground"
      >
        <XIcon className="h-3.5 w-3.5" />
      </button>
    </div>
  );
});

interface GitDiffModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wsId: string;
  initialFile?: string;
  onAddToPrompt?: (text: string) => void;
}

type DiffStyle = "split" | "unified";

export function GitDiffModal({
  open,
  onOpenChange,
  wsId,
  initialFile,
  onAddToPrompt,
}: GitDiffModalProps) {
  const [rawDiff, setRawDiff] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [diffStyle, setDiffStyle] = useState<DiffStyle>("split");
  const themeType = useThemeType();

  // Comment/selection state
  const [comments, setComments] = useState<DiffComment[]>([]);
  const [selectedRange, setSelectedRange] = useState<SelectedLineRange | null>(
    null,
  );
  const [activeFileName, setActiveFileName] = useState<string | null>(null);
  const [showCommentInput, setShowCommentInput] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Sidebar file selection
  const [selectedFileIndex, setSelectedFileIndex] = useState<number>(0);
  const fileListRef = useRef<HTMLDivElement>(null);

  const [, startTransition] = useTransition();
  const [isSwitching, setIsSwitching] = useState(false);
  const switchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadDiff = useCallback(
    async (isRefresh = false) => {
      setIsLoading(true);
      setError(null);
      if (!isRefresh) setRawDiff("");

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
    },
    [wsId],
  );

  useEffect(() => {
    if (open) {
      loadDiff();
      setSelectedFileIndex(0);
    } else {
      setRawDiff("");
      setError(null);
      setIsLoading(false);
      setComments([]);
      setSelectedRange(null);
      setActiveFileName(null);
      setShowCommentInput(false);
      setSelectedFileIndex(0);
      setIsSwitching(false);
      if (switchTimeoutRef.current) clearTimeout(switchTimeoutRef.current);
    }
  }, [open, loadDiff]);

  const lineSelectedCallbacksRef = useRef<
    Map<string, (range: SelectedLineRange | null) => void>
  >(new Map());

  const getLineSelectedCallback = useCallback((fileName: string) => {
    let callback = lineSelectedCallbacksRef.current.get(fileName);
    if (!callback) {
      callback = (range: SelectedLineRange | null) => {
        setSelectedRange(range);
        setActiveFileName(range ? fileName : null);
        if (range) setShowCommentInput(true);
      };
      lineSelectedCallbacksRef.current.set(fileName, callback);
    }
    return callback;
  }, []);

  const handleAddComment = useCallback(
    (commentText: string) => {
      if (!selectedRange || !activeFileName || !commentText) return;
      const newComment: DiffComment = {
        id: nanoid(),
        fileName: activeFileName,
        side: selectedRange.side ?? "additions",
        startLine: Math.min(selectedRange.start, selectedRange.end),
        endLine: Math.max(selectedRange.start, selectedRange.end),
        comment: commentText,
      };
      setComments((prev) => [...prev, newComment]);
      setSelectedRange(null);
      setShowCommentInput(false);
    },
    [selectedRange, activeFileName],
  );

  const handleRemoveComment = useCallback((commentId: string) => {
    setComments((prev) => prev.filter((c) => c.id !== commentId));
  }, []);

  const handleCancelComment = useCallback(() => {
    setShowCommentInput(false);
    setSelectedRange(null);
  }, []);

  const formatComments = useCallback(() => {
    return comments
      .map((c) => {
        const lineRange =
          c.startLine === c.endLine
            ? `line ${c.startLine}`
            : `lines ${c.startLine}-${c.endLine}`;
        return `In ${c.fileName} (${lineRange}, ${c.side === "deletions" ? "old code" : "new code"}): "${c.comment}"`;
      })
      .join("\n\n");
  }, [comments]);

  const handleSendToPrompt = useCallback(() => {
    if (comments.length === 0 || !onAddToPrompt) return;
    onAddToPrompt(formatComments());
    setComments([]);
    onOpenChange(false);
  }, [comments, onAddToPrompt, formatComments, onOpenChange]);

  const annotationsByFile = useMemo(() => {
    const map = new Map<string, DiffLineAnnotation<DiffComment>[]>();
    for (const comment of comments) {
      const existing = map.get(comment.fileName) ?? [];
      const newAnnotations = Array.from(
        { length: comment.endLine - comment.startLine + 1 },
        (_, i) => ({
          side: comment.side,
          lineNumber: comment.startLine + i,
          metadata: comment,
        }),
      );
      map.set(comment.fileName, [...existing, ...newAnnotations]);
    }
    return map;
  }, [comments]);

  const getAnnotationsForFile = useCallback(
    (fileName: string): DiffLineAnnotation<DiffComment>[] =>
      annotationsByFile.get(fileName) ?? EMPTY_ANNOTATIONS,
    [annotationsByFile],
  );

  const parsedFiles = useMemo(() => {
    if (!rawDiff) return [];
    try {
      return parsePatchFiles(rawDiff);
    } catch (e) {
      console.error("Failed to parse patch:", e);
      return [];
    }
  }, [rawDiff]);

  const flattenedFiles = useMemo(() => {
    return parsedFiles.flatMap((patch, patchIndex) =>
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
  }, [parsedFiles]);

  // Set initial file when flattenedFiles load and initialFile is specified
  useEffect(() => {
    if (initialFile && flattenedFiles.length > 0) {
      const idx = flattenedFiles.findIndex(
        (f) =>
          f.fileName === initialFile || f.fileName.endsWith(`/${initialFile}`),
      );
      if (idx >= 0) setSelectedFileIndex(idx);
    }
  }, [initialFile, flattenedFiles]);

  const selectedFile =
    flattenedFiles.length > 0 && selectedFileIndex < flattenedFiles.length
      ? flattenedFiles[selectedFileIndex]
      : null;

  const hasFiles = flattenedFiles.length > 0;

  const switchToFile = useCallback(
    (indexOrUpdater: number | ((prev: number) => number)) => {
      if (switchTimeoutRef.current) clearTimeout(switchTimeoutRef.current);
      setSelectedRange(null);
      setShowCommentInput(false);
      setIsSwitching(true);
      startTransition(() => {
        setSelectedFileIndex(indexOrUpdater);
      });
      switchTimeoutRef.current = setTimeout(() => setIsSwitching(false), 150);
    },
    [],
  );

  // Keyboard navigation
  useEffect(() => {
    if (!open || flattenedFiles.length === 0) return;
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      )
        return;

      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        switchToFile((i) => Math.min(i + 1, flattenedFiles.length - 1));
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        switchToFile((i) => Math.max(i - 1, 0));
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, flattenedFiles.length, switchToFile]);

  // Scroll selected file into view
  useEffect(() => {
    const list = fileListRef.current;
    if (!list) return;
    const selectedItem = list.querySelector(
      `[data-index="${selectedFileIndex}"]`,
    );
    selectedItem?.scrollIntoView({ block: "nearest" });
  }, [selectedFileIndex]);

  // Cleanup timeout
  useEffect(() => {
    return () => {
      if (switchTimeoutRef.current) clearTimeout(switchTimeoutRef.current);
    };
  }, []);

  // Compute total stats
  const totalStats = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    for (const f of flattenedFiles) {
      additions += f.additions;
      deletions += f.deletions;
    }
    return { additions, deletions };
  }, [flattenedFiles]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex !h-dvh !max-h-none !w-screen !max-w-screen flex-col overflow-hidden !rounded-none bg-background/95 p-0 backdrop-blur-sm sm:!h-[85vh] sm:!w-[calc(100vw-4rem)] sm:!max-w-[calc(100vw-4rem)] sm:!rounded-lg sm:p-4">
        <DialogDescription className="sr-only">
          Review changed files for this workspace and add line comments before sending instructions.
        </DialogDescription>
        <TooltipProvider>
        <DialogTitle className="flex items-center gap-2 shrink-0">
          <FileTextIcon className="h-4 w-4" />
          Changes
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => loadDiff(true)}
                disabled={isLoading}
                className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
              >
                <RefreshCwIcon
                  className={cn("h-3.5 w-3.5", isLoading && "animate-spin")}
                />
              </button>
            </TooltipTrigger>
            <TooltipContent>Refresh diff</TooltipContent>
          </Tooltip>
          <div className="flex items-center gap-3">
            {hasFiles && (
              <span className="text-xs font-normal text-muted-foreground">
                {flattenedFiles.length} file
                {flattenedFiles.length !== 1 ? "s" : ""} changed
                {totalStats.additions > 0 && (
                  <span className="ml-2 text-green-500">
                    +{totalStats.additions}
                  </span>
                )}
                {totalStats.deletions > 0 && (
                  <span className="ml-1 text-red-500">
                    -{totalStats.deletions}
                  </span>
                )}
              </span>
            )}
            <div className="flex items-center rounded-lg bg-muted p-1">
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
            {comments.length > 0 && onAddToPrompt && (
              <button
                type="button"
                onClick={handleSendToPrompt}
                className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Send to prompt ({comments.length})
              </button>
            )}
          </div>
        </DialogTitle>

        {/* Comment bar */}
        {hasFiles && (
          <div className="mt-2 shrink-0">
            {!selectedRange && comments.length === 0 && (
              <div className="flex h-10 items-center gap-2 px-3 text-muted-foreground">
                <MessageSquarePlusIcon className="h-4 w-4 shrink-0" />
                <span className="text-sm">
                  Click on line numbers to select code and add comments
                </span>
              </div>
            )}
            {showCommentInput && (
              <CommentInputBar
                activeFileName={activeFileName}
                selectedRange={selectedRange}
                onAddComment={handleAddComment}
                onCancel={handleCancelComment}
              />
            )}
          </div>
        )}

        {/* Empty state */}
        {rawDiff !== "" && !hasFiles && !isLoading && !error && (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            No changes to display
          </div>
        )}

        {/* Loading state */}
        {isLoading && !hasFiles && (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            <Loader2Icon className="mr-2 h-5 w-5 animate-spin" />
            Loading diff...
          </div>
        )}

        {/* Error state */}
        {error && !isLoading && (
          <div className="flex flex-1 items-center justify-center">
            <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-4 text-destructive">
              <AlertCircleIcon className="h-4 w-4 shrink-0" />
              <span className="text-sm">{error}</span>
            </div>
          </div>
        )}

        {/* File list + diff content */}
        {hasFiles && (
          <div className="mt-2 flex min-h-0 flex-1 gap-0">
            {/* File sidebar */}
            <div
              ref={fileListRef}
              className={cn(
                "w-64 shrink-0 overflow-y-auto transition-opacity duration-150",
                (isSwitching || isLoading) && "opacity-60",
              )}
            >
              <div>
                {flattenedFiles.map((file, index) => {
                  const isSelected = index === selectedFileIndex;
                  const displayName = file.fileName.split("/").pop() ?? file.fileName;
                  return (
                    <Tooltip key={file.key}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          data-index={index}
                          onClick={() => switchToFile(index)}
                          className={cn(
                            "flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/50",
                            isSelected && "bg-accent",
                          )}
                        >
                          <FileTextIcon
                            className={cn(
                              "h-[1em] w-[1em] shrink-0",
                              getStatusColor(file.fileDiff.type),
                            )}
                          />
                          <span className="flex-1 truncate">{displayName}</span>
                          <div className="flex shrink-0 items-center gap-1">
                            {file.additions > 0 && (
                              <span className="text-green-500">
                                +{file.additions}
                              </span>
                            )}
                            {file.deletions > 0 && (
                              <span className="text-red-500">
                                -{file.deletions}
                              </span>
                            )}
                          </div>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>{file.fileName}</TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
            </div>

            {/* Main content */}
            <div
              ref={scrollContainerRef}
              className={cn(
                "min-w-0 flex-1 overflow-y-auto transition-opacity duration-150",
                (isSwitching || isLoading) && "opacity-60",
              )}
            >
              {selectedFile ? (
                <div className="px-2">
                  <MemoizedFileDiffComponent
                    key={selectedFile.key}
                    fileDiff={selectedFile.fileDiff}
                    fileName={selectedFile.fileName}
                    additions={selectedFile.additions}
                    deletions={selectedFile.deletions}
                    annotations={getAnnotationsForFile(selectedFile.fileName)}
                    selectedLines={
                      activeFileName === selectedFile.fileName
                        ? selectedRange
                        : null
                    }
                    themeType={themeType}
                    diffStyle={diffStyle}
                    onLineSelected={getLineSelectedCallback(
                      selectedFile.fileName,
                    )}
                    onRemoveComment={handleRemoveComment}
                  />
                </div>
              ) : (
                <div className="flex h-full items-center justify-center text-muted-foreground">
                  Select a file to view its diff
                </div>
              )}
            </div>
          </div>
        )}
        </TooltipProvider>
      </DialogContent>
    </Dialog>
  );
}
