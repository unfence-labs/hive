import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Navigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Group, Panel, useDefaultLayout, usePanelRef } from "react-resizable-panels";
import { api } from "@/hooks/useApi";
import { useConversationColumn } from "@/hooks/useConversationColumn";
import { removeCachedSessionMessages } from "@/hooks/useSessionMessages";
import { useWorkspaceLiveDataContext, useClearUnread } from "@/contexts/WorkspaceLiveDataContext";

import { FileTree, renderFileTreeNodes } from "@/components/ai-elements/file-tree";
import ChatInput, { type ChatInputHandle } from "@/components/ChatInput";
import { ConversationPane } from "@/components/chat/ConversationPane";
import { TerminalPane } from "@/components/TerminalPane";
import { FileTabView } from "@/components/FileTabView";
import { BranchLabel } from "@/components/BranchLabel";
import { ModifiedFileList } from "@/components/diff/ModifiedFileList";
import { PrStatusSection } from "@/components/PrStatusSection";
import { BrowserPanel } from "@/components/BrowserPanel";
import ScriptPanel from "@/components/ScriptPanel";
import { Skeleton } from "@/components/ui/skeleton";
import { OpenTargetDropdown } from "@/components/OpenTargetDropdown";
import { FileBrowserHeader } from "@/components/FileBrowserHeader";
import { PageHeader } from "@/components/AppLayout";
import { CenterCard } from "@/components/CenterCard";
import { ResizeHandle } from "@/components/ResizeHandle";
import { PathCopyButton } from "@/components/PathCopyButton";
import { wsTransport } from "@/lib/ws-transport";
import { hasPendingExitPlanModeInput, isPlanAwaitingUserInput, findPlanContent } from "@/lib/plan-state";
import { buildInitialExpanded, countFiles, DEFAULT_EXPANDED, findFirstFilePath } from "@/lib/file-tree";
import { PlanActionBar } from "@/components/chat/PlanActionBar";
import { useScripts } from "@/hooks/useScripts";
import type { DiffFileStat, DiffScope, DiffStatResponse, FileMention, ImageAttachment, MessageOptions, Workspace, WorkspaceFileTreeNode } from "@/types";

function matchesDiffStat(filePath: string | null | undefined, stat: DiffFileStat): boolean {
  return !!filePath && (stat.file === filePath || filePath.endsWith(`/${stat.file}`));
}

export default function WorkspaceView() {
  const { wsId } = useParams();
  const queryClient = useQueryClient();

  // Server data via TanStack Query
  const workspaceQuery = useQuery({
    queryKey: ["workspace", wsId],
    queryFn: () => api.get<Workspace>(`/api/workspaces/${wsId}`),
    enabled: !!wsId,
  });
  const filesQuery = useQuery({
    queryKey: ["files", wsId],
    queryFn: () => api.get<WorkspaceFileTreeNode[]>(`/api/workspaces/${wsId}/files`),
    enabled: !!wsId,
  });
  const diffStatQuery = useQuery({
    queryKey: ["diff-stat", wsId],
    queryFn: () => api.get<DiffStatResponse>(`/api/workspaces/${wsId}/diff/stat`),
    enabled: !!wsId,
  });

  const workspace = workspaceQuery.data ?? null;
  const workspacePath = workspace?.worktreePath?.trim() ?? "";
  const fileTree = useMemo(() => filesQuery.data ?? [], [filesQuery.data]);
  const fileTreeError = filesQuery.error?.message ?? null;
  const initialDiffStats = diffStatQuery.data ?? null;

  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(DEFAULT_EXPANDED);
  const [selectedPath, setSelectedPath] = useState("");
  const [manualDiffStats, setManualDiffStats] = useState<DiffStatResponse | null>(null);

  // Sidebar tab state
  const [sidebarTab, setSidebarTab] = useState<"all" | "modified">("all");

  // Live data via WebSocket (branch + diff stats)
  const liveData = useWorkspaceLiveDataContext();
  const clearUnread = useClearUnread();
  const liveDiffStats = wsId ? liveData[wsId]?.diffStats : undefined;


  const displayBranch = (wsId && liveData[wsId]?.branch) || workspace?.branch;

  const copyWorkspacePathDisabledReason = "Workspace path unavailable. Restart backend and reload this workspace.";

  // Manual file-browser refresh: reload the tree + diff stats on demand.
  const handleRefreshFiles = useCallback(async () => {
    if (!wsId) return;

    void queryClient.invalidateQueries({ queryKey: ["files", wsId] });
    void queryClient.invalidateQueries({ queryKey: ["file-completions", wsId] });

    const result = await diffStatQuery.refetch();
    if (result.data) {
      setManualDiffStats(result.data);
    } else if (result.error) {
      // Refetch resolves (does not throw) on failure; without fresh data the
      // view keeps the last live/initial stats, so log so it isn't fully silent.
      console.error("Failed to refresh workspace diff stats", result.error);
    }
  }, [diffStatQuery, queryClient, wsId]);
  const isRefreshingFiles = filesQuery.isFetching || diffStatQuery.isFetching;

  useEffect(() => {
    setManualDiffStats(null);
  }, [wsId]);

  useEffect(() => {
    if (liveDiffStats) setManualDiffStats(null);
  }, [liveDiffStats]);

  // Diff stats from WebSocket polling
  const diffCommitted = useMemo(
    () =>
      manualDiffStats?.committed ??
      liveDiffStats?.committed ??
      initialDiffStats?.committed ??
      [],
    [manualDiffStats, liveDiffStats, initialDiffStats],
  );
  const diffUncommitted = useMemo(
    () =>
      manualDiffStats?.uncommitted ??
      liveDiffStats?.uncommitted ??
      initialDiffStats?.uncommitted ??
      [],
    [manualDiffStats, liveDiffStats, initialDiffStats],
  );
  const diffTotalCount = useMemo(() => {
    const files = new Set<string>();
    for (const f of diffCommitted) files.add(f.file);
    for (const f of diffUncommitted) files.add(f.file);
    return files.size;
  }, [diffCommitted, diffUncommitted]);

  const fileCount = useMemo(() => countFiles(fileTree), [fileTree]);

  // Initialize expanded paths and selected file when file tree first loads for a wsId
  const initializedWsRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!wsId || !filesQuery.data || initializedWsRef.current === wsId) return;
    initializedWsRef.current = wsId;
    setExpandedPaths(buildInitialExpanded(filesQuery.data));
    const firstFilePath = findFirstFilePath(filesQuery.data);
    setSelectedPath(firstFilePath ?? "");
  }, [wsId, filesQuery.data]);

  const onLastSessionDeleted = useCallback(() => {
    if (wsId) {
      wsTransport.clearCachedData(wsId);
      removeCachedSessionMessages(queryClient, wsId);
    }
    void queryClient.invalidateQueries({ queryKey: ["workspace", wsId] });
  }, [wsId, queryClient]);

  const onActivateSession = useCallback(
    (targetSessionId: string) => {
      if (wsId) clearUnread(wsId, targetSessionId);
    },
    [wsId, clearUnread],
  );

  const {
    messages,
    isHistoryLoading,
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
    switchSession,
    answerQuestion,
    batchAnswerQuestions,
    approvePlan,
    rejectToolInput,
    dismissPlan,
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
    createSession,
    refreshSessions,
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
    handleStartTerminal,
  } = useConversationColumn(wsId, { onActivateSession, onLastSessionDeleted });

  const [renderMode, setRenderMode] = useState<"raw" | "rendered">("raw");

  // Clear unread only when the active conversation is actually visible.
  // If the file tab is open, keep unread state so the tab can show a dot.
  useEffect(() => {
    if (isFileTabActive) return;
    if (wsId && sessionId && liveData[wsId]?.unreadSessions?.[sessionId]) {
      clearUnread(wsId, sessionId);
    }
  }, [isFileTabActive, wsId, sessionId, liveData, clearUnread]);

  // Scripts (hive.json setup/run)
  const {
    config: scriptsConfig,
    status: scriptsStatus,
    startScript,
    stopScript,
    startTerminal,
    stopTerminal,
    connectOutput: connectScriptOutput,
    disconnectOutput: disconnectScriptOutput,
  } = useScripts(wsId);

  // ── Resizable panels ──
  const rightPanelRef = usePanelRef();
  const [browserPanelCollapsed, setBrowserPanelCollapsed] = useState(false);
  const [browserPanelManualOpen, setBrowserPanelManualOpen] = useState(false);
  const { defaultLayout: wsLayout, onLayoutChanged: onWsLayoutChanged } = useDefaultLayout({
    id: "hive-workspace",
    storage: localStorage,
  });
  const { defaultLayout: splitLayout, onLayoutChanged: onSplitLayoutChanged } = useDefaultLayout({
    id: "hive-right-split",
    storage: localStorage,
  });

  // Responsive: collapse right panel below lg breakpoint
  const [isLg, setIsLg] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(min-width: 1024px)").matches : true,
  );
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const handler = (e: MediaQueryListEvent) => setIsLg(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  useEffect(() => {
    if (!isLg) {
      rightPanelRef.current?.collapse();
    } else {
      rightPanelRef.current?.expand();
    }
  }, [isLg, rightPanelRef]);

  const currentBrowserStatus = useMemo(() => {
    if (!wsId || !sessionId) return undefined;
    const status = liveData[wsId]?.browserSessions?.[sessionId];
    if (!status || status.state === "registered" || status.state === "closed") return undefined;
    return status;
  }, [wsId, sessionId, liveData]);

  const browserPanelActive = Boolean(currentBrowserStatus);
  const browserPanelStreaming = Boolean(currentBrowserStatus?.streaming);
  const browserPanelExpanded = browserPanelActive && (
    browserPanelManualOpen || (browserPanelStreaming && !browserPanelCollapsed)
  );

  const handleToggleBrowserPanel = useCallback(() => {
    if (browserPanelExpanded) {
      setBrowserPanelManualOpen(false);
      setBrowserPanelCollapsed(true);
      return;
    }
    setBrowserPanelCollapsed(false);
    setBrowserPanelManualOpen(true);
  }, [browserPanelExpanded]);

  useEffect(() => {
    if (!currentBrowserStatus) {
      setBrowserPanelCollapsed(false);
      setBrowserPanelManualOpen(false);
      return;
    }
    if (currentBrowserStatus.streaming) {
      if (!browserPanelCollapsed) {
        setBrowserPanelManualOpen(true);
      }
      rightPanelRef.current?.expand();
    }
  }, [browserPanelCollapsed, currentBrowserStatus, rightPanelRef]);

  const handleFileTreeSelect = useCallback((path: string) => {
    setSelectedPath(path);
    openFileTab(path);
  }, [openFileTab]);

  const handleModifiedFileClick = useCallback((filePath: string, scope: DiffScope) => {
    setSelectedPath(filePath);
    openDiffTab(filePath, scope);
    setSidebarTab("modified");
  }, [openDiffTab]);

  const handleHandOff = useCallback(async (planContent: string, planPath?: string) => {
    dismissPlan("Plan handed off to a new session.");
    const meta = await createSession();
    if (!meta) return;
    switchSession(meta.sessionId);
    await refreshSessions();
    const handoffPrompt = planPath
      ? `Execute the approved plan from \`${planPath}\`. Read that file and implement it end-to-end.`
      : `Here is the implementation plan to execute:\n\n${planContent}`;
    sendMessage(handoffPrompt, undefined, undefined, meta.sessionId);
  }, [dismissPlan, createSession, switchSession, refreshSessions, sendMessage]);

  const hasPendingExitPlanInput = hasPendingExitPlanModeInput(pendingToolInputs);
  const hasPendingPlan = isPlanAwaitingUserInput({
    messages,
    isStreaming,
    pendingToolInputs,
  });

  const pendingPlanData = useMemo(() => {
    if (!hasPendingPlan) return undefined;
    // Check active streaming tool calls first
    if (activeToolCalls.some((t) => t.name === "ExitPlanMode")) {
      return findPlanContent(activeToolCalls);
    }
    // Fall back to committed messages
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === "assistant" && msg.toolCalls?.some((t) => t.name === "ExitPlanMode")) {
        return findPlanContent(msg.toolCalls);
      }
    }
    return undefined;
  }, [hasPendingPlan, messages, activeToolCalls]);

  const handleSend = useCallback(
    (content: string, images?: ImageAttachment[], options?: MessageOptions, fileMentions?: FileMention[]): boolean => {
      if (hasPendingPlan && hasPendingExitPlanInput) {
        rejectToolInput(content);
        bumpScrollToBottom();
        return true;
      }
      const sent = sendMessage(content, images, options, undefined, fileMentions);
      if (sent) bumpScrollToBottom();
      return sent;
    },
    [hasPendingPlan, hasPendingExitPlanInput, rejectToolInput, sendMessage, bumpScrollToBottom],
  );

  // Refs for inline diff → chat input bridge
  const chatInputRef = useRef<ChatInputHandle>(null);

  const fileHasUncommittedChanges = useMemo(
    () => diffUncommitted.some((stat) => matchesDiffStat(openFile, stat)),
    [openFile, diffUncommitted],
  );
  const fileHasCommittedChanges = useMemo(
    () => diffCommitted.some((stat) => matchesDiffStat(openFile, stat)),
    [openFile, diffCommitted],
  );
  const isFileModified = fileHasUncommittedChanges || fileHasCommittedChanges;
  const availableDiffScopes = useMemo<DiffScope[]>(() => {
    const scopes: DiffScope[] = [];
    if (fileHasUncommittedChanges) scopes.push("uncommitted");
    if (fileHasCommittedChanges) scopes.push("committed");
    if (fileHasUncommittedChanges && fileHasCommittedChanges) scopes.push("combined");
    return scopes;
  }, [fileHasCommittedChanges, fileHasUncommittedChanges]);
  const defaultDiffScope: DiffScope = fileHasUncommittedChanges ? "uncommitted" : "committed";

  useEffect(() => {
    if (fileViewMode !== "diff" || availableDiffScopes.length === 0) return;
    if (!availableDiffScopes.includes(diffScope)) {
      setDiffScope(defaultDiffScope);
    }
  }, [availableDiffScopes, defaultDiffScope, diffScope, fileViewMode, setDiffScope]);

  const handleFileViewModeChange = useCallback((mode: "source" | "diff") => {
    if (mode === "diff" && availableDiffScopes.length > 0 && !availableDiffScopes.includes(diffScope)) {
      setDiffScope(defaultDiffScope);
    }
    setFileViewMode(mode);
  }, [availableDiffScopes, defaultDiffScope, diffScope, setDiffScope, setFileViewMode]);

  const handleFocusConversation = useCallback(() => {
    if (sessionId) activateTab(`session:${sessionId}`);
  }, [sessionId, activateTab]);

  // Full skeleton on initial load
  if (workspaceQuery.isLoading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  if (workspaceQuery.isSuccess && !workspace) {
    return <Navigate to="/home" replace />;
  }

  if (workspaceQuery.isError) {
    return <Navigate to="/home" replace />;
  }


  return (
    <div className="flex h-full flex-col">
      {/* Chat area + right panel */}
      <Group
        orientation="horizontal"
        defaultLayout={wsLayout}
        onLayoutChanged={onWsLayoutChanged}
        style={{ flex: 1, minHeight: 0, overflow: "hidden" }}
      >
        <Panel id="chat" minSize="40%">
        <div className="flex min-w-0 h-full flex-col overflow-hidden">
          <PageHeader className="gap-2">
            <span className="truncate text-sm font-semibold text-foreground">{workspace?.projectName ?? workspace?.name}</span>
            {displayBranch && (
              <BranchLabel branch={displayBranch} showIcon={false} className="text-xs text-muted-foreground" />
            )}
            <div className="flex min-w-0 items-center gap-1">
              {workspace?.defaultBranch && (
                <span className="truncate text-xs text-muted-foreground/60">{"> origin/"}{workspace.defaultBranch}</span>
              )}
              <PathCopyButton
                path={workspacePath}
                disabledReason={copyWorkspacePathDisabledReason}
                label="Workspace path"
              />
            </div>
            <div className="ml-auto" />
            <OpenTargetDropdown
              path={workspace?.worktreePath}
              pathUnavailableReason={copyWorkspacePathDisabledReason}
            />
          </PageHeader>
          <CenterCard>
          <ConversationPane
            sessions={sessions}
            activeSessionId={sessionId}
            isStreaming={isStreaming}
            streamingSessions={wsId ? liveData[wsId]?.streamingSessions : undefined}
            unreadSessions={wsId ? liveData[wsId]?.unreadSessions : undefined}
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
            streamingStartedAt={streamingStartedAt}
            currentStreamingText={currentStreamingText}
            currentThinking={currentThinking}
            activeToolCalls={activeToolCalls}
            activeAgentActivities={activeAgentActivities}
            pendingToolInputs={pendingToolInputs}
            onQuestionAnswer={answerQuestion}
            onFileMentionClick={handleFileTreeSelect}
            activeProvider={effectiveLockedProvider}
            workspaceName={workspace?.name}
            projectName={workspace?.projectName}
            branch={displayBranch}
            defaultBranch={workspace?.defaultBranch}
            fileCount={fileCount}
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
            onStartTerminal={handleStartTerminal}
            terminalView={
              wsId && sessionId ? (
                <TerminalPane key={sessionId} wsId={wsId} sessionId={sessionId} />
              ) : undefined
            }
            planActionBar={
              hasPendingPlan && pendingPlanData ? (
                <PlanActionBar
                  planContent={pendingPlanData.content}
                  planPath={pendingPlanData.planPath}
                  onApprove={approvePlan}
                  onHandOff={handleHandOff}
                />
              ) : undefined
            }
            chatInput={
              // Mount only once the sessions list has settled so lastRunOptions
              // is available to seed the controls. Key by switchCounter (bumped
              // only on an explicit session/workspace switch) rather than the raw
              // sessionId: a new conversation adopts its backend id on first send
              // (undefined -> realId), and keying on sessionId would remount and
              // re-seed the composer mid-turn, snapping the user's thinking level
              // back to the default. switchCounter still remounts on real switches.
              sessionsLoading ? null : (
              <ChatInput
                key={`${wsId}:${switchCounter}`}
                ref={chatInputRef}
                wsId={wsId}
                sessionId={sessionId}
                lockedProvider={effectiveLockedProvider}
                lastRunOptions={activeSession?.lastRunOptions}
                onSend={handleSend}
                onStop={stopStreaming}
                disabled={false}
                isStreaming={isStreaming}
                connectionStatus={connectionStatus}
                placeholder={hasPendingPlan ? "Enter your plan adjustments here..." : undefined}
                messages={messages}
                queuedMessage={queuedMessage}
                onQueue={(msg) => { setQueuedMessage(msg); bumpScrollToBottom(); }}
                agentPlanMode={agentPlanMode}
              />
              )
            }
          />
          {isFileTabActive && openFile && wsId && (
            <FileTabView
              wsId={wsId}
              filePath={openFile}
              fileViewMode={fileViewMode}
              onFileViewModeChange={handleFileViewModeChange}
              isModified={isFileModified}
              diffScope={diffScope}
              availableDiffScopes={availableDiffScopes}
              onDiffScopeChange={setDiffScope}
              renderMode={renderMode}
              onRenderModeChange={setRenderMode}
              chatInputRef={chatInputRef}
              onFocusConversation={handleFocusConversation}
            />
          )}
          </CenterCard>
        </div>
        </Panel>

        <ResizeHandle orientation="vertical" cardSide="left" disabled={!isLg} className={!isLg ? "hidden" : ""} />

        <Panel
          id="right-sidebar"
          panelRef={rightPanelRef}
          collapsible
          collapsedSize={0}
          minSize={280}
          maxSize={600}
          defaultSize="25%"
          className="bg-sidebar"
        >
          <div className="flex h-full flex-col">
            <FileBrowserHeader
              activeTab={sidebarTab}
              onTabChange={setSidebarTab}
              modifiedCount={diffTotalCount}
              onRefresh={handleRefreshFiles}
              isRefreshing={isRefreshingFiles}
            />
            <Group
              orientation="vertical"
              defaultLayout={splitLayout}
              onLayoutChanged={onSplitLayoutChanged}
              style={{ flex: 1, minHeight: 0, overflow: "hidden" }}
            >
              <Panel id="file-tree" defaultSize={browserPanelExpanded ? "42%" : "50%"} minSize="15%" maxSize="85%">
                <div className="h-full overflow-auto p-3">
                  {sidebarTab === "modified" && (
                    <ModifiedFileList
                      committed={diffCommitted}
                      uncommitted={diffUncommitted}
                      onFileClick={handleModifiedFileClick}
                      activeFile={isFileTabActive && fileViewMode === "diff" ? openFile ?? undefined : undefined}
                      activeScope={isFileTabActive && fileViewMode === "diff" ? diffScope : undefined}
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
                      onPathSelect={handleFileTreeSelect}
                      selectedPath={selectedPath}
                    >
                      {fileTree.length ? (
                        renderFileTreeNodes(fileTree)
                      ) : (
                        <div className="px-2 py-1 text-xs text-muted-foreground">No files found.</div>
                      )}
                    </FileTree>
                  )}
                </div>
              </Panel>
              <ResizeHandle orientation="horizontal" />
              <Panel id="scripts" defaultSize={browserPanelExpanded ? "30%" : undefined} minSize="15%">
                <ScriptPanel
                  key={wsId}
                  config={scriptsConfig}
                  status={scriptsStatus}
                  onStart={startScript}
                  onStop={stopScript}
                  onStartTerminal={startTerminal}
                  onStopTerminal={stopTerminal}
                  onConnectOutput={connectScriptOutput}
                  onDisconnectOutput={disconnectScriptOutput}
                />
              </Panel>
              {browserPanelExpanded && (
                <>
                  <ResizeHandle orientation="horizontal" />
                  <Panel id="browser" defaultSize="28%" minSize="18%" maxSize="48%">
                    <div className="flex h-full min-h-0 flex-col bg-sidebar">
                      <BrowserPanel
                        status={currentBrowserStatus}
                        onToggleCollapsed={handleToggleBrowserPanel}
                      />
                    </div>
                  </Panel>
                </>
              )}
            </Group>
            {!browserPanelExpanded && (
              <div className="bg-sidebar">
                <BrowserPanel
                  status={currentBrowserStatus}
                  collapsed
                  onToggleCollapsed={browserPanelActive ? handleToggleBrowserPanel : undefined}
                />
              </div>
            )}
            <PrStatusSection wsId={wsId} />
          </div>
        </Panel>
      </Group>

    </div>
  );
}
