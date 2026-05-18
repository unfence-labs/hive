import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { ImageIcon, ImageOffIcon } from "lucide-react";
import { api } from "@/hooks/useApi";
import { highlightCode } from "@/lib/shiki";
import { Skeleton } from "@/components/ui/skeleton";
import { useThemeType } from "@/hooks/useThemeType";
import { resolveImageSrc } from "@/lib/image-url";
import { isImageFilePath, workspaceFileRawPath } from "@/lib/file-preview";
import { cn } from "@/lib/utils";

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

interface FileViewerProps {
  wsId: string;
  filePath: string;
}

function ImageFilePreview({ wsId, filePath }: FileViewerProps) {
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const src = resolveImageSrc(workspaceFileRawPath(wsId, filePath));
  const name = basename(filePath);

  useEffect(() => {
    setStatus("loading");
  }, [src]);

  return (
    <div className="file-viewer-image min-h-0 flex-1 overflow-auto bg-muted/20 p-4">
      <div className="flex min-h-full min-w-full items-center justify-center">
        {status === "loading" && (
          <div className="flex w-full max-w-sm flex-col items-center gap-3 rounded-md border border-border/50 bg-background/70 px-5 py-6 text-sm text-muted-foreground">
            <ImageIcon className="size-5" />
            <span>Loading image preview...</span>
          </div>
        )}
        {status === "error" && (
          <div className="flex w-full max-w-sm flex-col items-center gap-3 rounded-md border border-destructive/30 bg-destructive/10 px-5 py-6 text-center text-sm text-destructive">
            <ImageOffIcon className="size-5" />
            <span>Preview is not available for this image format.</span>
          </div>
        )}
        <img
          src={src}
          alt={name}
          className={cn(
            "max-h-full max-w-full rounded-md border border-border/50 bg-background object-contain shadow-sm",
            status !== "loaded" && "hidden",
          )}
          onLoad={() => setStatus("loaded")}
          onError={() => setStatus("error")}
        />
      </div>
    </div>
  );
}

export function FileViewer({ wsId, filePath }: FileViewerProps) {
  const theme = useThemeType();
  const shikiTheme = theme === "dark" ? "github-dark" : "github-light";
  const isImageFile = isImageFilePath(filePath);

  const fileQuery = useQuery({
    queryKey: ["file", wsId, filePath],
    queryFn: () =>
      api.get<{ content: string; path: string }>(
        `/api/workspaces/${wsId}/file?path=${encodeURIComponent(filePath)}`,
      ),
    enabled: !!wsId && !!filePath && !isImageFile,
    staleTime: 2 * 60 * 1000,
  });

  const [html, setHtml] = useState("");
  useEffect(() => {
    if (isImageFile) {
      setHtml("");
      return;
    }
    if (!fileQuery.data) {
      setHtml("");
      return;
    }
    let cancelled = false;
    highlightCode(fileQuery.data.content, getLang(filePath), shikiTheme).then((result) => {
      if (!cancelled) setHtml(result);
    });
    return () => {
      cancelled = true;
    };
  }, [fileQuery.data, filePath, isImageFile, shikiTheme]);

  if (isImageFile) {
    return <ImageFilePreview wsId={wsId} filePath={filePath} />;
  }

  const loading = fileQuery.isLoading || (!!fileQuery.data && !html);
  const error = fileQuery.error?.message ?? null;

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

  return (
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
  );
}
