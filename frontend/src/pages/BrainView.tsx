import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Group, Panel, useDefaultLayout } from "react-resizable-panels";
import { BrainIcon, CloudUploadIcon } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useBrain } from "@/hooks/useBrain";
import {
  useBrainFileMutations,
  useBrainFileTree,
  useBrainRefresh,
} from "@/hooks/useBrainFiles";
import { useBrainSave, useBrainStatus } from "@/hooks/useBrainGit";
import { useBrainChatRefresh } from "@/hooks/useBrainChatRefresh";
import { useConversationColumn } from "@/hooks/useConversationColumn";
import {
  useClearUnread,
  useWorkspaceLiveDataContext,
} from "@/contexts/WorkspaceLiveDataContext";
import ChatInput, { type ChatInputHandle } from "@/components/ChatInput";
import { ConversationPane } from "@/components/chat/ConversationPane";
import { CenterCard } from "@/components/CenterCard";
import { PageHeader } from "@/components/AppLayout";
import { BrainWelcome } from "@/components/BrainWelcome";
import { type FileViewerHandle } from "@/components/FileViewer";
import { FileTabView } from "@/components/FileTabView";
import { FileTree, renderFileTreeNodes } from "@/components/ai-elements/file-tree";
import { PathCopyButton } from "@/components/PathCopyButton";
import { OpenTargetDropdown } from "@/components/OpenTargetDropdown";
import { FileBrowserHeader } from "@/components/FileBrowserHeader";
import { BranchLabel } from "@/components/BranchLabel";
import { ModifiedFileList } from "@/components/diff/ModifiedFileList";
import { ResizeHandle } from "@/components/ResizeHandle";
import { Badge } from "@/components/ui/badge";
import { wsTransport } from "@/lib/ws-transport";
import { BRAIN_WORKSPACE_ID, brainFileQueryKey } from "@/lib/brain";
import { removeCachedSessionMessages } from "@/hooks/useSessionMessages";
import { buildInitialExpanded, countFiles, DEFAULT_EXPANDED } from "@/lib/file-tree";
import { formatAbsoluteTime, formatRelativeTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import type {
  DiffFileStat,
  DiffScope,
  FileMention,
  ImageAttachment,
  MessageOptions,
} from "@/types";

/** Outcome indicator for the last git save. */
type BrainSaveIndicator = "idle" | "saving" | "saved" | "push-failed";

/** The Brain's single working-tree diff scope (it has no branch commits). */
const BRAIN_DIFF_SCOPE: DiffScope = "uncommitted";
const BRAIN_DIFF_SCOPES: DiffScope[] = [BRAIN_DIFF_SCOPE];

/**
 * Brain page. Mirrors the Workspace layout: a main column (agent chat with a
 * file-tab takeover via the shared {@link FileTabView})
 * on the left and a shared file browser on the right with "All" (tree) and
 * "Modified" (pending-change list) tabs — the same components WorkspaceView uses.
 * Clicking a note opens it in a source tab; clicking a modified file opens a
 * diff tab. Editing happens in the Raw source view (debounced disk writes); the
 * Sync section (bottom-right) commits + pushes the whole working tree directly
 * (no review modal). The Brain has no note-management UI (no create/rename/delete).
 */
export default function BrainView() {
  const { brain, loading } = useBrain();
  const brainConnected = brain.exists;

  const queryClient = useQueryClient();
  const fileTreeQuery = useBrainFileTree();
  const statusQuery = useBrainStatus();
  const { upsertFile } = useBrainFileMutations();
  const { save, isSaving } = useBrainSave();
  const isRefreshingFiles = fileTreeQuery.isFetching || statusQuery.isFetching;

  const pendingCount = statusQuery.data?.count ?? 0;
  const unpushedCommitCount = statusQuery.data?.unpushedCommitCount ?? 0;
  const lastSyncedAt = statusQuery.data?.lastSyncedAt ?? (brain.exists ? brain.lastSyncedAt : undefined);
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
  const repoPath = brain.exists ? brain.repoPath : undefined;
  const brainUpstream = statusQuery.data?.upstream ?? null;

  const onLastSessionDeleted = useCallback(() => {
    wsTransport.clearCachedData(BRAIN_WORKSPACE_ID);
    removeCachedSessionMessages(queryClient, BRAIN_WORKSPACE_ID);
  }, [queryClient]);

  const clearUnread = useClearUnread();

  // Clear the per-session unread badge when a Brain session is activated.
  const onActivateSession = useCallback(
    (targetSessionId: string) => {
      clearUnread(BRAIN_WORKSPACE_ID, targetSessionId);
    },
    [clearUnread],
  );

  // ── Brain agent chat (shared workspace machinery, pointed at "brain") ──
  // The conversation column (chat, sessions, tabs, tasks, queue) is shared with
  // WorkspaceView via useConversationColumn.
  const {
    messages,
    isHistoryLoading,
    isHistoryError,
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
    activeSession,
    sessionsLoading,
    // Tasks + background agents
    tasks,
    currentTask,
    taskCounts,
    taskTrackerStatus,
    goal,
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
  } = useConversationColumn(BRAIN_WORKSPACE_ID, { onActivateSession, onLastSessionDeleted });

  const liveData = useWorkspaceLiveDataContext();

  // Clear unread only when the active conversation is actually visible. While a
  // file tab is open, keep unread so the conversation tab can still show a dot.
  useEffect(() => {
    if (isFileTabActive) return;
    if (sessionId && liveData[BRAIN_WORKSPACE_ID]?.unreadSessions?.[sessionId]) {
      clearUnread(BRAIN_WORKSPACE_ID, sessionId);
    }
  }, [isFileTabActive, sessionId, liveData, clearUnread]);

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

  // Refs shared with the chat input (diff paste) and the editable note viewer
  // (Save flushes its pending debounced write before committing).
  const chatInputRef = useRef<ChatInputHandle>(null);
  const fileViewerRef = useRef<FileViewerHandle>(null);
  const refreshBrain = useBrainRefresh(isFileTabActive ? openFile : null);
  const refreshBrainWorkingTree = useBrainRefresh(null);
  const handleRefreshBrain = useCallback(() => {
    void (async () => {
      // A failed disk flush must not block the explicit refresh the user asked
      // for, nor surface as an unhandled rejection. Do not refresh the open file
      // content after a failed flush: refetching it can replace unsaved editor text.
      try {
        await fileViewerRef.current?.flushPendingWrite();
        refreshBrain();
      } catch (error) {
        console.error("Failed to flush pending Brain note write before refresh", error);
        refreshBrainWorkingTree();
      }
    })();
  }, [refreshBrain, refreshBrainWorkingTree]);

  // ── Save flow (commit + push directly, no review modal) ──
  const [saveIndicator, setSaveIndicator] = useState<BrainSaveIndicator>("idle");
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  const handleSave = useCallback(async () => {
    setSaveIndicator("saving");
    try {
      await fileViewerRef.current?.flushPendingWrite();
      // No message → backend uses its default `Brain update <timestamp>`.
      const result = await save(undefined);
      if (result.error || (result.committed && !result.pushed)) {
        setSaveIndicator("push-failed");
      } else {
        setSaveIndicator("saved");
        if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
        savedTimerRef.current = setTimeout(() => setSaveIndicator("idle"), 3000);
      }
    } catch {
      setSaveIndicator("push-failed");
    }
  }, [save]);

  // Single at-a-glance sync state: the status query lifecycle folded together
  // with the save outcome (see deriveBrainSyncState for precedence).
  const syncState = deriveBrainSyncState({
    statusLoading: statusQuery.isLoading,
    statusError: statusQuery.isError,
    saveIndicator,
    pendingCount,
    unpushedCommitCount,
  });

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
      return upsertFile(path, content);
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

  const handleFocusConversation = useCallback(() => {
    if (sessionId) activateTab(`session:${sessionId}`);
  }, [sessionId, activateTab]);

  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: "hive-brain",
    storage: localStorage,
  });

  if (!loading && !brainConnected) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <BrainHeader path={repoPath} upstream={brainUpstream} />
        <div className="flex flex-1 items-center justify-center px-6">
          <p className="text-sm text-muted-foreground">No Brain repository connected.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <Group
        orientation="horizontal"
        defaultLayout={defaultLayout}
        onLayoutChanged={onLayoutChanged}
        style={{ flex: 1, minHeight: 0, overflow: "hidden" }}
      >
        <Panel id="brain-main" minSize="40%">
          <div className="flex min-w-0 h-full flex-col overflow-hidden">
            <BrainHeader path={repoPath} upstream={brainUpstream} />
            <CenterCard>
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
              isHistoryLoading={isHistoryLoading}
              isHistoryError={isHistoryError}
              streamingStartedAt={streamingStartedAt}
              currentStreamingText={currentStreamingText}
              currentThinking={currentThinking}
              activeToolCalls={activeToolCalls}
              activeAgentActivities={activeAgentActivities}
              pendingToolInputs={pendingToolInputs}
              onQuestionAnswer={answerQuestion}
              onFileMentionClick={handleSelect}
              activeProvider={effectiveLockedProvider}
              projectName="Brain"
              emptyState={<BrainWelcome notesCount={notesCount} repoUrl={repoUrl} />}
              switchCounter={switchCounter}
              agentPlanMode={agentPlanMode}
              error={error}
              queuedMessage={queuedMessage}
              onClearQueue={() => setQueuedMessage(null)}
              scrollToBottomTrigger={scrollToBottomTrigger}
              goal={goal}
              tasks={tasks}
              currentTask={currentTask}
              taskCounts={taskCounts}
              taskTrackerStatus={taskTrackerStatus}
              backgroundAgents={backgroundAgents}
              backgroundRunningCount={bgRunningCount}
              onBatchAnswerQuestions={batchAnswerQuestions}
              onDismissQuestion={() => rejectToolInput("[question_dismissed]")}
              chatInput={
                // Mount only once sessions have settled so lastRunOptions can
                // seed the controls. Key by switchCounter (bumped only on an
                // explicit session/workspace switch) rather than the raw sessionId:
                // a new conversation adopts its backend id on first send
                // (undefined -> realId), and keying on sessionId would remount and
                // re-seed the composer mid-turn, snapping the user's thinking level
                // back to the default. switchCounter still remounts on real switches.
                sessionsLoading ? null : (
                <ChatInput
                  key={`${BRAIN_WORKSPACE_ID}:${switchCounter}`}
                  ref={chatInputRef}
                  wsId={BRAIN_WORKSPACE_ID}
                  sessionId={sessionId}
                  lockedProvider={effectiveLockedProvider}
                  lastRunOptions={activeSession?.lastRunOptions}
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
                )
              }
            />
            {isFileTabActive && openFile && (
              <FileTabView
                wsId={BRAIN_WORKSPACE_ID}
                filePath={openFile}
                fileViewMode={fileViewMode}
                onFileViewModeChange={handleFileViewModeChange}
                isModified={isFileModified}
                diffScope={diffScope}
                availableDiffScopes={BRAIN_DIFF_SCOPES}
                onDiffScopeChange={setDiffScope}
                renderMode={renderMode}
                onRenderModeChange={setRenderMode}
                chatInputRef={chatInputRef}
                onFocusConversation={handleFocusConversation}
                editable
                onWriteToDisk={handleWriteToDisk}
                fileViewerRef={fileViewerRef}
              />
            )}
            </CenterCard>
          </div>
        </Panel>

        <ResizeHandle orientation="vertical" cardSide="left" />

        <Panel id="brain-tree" minSize={220} maxSize={480} defaultSize="25%" className="bg-sidebar">
          <div className="flex h-full flex-col">
            <FileBrowserHeader
              activeTab={sidebarTab}
              onTabChange={setSidebarTab}
              modifiedCount={pendingCount}
              onRefresh={handleRefreshBrain}
              isRefreshing={isRefreshingFiles}
            />
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
            {/* Sync: commit + push the whole working tree directly. */}
            <BrainSyncSection
              pendingCount={pendingCount}
              unpushedCommitCount={unpushedCommitCount}
              lastSyncedAt={lastSyncedAt}
              syncState={syncState}
              isSaving={isSaving}
              onSave={handleSave}
            />
          </div>
        </Panel>
      </Group>
    </div>
  );
}

/**
 * Slim Brain header: title + the upstream tracking ref (e.g. "origin/main") +
 * copy-path action. Save lives in the Sync section, not here.
 */
function BrainHeader({
  path,
  upstream,
}: {
  path?: string;
  upstream?: string | null;
}) {
  return (
    <PageHeader className="gap-2">
      <BrainIcon className="size-4 text-primary" aria-hidden="true" />
      <span className="shrink-0 text-sm font-semibold text-foreground">Brain</span>
      <div className="flex min-w-0 items-center gap-1">
        {upstream && (
          <BranchLabel branch={upstream} showIcon={false} className="text-xs text-muted-foreground" />
        )}
        <PathCopyButton
          path={path ?? ""}
          disabledReason="Brain path unavailable. Connect a Brain repository first."
          label="Brain path"
        />
      </div>
      <div className="ml-auto">
        <OpenTargetDropdown
          path={path}
          pathUnavailableReason="Brain path unavailable. Connect a Brain repository first."
        />
      </div>
    </PageHeader>
  );
}

/** Consolidated at-a-glance Brain sync state shown as a colored dot + label. */
type BrainSyncState =
  | "loading"
  | "error"
  | "saving"
  | "push-failed"
  | "saved"
  | "pending"
  | "unpushed"
  | "synced";

/**
 * Resolve the single sync state from the status query lifecycle + save outcome.
 * Precedence: an in-flight/failed save wins over the status query, then the
 * query's own loading/error, then the transient "saved" flash, then pending vs.
 * clean. Amber = unsaved work, green = backed up.
 */
function deriveBrainSyncState(args: {
  statusLoading: boolean;
  statusError: boolean;
  saveIndicator: BrainSaveIndicator;
  pendingCount: number;
  unpushedCommitCount: number | null;
}): BrainSyncState {
  const { statusLoading, statusError, saveIndicator, pendingCount, unpushedCommitCount } = args;
  if (saveIndicator === "saving") return "saving";
  if (saveIndicator === "push-failed") return "push-failed";
  if (statusError) return "error";
  if (statusLoading) return "loading";
  if (saveIndicator === "saved") return "saved";
  if (pendingCount > 0) return "pending";
  if ((unpushedCommitCount ?? 0) > 0) return "unpushed";
  return "synced";
}

/**
 * Dot color + label + text color per state, all from theme tokens. Color is
 * reserved for states that need attention (warning) or are in flight (primary):
 * the resting "all good" states stay muted. Dots pulse during an operation.
 */
const BRAIN_SYNC_STATE_META: Record<
  BrainSyncState,
  { label: string; dotClass: string; textClass: string; pulse?: boolean }
> = {
  loading: {
    label: "Loading…",
    dotClass: "bg-muted-foreground/50",
    textClass: "text-muted-foreground",
    pulse: true,
  },
  error: {
    label: "Status unavailable",
    dotClass: "bg-destructive",
    textClass: "text-destructive",
  },
  saving: {
    label: "Saving…",
    dotClass: "bg-primary",
    textClass: "text-primary",
    pulse: true,
  },
  "push-failed": {
    label: "Push failed",
    dotClass: "bg-warning",
    textClass: "text-warning-foreground",
  },
  saved: {
    label: "Saved",
    dotClass: "bg-primary",
    textClass: "text-primary",
  },
  pending: {
    label: "Unsaved changes",
    dotClass: "bg-warning",
    textClass: "text-warning-foreground",
  },
  unpushed: {
    label: "Not pushed",
    dotClass: "bg-warning",
    textClass: "text-warning-foreground",
  },
  synced: {
    label: "Up to date",
    dotClass: "bg-muted-foreground/60",
    textClass: "text-muted-foreground",
  },
};

interface BrainSyncSectionProps {
  pendingCount: number;
  unpushedCommitCount: number | null;
  lastSyncedAt?: string;
  syncState: BrainSyncState;
  isSaving: boolean;
  onSave: () => void;
}

/**
 * Bottom-right Sync line: the live sync state (colored dot + label) on the left
 * for at-a-glance status, and an inline Save action (commits + pushes directly)
 * on the right — mirrors the workspace PR status line. Disabled while a save is
 * in flight or when there is nothing to commit.
 */
function BrainSyncSection({
  pendingCount,
  unpushedCommitCount,
  lastSyncedAt,
  syncState,
  isSaving,
  onSave,
}: BrainSyncSectionProps) {
  const meta = BRAIN_SYNC_STATE_META[syncState];
  const canSave = pendingCount > 0 || (unpushedCommitCount ?? 0) > 0;
  const lastSyncLabel = lastSyncedAt
    ? `Last synced ${formatRelativeTime(lastSyncedAt)}`
    : "Never synced";
  const lastSyncTitle = lastSyncedAt
    ? `Last successful sync: ${formatAbsoluteTime(lastSyncedAt)}`
    : "No successful Brain sync recorded yet";

  return (
    <div className="flex shrink-0 flex-col border-t border-border/50 px-3 py-2">
      <div className="flex items-center gap-2">
        <span role="status" className={cn("flex min-w-0 items-center gap-1.5 text-xs font-medium", meta.textClass)}>
          <span
            className={cn("size-1.5 shrink-0 rounded-full", meta.dotClass, meta.pulse && "animate-pulse")}
            aria-hidden="true"
          />
          <span className="truncate">{meta.label}</span>
        </span>
        <button
          type="button"
          onClick={onSave}
          disabled={!canSave || isSaving}
          className={cn(
            "ml-auto flex shrink-0 cursor-pointer items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground",
            // Dim the whole button (icon + label + count badge) together when disabled.
            "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:text-muted-foreground",
          )}
        >
          <CloudUploadIcon className="size-3.5 shrink-0" aria-hidden="true" />
          Save
          {pendingCount > 0 && (
            <Badge variant="secondary" className="ml-0.5 px-1.5 py-0 text-[10px]">
              {pendingCount}
            </Badge>
          )}
        </button>
      </div>
      <div
        className="mt-1 min-w-0 truncate pl-3 text-[11px] leading-none text-muted-foreground"
        title={lastSyncTitle}
      >
        {lastSyncLabel}
      </div>
    </div>
  );
}
