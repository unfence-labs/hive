import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { AlertTriangleIcon, ImageOffIcon, Loader2Icon } from "lucide-react";
import { highlightCode } from "@/lib/shiki";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import { MessageResponse } from "@/components/ai-elements/message";
import { Skeleton } from "@/components/ui/skeleton";
import { useThemeType } from "@/hooks/useThemeType";
import { useFileContent } from "@/hooks/useFileContent";
import { resolveImageSrc } from "@/lib/image-url";
import { isImageFilePath, isMarkdownFilePath, workspaceFileRawPath } from "@/lib/file-preview";
import { cn } from "@/lib/utils";

/** Debounce (ms) before flushing edits to disk via the `onWriteToDisk` callback. */
const DISK_WRITE_DEBOUNCE_MS = 600;

const EXT_TO_LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  json: "json",
  css: "css",
  scss: "scss",
  html: "html",
  md: "markdown",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  py: "python",
  rs: "rust",
  go: "go",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  sql: "sql",
  graphql: "graphql",
  xml: "xml",
  svg: "xml",
  dockerfile: "dockerfile",
  makefile: "makefile",
};

function getLang(filePath: string): string {
  const name = filePath.split("/").pop() ?? "";
  const lower = name.toLowerCase();
  if (lower === "dockerfile") return "dockerfile";
  if (lower === "makefile") return "makefile";
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return EXT_TO_LANG[ext] ?? "text";
}

function basename(filePath: string): string {
  return filePath.split("/").pop() ?? filePath;
}

type FileWriteCallback = (path: string, content: string) => Promise<unknown> | void;

export interface FileViewerHandle {
  flushPendingWrite: () => Promise<void>;
}

interface FileViewerProps {
  wsId: string;
  filePath: string;
  /**
   * Markdown render mode. Only honored for Markdown files; non-Markdown files
   * always render raw. Defaults to `"raw"`.
   */
  renderMode?: "raw" | "rendered";
  /**
   * When `true`, raw Markdown is shown in an editable {@link MarkdownEditor}
   * with debounced disk writes via {@link FileViewerProps.onWriteToDisk}.
   * Defaults to `false` (read-only).
   */
  editable?: boolean;
  /**
   * Persist edited content (working tree only — NOT a git commit). Called
   * debounced as the user types. Only used when `editable` is `true`.
   */
  onWriteToDisk?: FileWriteCallback;
}

function ImageFilePreview({ wsId, filePath }: { wsId: string; filePath: string }) {
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const src = resolveImageSrc(workspaceFileRawPath(wsId, filePath));
  const name = basename(filePath);

  useEffect(() => {
    setStatus("loading");
  }, [src]);

  return (
    <div className="file-viewer-image min-h-0 flex-1 overflow-auto bg-muted/20 p-4">
      <div className="grid min-h-full min-w-full place-items-center">
        {status === "loading" && (
          <div
            className="flex w-full max-w-sm items-center justify-center gap-2 rounded-md border border-border/50 bg-background/70 px-4 py-3 text-sm text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            <Loader2Icon className="size-4 motion-safe:animate-spin" />
            <span>Loading preview...</span>
          </div>
        )}
        {status === "error" && (
          <div
            className="flex w-full max-w-sm items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            role="alert"
          >
            <ImageOffIcon className="size-4 shrink-0" />
            <span>Preview is not available for this image format.</span>
          </div>
        )}
        <img
          src={src}
          alt={name}
          className={cn(
            "max-h-full max-w-full rounded-md border border-border/50 bg-background object-contain shadow-sm dark:shadow-none",
            status !== "loaded" && "hidden",
          )}
          onLoad={() => setStatus("loaded")}
          onError={() => setStatus("error")}
        />
      </div>
    </div>
  );
}

export const FileViewer = forwardRef<FileViewerHandle, FileViewerProps>(function FileViewer({
  wsId,
  filePath,
  renderMode = "raw",
  editable = false,
  onWriteToDisk,
}, ref) {
  const theme = useThemeType();
  const shikiTheme = theme === "dark" ? "github-dark" : "github-light";
  const isImageFile = isImageFilePath(filePath);
  const isMarkdown = isMarkdownFilePath(filePath);
  const showRendered = renderMode === "rendered" && isMarkdown;
  const editableRef = useRef<EditableRawFileHandle>(null);

  useImperativeHandle(
    ref,
    () => ({
      flushPendingWrite: () => editableRef.current?.flushPendingWrite() ?? Promise.resolve(),
    }),
    [],
  );

  const { content, isLoading: contentLoading, error: contentError, truncated } = useFileContent(
    isImageFile ? undefined : wsId,
    isImageFile ? null : filePath,
  );

  // A truncated file holds only a prefix of the on-disk content, so it must
  // never be editable — a save would overwrite the dropped tail.
  const effectiveEditable = editable && !truncated;

  // Shiki HTML for the read-only raw view. Skipped when editing or rendering.
  const skipHtml = isImageFile || showRendered || effectiveEditable;
  const [html, setHtml] = useState("");
  useEffect(() => {
    if (skipHtml || content === undefined) {
      setHtml("");
      return;
    }
    let cancelled = false;
    highlightCode(content, getLang(filePath), shikiTheme).then((result) => {
      if (!cancelled) setHtml(result);
    });
    return () => {
      cancelled = true;
    };
  }, [content, filePath, skipHtml, shikiTheme]);

  if (isImageFile) {
    return <ImageFilePreview wsId={wsId} filePath={filePath} />;
  }

  const error = contentError?.message ?? null;
  // The raw read-only branch also waits for the highlighted HTML to be ready.
  const loading = contentLoading || (!skipHtml && content !== undefined && !html);

  if (loading) {
    return (
      <div className="flex-1 space-y-2 p-4">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-4/5" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      </div>
    );
  }

  const banner = truncated ? <TruncatedNotice /> : null;

  if (showRendered) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {banner}
        <RenderedMarkdown content={content ?? ""} />
      </div>
    );
  }

  if (effectiveEditable) {
    return (
      <EditableRawFile
        ref={editableRef}
        filePath={filePath}
        content={content ?? ""}
        onWriteToDisk={onWriteToDisk}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {banner}
      <div className="file-viewer min-h-0 flex-1 overflow-auto">
      <div
        className="file-viewer-content text-sm"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <style>{`
        .file-viewer-content pre.shiki {
          margin: 0;
          padding: 1rem 0;
          background: transparent !important;
          overflow-x: auto;
        }
        .file-viewer-content .line {
          display: inline-block;
          width: 100%;
          padding: 0 1rem 0 0;
        }
        .file-viewer-content .line::before {
          content: attr(data-line);
          display: inline-block;
          width: 3.5rem;
          padding-right: 1rem;
          text-align: right;
          color: var(--muted-foreground, #6e7781);
          opacity: 0.5;
          user-select: none;
        }
        .file-viewer-content .line:hover {
          background: color-mix(in oklch, var(--foreground) 5%, transparent);
        }
      `}</style>
      </div>
    </div>
  );
});

/** Banner shown when only a prefix of a large file is loaded (read-only). */
function TruncatedNotice() {
  return (
    <div
      className="flex shrink-0 items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-700 dark:text-amber-400"
      role="status"
    >
      <AlertTriangleIcon className="size-3.5 shrink-0" />
      <span>
        This file is too large to load fully. Showing a preview only — editing is
        disabled to avoid overwriting the rest of the file.
      </span>
    </div>
  );
}

/** Rendered Markdown preview (read-only). Mirrors the Brain editor's styling. */
function RenderedMarkdown({ content }: { content: string }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="px-6 py-4 text-sm [&_h1]:text-2xl [&_h2]:text-xl [&_h3]:text-lg">
        {content.trim() ? (
          <MessageResponse>{content}</MessageResponse>
        ) : (
          <span className="text-muted-foreground">Empty file.</span>
        )}
      </div>
    </div>
  );
}

/**
 * Editable raw view backed by {@link MarkdownEditor}, with debounced disk writes
 * via `onWriteToDisk`. The latest pending edit is captured alongside the path it
 * belongs to and flushed before switching files / on unmount, so no edit is lost
 * inside the debounce window (logic preserved from the original Brain editor).
 */
interface EditableRawFileHandle {
  flushPendingWrite: () => Promise<void>;
}

const EditableRawFile = forwardRef<EditableRawFileHandle, {
  filePath: string;
  content: string;
  onWriteToDisk?: FileWriteCallback;
}>(function EditableRawFile({
  filePath,
  content,
  onWriteToDisk,
}, ref) {
  const [buffer, setBuffer] = useState(content);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<{ path: string; content: string } | null>(null);
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve());
  const filePathRef = useRef(filePath);
  filePathRef.current = filePath;
  const writeRef = useRef(onWriteToDisk);
  writeRef.current = onWriteToDisk;

  const enqueueWrite = useCallback((path: string, content: string) => {
    const write = writeQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        await writeRef.current?.(path, content);
      });
    writeQueueRef.current = write;
    return write;
  }, []);

  // Immediately persist any pending debounced edit. Safe to call repeatedly.
  const flush = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    const pending = pendingRef.current;
    if (pending) {
      pendingRef.current = null;
      return enqueueWrite(pending.path, pending.content);
    }
    return writeQueueRef.current;
  }, [enqueueWrite]);

  useImperativeHandle(ref, () => ({ flushPendingWrite: flush }), [flush]);

  // Reset the buffer whenever the loaded file changes (new selection or refetch).
  useEffect(() => {
    setBuffer(content);
  }, [content, filePath]);

  // Flush the pending write of the *previous* file before switching, and on
  // unmount, so no edit is lost inside the debounce window.
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    return () => {
      void flushRef.current().catch(() => undefined);
    };
  }, [filePath]);

  const handleChange = useCallback((next: string) => {
    setBuffer(next);
    const path = filePathRef.current;
    if (!path) return;
    pendingRef.current = { path, content: next };
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (pending) void enqueueWrite(pending.path, pending.content).catch(() => undefined);
    }, DISK_WRITE_DEBOUNCE_MS);
  }, [enqueueWrite]);

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <MarkdownEditor
        value={buffer}
        onChange={handleChange}
        maxHeight="100%"
        ariaLabel="File content"
        className="h-full"
      />
    </div>
  );
});
