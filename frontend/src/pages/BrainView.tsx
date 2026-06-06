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
import ChatInput from "@/components/ChatInput";
import { ConversationPane } from "@/components/chat/ConversationPane";
import { BrainWelcome } from "@/components/BrainWelcome";
import { FileViewer } from "@/components/FileViewer";
import { FileContentToolbar } from "@/components/FileContentToolbar";
import { ResizeHandle } from "@/components/ResizeHandle";
import { BrainFileTree } from "@/components/brain/BrainFileTree";
import { BrainReviewChanges } from "@/components/brain/BrainReviewChanges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { wsTransport } from "@/lib/ws-transport";
import { BRAIN_WORKSPACE_ID, brainFileQueryKey } from "@/lib/brain";
import { isMarkdownFilePath } from "@/lib/file-preview";
import { cn } from "@/lib/utils";
import type {
  FileMention,
  ImageAttachment,
  MessageOptions,
  WorkspaceFileTreeNode,
} from "@/types";

/** Outcome indicator for the last git save. */
type BrainSaveIndicator = "idle" | "saving" | "saved" | "push-failed";

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

/**
 * Brain page. Mirrors the Workspace layout: a main column (agent chat with a
 * file-tab takeover via the shared {@link FileViewer}) on the left and the notes
 * file tree on the right. Clicking a note opens it in a file tab that takes over
 * the chat area; editing is only possible in Raw (the shared FileViewer only
 * edits raw Markdown). Save commits + pushes the whole working tree via a review
 * modal — distinct from the debounced disk writes made while editing.
 */
export default function BrainView() {
  const { brain, loading } = useBrain();
  const brainConnected = brain.exists;

  const queryClient = useQueryClient();
  const fileTreeQuery = useBrainFileTree();
  const statusQuery = useBrainStatus();
  const { upsertFile, deleteFile, renameFile } = useBrainFileMutations();
  const { save, isSaving } = useBrainSave();

  const pendingCount = statusQuery.data?.count ?? 0;

  const notesCount = useMemo(
    () => countFiles(fileTreeQuery.data ?? []),
    [fileTreeQuery.data],
  );
  const repoUrl = brain.exists ? brain.repoUrl : undefined;

  const onLastSessionDeleted = useCallback(() => {
    wsTransport.clearCachedData(BRAIN_WORKSPACE_ID);
  }, []);

  // ── Brain agent chat (shared workspace machinery, pointed at "brain") ──
  // The conversation column (chat, sessions, tabs, tasks, queue) is shared with
  // WorkspaceView via useConversationColumn. Brain ignores the diff-tab parts.
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
    // Tabs (source-only; the Brain has no per-file diff)
    openFile,
    fileViewMode,
    isFileTabActive,
    activateTab,
    openFileTab,
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

  // Refresh the tree/status/open-file when the Brain agent writes files.
  useBrainChatRefresh(isFileTabActive ? openFile : null);

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

  // ── Tree actions ──
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

  const handleCreate = useCallback(
    async (path: string) => {
      await upsertFile(path, "");
      void queryClient.invalidateQueries({ queryKey: brainFileQueryKey(path) });
      openFileTab(path);
    },
    [upsertFile, openFileTab, queryClient],
  );

  const handleRename = useCallback(
    async (from: string, to: string) => {
      await renameFile({ from, to });
      if (openFile === from) handleSelect(to);
    },
    [renameFile, openFile, handleSelect],
  );

  const handleDelete = useCallback(
    async (path: string) => {
      await deleteFile(path);
      if (openFile === path) closeFileTab();
    },
    [deleteFile, openFile, closeFileTab],
  );

  const handleWriteToDisk = useCallback(
    (path: string, content: string) => {
      void upsertFile(path, content);
    },
    [upsertFile],
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

  // New layout id: the old "hive-brain" layout had three panels.
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: "hive-brain-v2",
    storage: localStorage,
  });

  if (!loading && !brainConnected) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-background">
        <BrainHeader pendingCount={0} saveIndicator="idle" onSave={() => {}} saveDisabled />
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
            <BrainHeader
              pendingCount={pendingCount}
              saveIndicator={saveIndicator}
              onSave={() => setReviewOpen(true)}
              saveDisabled={pendingCount === 0}
            />
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
                  mode="source"
                  onModeChange={() => {}}
                  showSourceDiffToggle={false}
                  supportsRendered={supportsRendered}
                  renderMode={renderMode}
                  onRenderModeChange={setRenderMode}
                />
                <FileViewer
                  wsId={BRAIN_WORKSPACE_ID}
                  filePath={openFile}
                  renderMode={renderMode}
                  editable
                  onWriteToDisk={handleWriteToDisk}
                />
              </div>
            )}
          </div>
        </Panel>

        <ResizeHandle orientation="vertical" />

        <Panel id="brain-tree" minSize={220} maxSize={480} defaultSize="25%" className="bg-sidebar">
          <BrainFileTree
            nodes={fileTreeQuery.data ?? []}
            selectedPath={isFileTabActive ? openFile ?? "" : ""}
            error={fileTreeQuery.error?.message ?? null}
            onSelect={handleSelect}
            onCreate={handleCreate}
            onRename={handleRename}
            onDelete={handleDelete}
          />
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

interface BrainHeaderProps {
  pendingCount: number;
  saveIndicator: BrainSaveIndicator;
  onSave: () => void;
  saveDisabled: boolean;
}

/** Slim Brain header: title + save indicator + Save button (opens the review modal). */
function BrainHeader({ pendingCount, saveIndicator, onSave, saveDisabled }: BrainHeaderProps) {
  return (
    <div className="flex h-12 items-center gap-2 border-b border-border/50 px-4" data-tauri-drag-region>
      <BrainIcon className="size-4 text-primary" aria-hidden="true" />
      <span className="text-sm font-semibold text-foreground">Brain</span>
      <div className="ml-auto flex items-center gap-2">
        <SaveStatus indicator={saveIndicator} />
        <Button
          size="sm"
          variant="outline"
          className="cursor-pointer"
          onClick={onSave}
          disabled={saveDisabled}
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

/** Inline indicator for the last git save outcome (moved from BrainEditorPanel). */
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
