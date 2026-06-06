import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Group, Panel, useDefaultLayout } from "react-resizable-panels";
import {
  AlertTriangleIcon,
  BrainIcon,
  CheckIcon,
  CloudUploadIcon,
  Loader2Icon,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useBrain } from "@/hooks/useBrain";
import {
  useBrainFileMutations,
  useBrainFileTree,
} from "@/hooks/useBrainFiles";
import { useBrainSave, useBrainStatus } from "@/hooks/useBrainGit";
import { useBrainChatRefresh } from "@/hooks/useBrainChatRefresh";
import { useConversationColumn } from "@/hooks/useConversationColumn";
import { useWorkspaceLiveDataContext } from "@/contexts/WorkspaceLiveDataContext";
import ChatInput, { type ChatInputHandle } from "@/components/ChatInput";
import { ConversationPane } from "@/components/chat/ConversationPane";
import { BrainWelcome } from "@/components/BrainWelcome";
import { FileViewer } from "@/components/FileViewer";
import { FileContentToolbar } from "@/components/FileContentToolbar";
import { FileTree, renderFileTreeNodes } from "@/components/ai-elements/file-tree";
import { InlineDiffViewer, type InlineDiffViewerHandle } from "@/components/diff/InlineDiffViewer";
import { ModifiedFileList } from "@/components/diff/ModifiedFileList";
import { ResizeHandle } from "@/components/ResizeHandle";
import { BrainReviewChanges } from "@/components/brain/BrainReviewChanges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { wsTransport } from "@/lib/ws-transport";
import { BRAIN_WORKSPACE_ID, brainFileQueryKey } from "@/lib/brain";
import { isMarkdownFilePath } from "@/lib/file-preview";
import { cn } from "@/lib/utils";
import type {
  DiffFileStat,
  DiffScope,
  FileMention,
  ImageAttachment,
  MessageOptions,
  WorkspaceFileTreeNode,
} from "@/types";

/** Outcome indicator for the last git save. */
type BrainSaveIndicator = "idle" | "saving" | "saved" | "push-failed";

/** The Brain's single working-tree diff scope (it has no branch commits). */
const BRAIN_DIFF_SCOPE: DiffScope = "uncommitted";
const BRAIN_DIFF_SCOPES: DiffScope[] = [BRAIN_DIFF_SCOPE];

const DEFAULT_EXPANDED = new Set<string>();

/** Recursively count the file (non-directory) nodes in a Brain file tree. */
function countFiles(nodes: WorkspaceFileTreeNode[]): number {
  return nodes.reduce(
    (acc, node) =>
      node.type === "file"
        ? acc + 1
        : acc + (node.children ? countFiles(node.children) : 0),
    0,
  );
}

/** Expand the first top-level directory so the tree isn't fully collapsed on load. */
function buildInitialExpanded(nodes: WorkspaceFileTreeNode[]): Set<string> {
  const expanded = new Set(DEFAULT_EXPANDED);
  const firstDirectory = nodes.find((node) => node.type === "directory");
  if (firstDirectory) expanded.add(firstDirectory.path);
  return expanded;
}

/**
 * Brain page. Mirrors the Workspace layout: a main column (agent chat with a
 * file-tab takeover via the shared {@link FileViewer} / {@link InlineDiffViewer})
 * on the left and a shared file browser on the right with "All" (tree) and
 * "Modified" (pending-change list) tabs — the same components WorkspaceView uses.
 * Clicking a note opens it in a source tab; clicking a modified file opens a
 * diff tab. Editing happens in the Raw source view (debounced disk writes); the
 * Sync section (bottom-right) commits + pushes the whole working tree via a
 * review modal. The Brain has no note-management UI (no create/rename/delete).
 */
export default function BrainView() {
  const { brain, loading } = useBrain();
  const brainConnected = brain.exists;

  const queryClient = useQueryClient();
  const fileTreeQuery = useBrainFileTree();
  const statusQuery = useBrainStatus();
  const { upsertFile } = useBrainFileMutations();
  const { save, isSaving } = useBrainSave();

  const pendingCount = statusQuery.data?.count ?? 0;
  const brainTree = useMemo(() => fileTreeQuery.data ?? [], [fileTreeQuery.data]);
  const fileTreeError = fileTreeQuery.error?.message ?? null;

  // Pending changes → DiffFileStat[] for the shared ModifiedFileList. Brain
  // status carries no +/- counts; ModifiedFileList hides zero counts.
  const brainStats = useMemo<DiffFileStat[]>(
    () =>
      (statusQuery.data?.files ?? []).map((f) => ({
        file: f.path,
        additions: 0,
        deletions: 0,
        status: f.status === "untracked" ? "added" : f.status === "renamed" ? "renamed" : f.status,
      })),
    [statusQuery.data?.files],
  );
  const modifiedPaths = useMemo(
    () => new Set(brainStats.map((s) => s.file)),
    [brainStats],
  );

  const notesCount = useMemo(() => countFiles(brainTree), [brainTree]);
  const repoUrl = brain.exists ? brain.repoUrl : undefined;

  const onLastSessionDeleted = useCallback(() => {
    wsTransport.clearCachedData(BRAIN_WORKSPACE_ID);
  }, []);

  // ── Brain agent chat (shared workspace machinery, pointed at "brain") ──
  // The conversation column (chat, sessions, tabs, tasks, queue) is shared with
  // WorkspaceView via useConversationColumn.
  const {
    messages,
    isStreaming,
    streamingStartedAt,
    currentStreamingText,
    currentThinking,
    activeToolCalls,
    activeAgentActivities,
    pendingToolInputs,
    connectionStatus,
    error,
    sessionId,
    sendMessage,
    stopStreaming,
    answerQuestion,
    batchAnswerQuestions,
    rejectToolInput,
    agentPlanMode,
    switchCounter,
    // Tabs
    openFile,
    fileViewMode,
    diffScope,
    isFileTabActive,
    activateTab,
    openFileTab,
    openDiffTab,
    setFileViewMode,
    setDiffScope,
    closeFileTab,
    // Sessions
    sessions,
    effectiveLockedProvider,
    // Tasks + background agents
    tasks,
    currentTask,
    taskCounts,
    backgroundAgents,
    backgroundRunningCount: bgRunningCount,
    // Queue + scroll
    queuedMessage,
    setQueuedMessage,
    scrollToBottomTrigger,
    bumpScrollToBottom,
    // Handlers
    handleCreateSession,
    handleActivateSession,
    handleDeleteSession,
  } = useConversationColumn(BRAIN_WORKSPACE_ID, { onLastSessionDeleted });

  const liveData = useWorkspaceLiveDataContext();

  const supportsRendered = openFile ? isMarkdownFilePath(openFile) : false;
  // Default to Rendered: notes are for reading; switching to Raw enables editing.
  const [renderMode, setRenderMode] = useState<"raw" | "rendered">("rendered");

  // Whether the open file has pending working-tree changes (enables the Diff tab).
  const isFileModified = openFile ? modifiedPaths.has(openFile) : false;

  // Refresh the tree/status/diff/open-file when the Brain agent writes files.
  useBrainChatRefresh(isFileTabActive ? openFile : null);

  // ── Right-column file tree (All tab) ──
  const [sidebarTab, setSidebarTab] = useState<"all" | "modified">("all");
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(DEFAULT_EXPANDED);
  // Initialize the expanded set once when the tree first loads.
  const initializedRef = useRef(false);
  useEffect(() => {
    if (initializedRef.current || !fileTreeQuery.data) return;
    initializedRef.current = true;
    setExpandedPaths(buildInitialExpanded(fileTreeQuery.data));
  }, [fileTreeQuery.data]);

  // Refs for the inline diff → chat input bridge.
  const chatInputRef = useRef<ChatInputHandle>(null);
  const diffViewerRef = useRef<InlineDiffViewerHandle>(null);

  // Inline diff state — reuse the same persisted style key as WorkspaceView.
  const [diffStyle, setDiffStyle] = useState<"split" | "unified">(() => {
    const stored = localStorage.getItem("diff-style");
    return stored === "split" ? "split" : "unified";
  });
  const handleDiffStyleChange = useCallback((style: "split" | "unified") => {
    setDiffStyle(style);
    localStorage.setItem("diff-style", style);
  }, []);
  const [diffCommentCount, setDiffCommentCount] = useState(0);

  // ── Save flow (commit + push) ──
  const [reviewOpen, setReviewOpen] = useState(false);
  const [saveIndicator, setSaveIndicator] = useState<BrainSaveIndicator>("idle");
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  const handleConfirmSave = useCallback(
    async (message: string) => {
      setSaveIndicator("saving");
      try {
        const result = await save(message || undefined);
        if (result.committed && !result.pushed) {
          setSaveIndicator("push-failed");
        } else {
          setSaveIndicator("saved");
          if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
          savedTimerRef.current = setTimeout(() => setSaveIndicator("idle"), 3000);
        }
      } catch {
        setSaveIndicator("push-failed");
      } finally {
        setReviewOpen(false);
      }
    },
    [save],
  );

  // ── File-tree actions ──
  // Opening a file is a discrete action (never happens while typing that file),
  // so invalidate its content key first to defeat the `staleTime: Infinity`
  // cache and show fresh disk content on re-open.
  const handleSelect = useCallback(
    (path: string) => {
      void queryClient.invalidateQueries({ queryKey: brainFileQueryKey(path) });
      openFileTab(path);
    },
    [openFileTab, queryClient],
  );

  // Open a modified file in a diff tab.
  const handleModifiedFileClick = useCallback(
    (path: string) => {
      openDiffTab(path, BRAIN_DIFF_SCOPE);
      setSidebarTab("modified");
    },
    [openDiffTab],
  );

  const handleWriteToDisk = useCallback(
    (path: string, content: string) => {
      // Keep the content cache in sync with edits, optimistically and without a
      // refetch, so the rendered preview and raw<->rendered / source<->diff
      // switches never reset the editor to the stale disk-at-open content.
      // setQueryData pushes exactly what is already on screen, so (unlike an
      // invalidate) it cannot clobber in-flight typing.
      queryClient.setQueryData(brainFileQueryKey(path), { path, content });
      void upsertFile(path, content);
    },
    [queryClient, upsertFile],
  );

  const handleSend = useCallback(
    (
      content: string,
      images?: ImageAttachment[],
      options?: MessageOptions,
      fileMentions?: FileMention[],
    ): boolean => {
      const sent = sendMessage(content, images, options, undefined, fileMentions);
      if (sent) bumpScrollToBottom();
      return sent;
    },
    [sendMessage, bumpScrollToBottom],
  );

  // ── File-view (tab) handlers ──
  const handleFileViewModeChange = useCallback(
    (mode: "source" | "diff") => {
      if (mode === "diff") setDiffScope(BRAIN_DIFF_SCOPE);
      setFileViewMode(mode);
    },
    [setDiffScope, setFileViewMode],
  );

  const handlePasteToPrompt = useCallback(() => {
    diffViewerRef.current?.pasteToPrompt();
  }, []);

  const handleDiffPasteText = useCallback(
    (text: string) => {
      if (sessionId) activateTab(`session:${sessionId}`);
      requestAnimationFrame(() => chatInputRef.current?.appendText(text));
    },
    [sessionId, activateTab],
  );

  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: "hive-brain-v2",
    storage: localStorage,
  });

  if (!loading && !brainConnected) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-background">
        <BrainHeader />
        <div className="flex flex-1 items-center justify-center px-6">
          <p className="text-sm text-muted-foreground">No Brain repository connected.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <Group
        orientation="horizontal"
        defaultLayout={defaultLayout}
        onLayoutChanged={onLayoutChanged}
        style={{ flex: 1, minHeight: 0, overflow: "hidden" }}
      >
        <Panel id="brain-main" minSize="40%">
          <div className="flex min-w-0 h-full flex-col overflow-hidden">
            <BrainHeader />
            <ConversationPane
              sessions={sessions}
              activeSessionId={sessionId}
              isStreaming={isStreaming}
              streamingSessions={liveData[BRAIN_WORKSPACE_ID]?.streamingSessions}
              unreadSessions={liveData[BRAIN_WORKSPACE_ID]?.unreadSessions}
              onCreateSession={handleCreateSession}
              onActivateSession={handleActivateSession}
              onDeleteSession={handleDeleteSession}
              openFile={openFile}
              isFileTabActive={isFileTabActive}
              fileViewMode={fileViewMode}
              onFileTabActivate={() => openFile && activateTab(`file:${openFile}`)}
              onFileTabClose={closeFileTab}
              onConversationActivate={() => sessionId && activateTab(`session:${sessionId}`)}
              messages={messages}
              streamingStartedAt={streamingStartedAt}
              currentStreamingText={currentStreamingText}
              currentThinking={currentThinking}
              activeToolCalls={activeToolCalls}
              activeAgentActivities={activeAgentActivities}
              pendingToolInputs={pendingToolInputs}
              onQuestionAnswer={answerQuestion}
              onFileMentionClick={handleSelect}
              projectName="Brain"
              emptyState={<BrainWelcome notesCount={notesCount} repoUrl={repoUrl} />}
              switchCounter={switchCounter}
              agentPlanMode={agentPlanMode}
              error={error}
              queuedMessage={queuedMessage}
              onClearQueue={() => setQueuedMessage(null)}
              scrollToBottomTrigger={scrollToBottomTrigger}
              tasks={tasks}
              currentTask={currentTask}
              taskCounts={taskCounts}
              backgroundAgents={backgroundAgents}
              backgroundRunningCount={bgRunningCount}
              onBatchAnswerQuestions={batchAnswerQuestions}
              onDismissQuestion={() => rejectToolInput("[question_dismissed]")}
              chatInput={
                <ChatInput
                  ref={chatInputRef}
                  wsId={BRAIN_WORKSPACE_ID}
                  sessionId={sessionId}
                  lockedProvider={effectiveLockedProvider}
                  onSend={handleSend}
                  onStop={stopStreaming}
                  disabled={false}
                  isStreaming={isStreaming}
                  connectionStatus={connectionStatus}
                  messages={messages}
                  queuedMessage={queuedMessage}
                  onQueue={(msg) => {
                    setQueuedMessage(msg);
                    bumpScrollToBottom();
                  }}
                  agentPlanMode={agentPlanMode}
                />
              }
            />
            {isFileTabActive && openFile && (
              <div className="flex min-h-0 flex-1 flex-col">
                <FileContentToolbar
                  filePath={openFile}
                  mode={fileViewMode}
                  onModeChange={handleFileViewModeChange}
                  isModified={isFileModified}
                  diffScope={BRAIN_DIFF_SCOPE}
                  availableDiffScopes={BRAIN_DIFF_SCOPES}
                  onDiffScopeChange={setDiffScope}
                  diffStyle={diffStyle}
                  onDiffStyleChange={handleDiffStyleChange}
                  commentCount={diffCommentCount}
                  onPasteToPrompt={handlePasteToPrompt}
                  supportsRendered={supportsRendered}
                  renderMode={renderMode}
                  onRenderModeChange={setRenderMode}
                />
                {fileViewMode === "source" ? (
                  <FileViewer
                    wsId={BRAIN_WORKSPACE_ID}
                    filePath={openFile}
                    renderMode={renderMode}
                    editable
                    onWriteToDisk={handleWriteToDisk}
                  />
                ) : (
                  <InlineDiffViewer
                    ref={diffViewerRef}
                    wsId={BRAIN_WORKSPACE_ID}
                    filePath={openFile}
                    diffScope={diffScope}
                    diffStyle={diffStyle}
                    onCommentCountChange={setDiffCommentCount}
                    onPasteToPrompt={handleDiffPasteText}
                  />
                )}
              </div>
            )}
          </div>
        </Panel>

        <ResizeHandle orientation="vertical" />

        <Panel id="brain-tree" minSize={220} maxSize={480} defaultSize="25%" className="bg-sidebar">
          <div className="flex h-full flex-col">
            <div className="flex h-12 items-center gap-3 border-b border-border/50 px-4" data-tauri-drag-region>
              <button
                type="button"
                className={cn(
                  "text-xs uppercase tracking-wide transition-colors",
                  sidebarTab === "all"
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => setSidebarTab("all")}
              >
                All
              </button>
              <button
                type="button"
                className={cn(
                  "flex items-center gap-1.5 text-xs uppercase tracking-wide transition-colors",
                  sidebarTab === "modified"
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => setSidebarTab("modified")}
              >
                Modified
                {pendingCount > 0 && (
                  <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                    {pendingCount}
                  </Badge>
                )}
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-3">
              {sidebarTab === "modified" && (
                <ModifiedFileList
                  committed={[]}
                  uncommitted={brainStats}
                  onFileClick={handleModifiedFileClick}
                  activeFile={isFileTabActive && fileViewMode === "diff" ? openFile ?? undefined : undefined}
                  activeScope={isFileTabActive && fileViewMode === "diff" ? BRAIN_DIFF_SCOPE : undefined}
                />
              )}
              {sidebarTab === "all" && fileTreeError && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                  {fileTreeError}
                </div>
              )}
              {sidebarTab === "all" && !fileTreeError && (
                <FileTree
                  expanded={expandedPaths}
                  onExpandedChange={setExpandedPaths}
                  onPathSelect={handleSelect}
                  selectedPath={isFileTabActive ? openFile ?? "" : ""}
                >
                  {brainTree.length ? (
                    renderFileTreeNodes(brainTree)
                  ) : (
                    <div className="px-2 py-1 text-xs text-muted-foreground">No notes yet.</div>
                  )}
                </FileTree>
              )}
            </div>
            {/* Sync: commit + push the whole working tree via the review modal. */}
            <BrainSyncSection
              pendingCount={pendingCount}
              saveIndicator={saveIndicator}
              onSave={() => setReviewOpen(true)}
            />
          </div>
        </Panel>
      </Group>

      {/* Save review modal — commit + push the working tree */}
      <Sheet open={reviewOpen} onOpenChange={setReviewOpen}>
        <SheetContent
          side="right"
          className="w-[min(92vw,860px)] sm:max-w-none p-0 flex flex-col"
        >
          <SheetTitle className="sr-only">Save Brain changes</SheetTitle>
          <SheetDescription className="sr-only">
            Review the working-tree changes that will be committed and pushed.
          </SheetDescription>
          {reviewOpen && (
            <div className="flex h-full min-h-0 flex-col">
              <BrainReviewChanges
                onConfirm={handleConfirmSave}
                onCancel={() => setReviewOpen(false)}
                isSaving={isSaving}
              />
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

/** Slim Brain header: just the title bar (Save moved to the Sync section). */
function BrainHeader() {
  return (
    <div className="flex h-12 items-center gap-2 border-b border-border/50 px-4" data-tauri-drag-region>
      <BrainIcon className="size-4 text-primary" aria-hidden="true" />
      <span className="text-sm font-semibold text-foreground">Brain</span>
    </div>
  );
}

interface BrainSyncSectionProps {
  pendingCount: number;
  saveIndicator: BrainSaveIndicator;
  onSave: () => void;
}

/**
 * Bottom-right Sync panel: the Save button (opens the review modal), the
 * pending-change count badge, and the last-save outcome indicator.
 */
function BrainSyncSection({ pendingCount, saveIndicator, onSave }: BrainSyncSectionProps) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-t border-border/50 px-3">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">Sync</span>
      <div className="ml-auto flex items-center gap-2">
        <SaveStatus indicator={saveIndicator} />
        <Button
          size="sm"
          variant="outline"
          className="cursor-pointer"
          onClick={onSave}
          disabled={pendingCount === 0}
        >
          <CloudUploadIcon className="size-3.5" aria-hidden="true" />
          Save
          {pendingCount > 0 && (
            <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-[10px]">
              {pendingCount}
            </Badge>
          )}
        </Button>
      </div>
    </div>
  );
}

/** Inline indicator for the last git save outcome. */
function SaveStatus({ indicator }: { indicator: BrainSaveIndicator }) {
  if (indicator === "saving") {
    return (
      <span role="status" className="flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
        Saving...
      </span>
    );
  }
  if (indicator === "saved") {
    // Darker greens in light mode for AA contrast; lighter in dark mode.
    return (
      <span role="status" className="flex items-center gap-1 text-xs text-green-700 dark:text-green-400">
        <CheckIcon className="size-3.5" aria-hidden="true" />
        Saved
      </span>
    );
  }
  if (indicator === "push-failed") {
    return (
      <span
        role="status"
        className={cn("flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400")}
      >
        <AlertTriangleIcon className="size-3.5" aria-hidden="true" />
        Push failed
      </span>
    );
  }
  return null;
}
