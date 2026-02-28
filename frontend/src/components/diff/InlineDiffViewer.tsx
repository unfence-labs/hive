import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  memo,
  forwardRef,
  useImperativeHandle,
} from "react";
import {
  FileTextIcon,
  Loader2Icon,
  AlertCircleIcon,
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
import { cn } from "@/lib/utils";
import { nanoid } from "nanoid";
import { useThemeType } from "@/hooks/useThemeType";
import { useDiff } from "@/hooks/useDiff";

// ---------- Types ----------

export interface DiffComment {
  id: string;
  fileName: string;
  side: "deletions" | "additions";
  startLine: number;
  endLine: number;
  comment: string;
}

// ---------- Stable empty ref ----------

const EMPTY_ANNOTATIONS: DiffLineAnnotation<DiffComment>[] = [];

// ---------- Sub-components ----------

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
    <div className="flex h-10 items-center gap-2 border-t border-border bg-muted px-3">
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

// ---------- Main component ----------

export interface InlineDiffViewerHandle {
  pasteToPrompt: () => void;
}

interface InlineDiffViewerProps {
  wsId: string;
  filePath: string;
  diffStyle: "split" | "unified";
  onCommentCountChange: (count: number) => void;
  onPasteToPrompt: (formattedText: string) => void;
}

export const InlineDiffViewer = forwardRef<InlineDiffViewerHandle, InlineDiffViewerProps>(
  function InlineDiffViewer({
    wsId,
    filePath,
    diffStyle,
    onCommentCountChange,
    onPasteToPrompt,
  }, ref) {
  const { rawDiff, loading: isLoading, error } = useDiff(wsId, true);
  const themeType = useThemeType();

  const [comments, setComments] = useState<DiffComment[]>([]);
  const [selectedRange, setSelectedRange] = useState<SelectedLineRange | null>(null);
  const [activeFileName, setActiveFileName] = useState<string | null>(null);
  const [showCommentInput, setShowCommentInput] = useState(false);

  // Bubble comment count up to toolbar
  useEffect(() => {
    onCommentCountChange(comments.length);
  }, [comments.length, onCommentCountChange]);

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

  useImperativeHandle(ref, () => ({
    pasteToPrompt: () => {
      if (comments.length === 0) return;
      onPasteToPrompt(formatComments());
      setComments([]);
    },
  }), [comments, onPasteToPrompt, formatComments]);

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

  // Parse the full diff
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

  // Find the file matching filePath
  const matchedFile = useMemo(() => {
    return flattenedFiles.find(
      (f) => f.fileName === filePath || f.fileName.endsWith(`/${filePath}`),
    ) ?? null;
  }, [flattenedFiles, filePath]);

  // Loading
  if (isLoading && !matchedFile) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <Loader2Icon className="mr-2 h-5 w-5 animate-spin" />
        Loading diff...
      </div>
    );
  }

  // Error
  if (error && !isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-4 text-destructive">
          <AlertCircleIcon className="h-4 w-4 shrink-0" />
          <span className="text-sm">{error}</span>
        </div>
      </div>
    );
  }

  // No changes for this file
  if (!matchedFile) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        No changes for this file
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Hint / comment bar */}
      {!selectedRange && comments.length === 0 && (
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3 text-muted-foreground">
          <MessageSquarePlusIcon className="h-3.5 w-3.5 shrink-0" />
          <span className="text-xs">
            Click on line numbers to select code and add comments
          </span>
        </div>
      )}

      {/* Diff content */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <MemoizedFileDiffComponent
          key={matchedFile.key}
          fileDiff={matchedFile.fileDiff}
          fileName={matchedFile.fileName}
          additions={matchedFile.additions}
          deletions={matchedFile.deletions}
          annotations={getAnnotationsForFile(matchedFile.fileName)}
          selectedLines={
            activeFileName === matchedFile.fileName
              ? selectedRange
              : null
          }
          themeType={themeType}
          diffStyle={diffStyle}
          onLineSelected={getLineSelectedCallback(matchedFile.fileName)}
          onRemoveComment={handleRemoveComment}
        />
      </div>

      {/* Comment input */}
      {showCommentInput && (
        <div className="shrink-0">
          <CommentInputBar
            activeFileName={activeFileName}
            selectedRange={selectedRange}
            onAddComment={handleAddComment}
            onCancel={handleCancelComment}
          />
        </div>
      )}
    </div>
  );
});
