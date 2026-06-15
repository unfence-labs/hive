import { useCallback, useRef, useState, type RefObject } from "react";
import { FileViewer, type FileViewerHandle, type FileWriteCallback } from "@/components/FileViewer";
import { FileContentToolbar } from "@/components/FileContentToolbar";
import { InlineDiffViewer, type InlineDiffViewerHandle } from "@/components/diff/InlineDiffViewer";
import { isBinaryPreviewFilePath, isMarkdownFilePath } from "@/lib/file-preview";
import type { ChatInputHandle } from "@/components/ChatInput";
import type { FileViewMode } from "@/hooks/useTabs";
import type { DiffScope } from "@/types";

interface FileTabViewProps {
  wsId: string;
  filePath: string;
  fileViewMode: FileViewMode;
  onFileViewModeChange: (mode: FileViewMode) => void;
  isModified: boolean;
  diffScope: DiffScope;
  availableDiffScopes: DiffScope[];
  onDiffScopeChange: (scope: DiffScope) => void;
  renderMode: "raw" | "rendered";
  onRenderModeChange: (mode: "raw" | "rendered") => void;
  /** Chat input ref so diff comments can be pasted into the prompt. */
  chatInputRef: RefObject<ChatInputHandle | null>;
  /** Bring the conversation into view before pasting diff text. */
  onFocusConversation?: () => void;
  /** Enable in-place Markdown editing with debounced disk writes (Brain notes). */
  editable?: boolean;
  onWriteToDisk?: FileWriteCallback;
  fileViewerRef?: RefObject<FileViewerHandle | null>;
}

/**
 * File-tab takeover panel shared by WorkspaceView and BrainView: a
 * {@link FileContentToolbar} over a {@link FileViewer} (source) or an
 * {@link InlineDiffViewer} (diff). It owns the diff presentation state
 * (split/unified style with localStorage persistence, comment count) and the
 * paste-to-prompt bridge; the per-file modified / diff-scope logic (which
 * differs between a workspace's branch diffs and the Brain's single working-tree
 * scope) stays in each page and is passed in.
 */
export function FileTabView({
  wsId,
  filePath,
  fileViewMode,
  onFileViewModeChange,
  isModified,
  diffScope,
  availableDiffScopes,
  onDiffScopeChange,
  renderMode,
  onRenderModeChange,
  chatInputRef,
  onFocusConversation,
  editable = false,
  onWriteToDisk,
  fileViewerRef,
}: FileTabViewProps) {
  const diffViewerRef = useRef<InlineDiffViewerHandle>(null);
  const [diffCommentCount, setDiffCommentCount] = useState(0);
  const [diffStyle, setDiffStyle] = useState<"split" | "unified">(() => {
    const stored = localStorage.getItem("diff-style");
    return stored === "split" ? "split" : "unified";
  });
  const handleDiffStyleChange = useCallback((style: "split" | "unified") => {
    setDiffStyle(style);
    localStorage.setItem("diff-style", style);
  }, []);

  const handlePasteToPrompt = useCallback(() => {
    diffViewerRef.current?.pasteToPrompt();
  }, []);
  const handleDiffPasteText = useCallback(
    (text: string) => {
      onFocusConversation?.();
      requestAnimationFrame(() => chatInputRef.current?.appendText(text));
    },
    [onFocusConversation, chatInputRef],
  );

  const supportsRendered = isMarkdownFilePath(filePath);
  const isBinaryPreview = isBinaryPreviewFilePath(filePath);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <FileContentToolbar
        filePath={filePath}
        mode={fileViewMode}
        onModeChange={onFileViewModeChange}
        isModified={isModified}
        diffScope={diffScope}
        availableDiffScopes={availableDiffScopes}
        onDiffScopeChange={onDiffScopeChange}
        diffStyle={diffStyle}
        onDiffStyleChange={handleDiffStyleChange}
        commentCount={diffCommentCount}
        onPasteToPrompt={handlePasteToPrompt}
        sourceLabel={isBinaryPreview ? "Preview" : "Source"}
        supportsTextDiff={!isBinaryPreview}
        renderMode={renderMode}
        onRenderModeChange={onRenderModeChange}
        supportsRendered={supportsRendered}
      />
      {fileViewMode === "source" ? (
        <FileViewer
          ref={fileViewerRef}
          wsId={wsId}
          filePath={filePath}
          renderMode={renderMode}
          editable={editable}
          onWriteToDisk={onWriteToDisk}
        />
      ) : (
        <InlineDiffViewer
          ref={diffViewerRef}
          wsId={wsId}
          filePath={filePath}
          diffScope={diffScope}
          diffStyle={diffStyle}
          onCommentCountChange={setDiffCommentCount}
          onPasteToPrompt={handleDiffPasteText}
        />
      )}
    </div>
  );
}
