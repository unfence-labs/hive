import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Navigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Group, Panel, useDefaultLayout, usePanelRef } from "react-resizable-panels";
import { ChevronDownIcon, TerminalIcon } from "lucide-react";
import { VscodeIcon, Iterm2Icon } from "@/components/icons/software-icons";
import { api } from "@/hooks/useApi";
import { useConversation } from "@/hooks/useConversation";
import { useSessions } from "@/hooks/useSessions";
import { useWorkspaceLiveDataContext, useClearUnread } from "@/contexts/WorkspaceLiveDataContext";

import {
  FileTree,
  FileTreeFile,
  FileTreeFolder,
} from "@/components/ai-elements/file-tree";
import ChatConversation from "@/components/ChatConversation";
import ChatInput, { type ChatInputHandle } from "@/components/ChatInput";
import QuestionPanel from "@/components/chat/QuestionPanel";
import { ConversationTabs } from "@/components/ConversationTabs";
import { FileViewer } from "@/components/FileViewer";
import { FileContentToolbar } from "@/components/FileContentToolbar";
import { BranchLabel } from "@/components/BranchLabel";
import { InlineDiffViewer, type InlineDiffViewerHandle } from "@/components/diff/InlineDiffViewer";
import { ModifiedFileList } from "@/components/diff/ModifiedFileList";
import { PrStatusSection } from "@/components/PrStatusSection";
import { BrowserPanel } from "@/components/BrowserPanel";
import ScriptPanel from "@/components/ScriptPanel";
import TaskTracker from "@/components/TaskTracker";
import { useTasks } from "@/hooks/useTasks";
import { useBackgroundAgents } from "@/hooks/useBackgroundAgents";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { openExternal, buildVscodeRemoteUri } from "@/lib/open-external";
import { useTailscaleConfig } from "@/hooks/useTailscaleConfig";
import { useServerUrl } from "@/hooks/useServerUrl";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useTerminalApps } from "@/hooks/useTerminalApps";
import { openTerminalSsh } from "@/lib/terminal";
import { useLayoutContext } from "@/components/AppLayout";
import { ResizeHandle } from "@/components/ResizeHandle";
import { WorkspacePathCopyButton } from "@/components/WorkspacePathCopyButton";
import { cn } from "@/lib/utils";
import { wsTransport } from "@/lib/ws-transport";
import { hasPendingExitPlanModeInput, isPlanAwaitingUserInput, findPlanContent } from "@/lib/plan-state";
import { PlanActionBar } from "@/components/chat/PlanActionBar";
import { useScripts } from "@/hooks/useScripts";
import { useTabs } from "@/hooks/useTabs";
import type { DiffFileStat, DiffScope, DiffStatResponse, FileMention, ImageAttachment, MessageOptions, QueuedMessage, Workspace, WorkspaceFileTreeNode } from "@/types";

const DEFAULT_EXPANDED = new Set<string>();

function findFirstFilePath(nodes: WorkspaceFileTreeNode[]): string | null {
  for (const node of nodes) {
    if (node.type === "file") {
      return node.path;
    }
    if (node.children?.length) {
      const nestedFile = findFirstFilePath(node.children);
      if (nestedFile) return nestedFile;
    }
  }
  return null;
}

function buildInitialExpanded(nodes: WorkspaceFileTreeNode[]): Set<string> {
  const expanded = new Set(DEFAULT_EXPANDED);
  const firstDirectory = nodes.find((node) => node.type === "directory");
  if (firstDirectory) {
    expanded.add(firstDirectory.path);
  }
  return expanded;
}

function matchesDiffStat(filePath: string | null | undefined, stat: DiffFileStat): boolean {
  return !!filePath && (stat.file === filePath || filePath.endsWith(`/${stat.file}`));
}

function renderFileTreeNodes(nodes: WorkspaceFileTreeNode[]) {
  return nodes.map((node) => {
    const nodePath = node.path;
    if (node.type === "directory") {
      return (
        <FileTreeFolder key={nodePath} path={nodePath} name={node.name}>
          {node.children ? renderFileTreeNodes(node.children) : null}
        </FileTreeFolder>
      );
    }
    return <FileTreeFile key={nodePath} path={nodePath} name={node.name} />;
  });
}

export default function WorkspaceView() {
  const { wsId } = useParams();
  const { collapsed } = useLayoutContext();
  const { ip: tailscaleIp, sshUser } = useTailscaleConfig();
  const { serverUrl } = useServerUrl();
  const terminalApps = useTerminalApps();
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

  // Sidebar tab state
  const [sidebarTab, setSidebarTab] = useState<"all" | "modified">("all");

  // Live data via WebSocket (branch + diff stats)
  const liveData = useWorkspaceLiveDataContext();
  const clearUnread = useClearUnread();



  const displayBranch = (wsId && liveData[wsId]?.branch) || workspace?.branch;

  // VS Code Remote SSH
  const backendHost = useMemo(() => {
    if (!serverUrl) return "";
    try {
      const normalized = serverUrl.includes("://") ? serverUrl : `http://${serverUrl}`;
      return new URL(normalized).hostname;
    } catch {
      return "";
    }
  }, [serverUrl]);
  const fallbackWindowHost = typeof window !== "undefined" ? window.location.hostname : "";
  const sshBaseHost = tailscaleIp || backendHost || fallbackWindowHost;
  const sshHost = sshUser && sshBaseHost ? `${sshUser}@${sshBaseHost}` : sshBaseHost;
  const vscodeUri = workspace?.worktreePath && sshHost
    ? buildVscodeRemoteUri(sshHost, workspace.worktreePath)
    : null;
  const vscodeDisabledReason = !sshBaseHost
    ? "Configure SSH host in Settings first"
    : !workspace?.worktreePath
      ? "Workspace path unavailable. Restart backend and reload this workspace."
      : null;
  const canOpenVscode = vscodeUri !== null;
  const canSsh = !!sshHost && !!workspace?.worktreePath;
  const copyWorkspacePathDisabledReason = "Workspace path unavailable. Restart backend and reload this workspace.";

  // Diff stats from WebSocket polling
  const diffCommitted = useMemo(
    () =>
      (wsId ? liveData[wsId]?.diffStats?.committed : undefined) ??
      initialDiffStats?.committed ??
      [],
    [wsId, liveData, initialDiffStats],
  );
  const diffUncommitted = useMemo(
    () =>
      (wsId ? liveData[wsId]?.diffStats?.uncommitted : undefined) ??
      initialDiffStats?.uncommitted ??
      [],
    [wsId, liveData, initialDiffStats],
  );
  const diffTotalCount = useMemo(() => {
    const files = new Set<string>();
    for (const f of diffCommitted) files.add(f.file);
    for (const f of diffUncommitted) files.add(f.file);
    return files.size;
  }, [diffCommitted, diffUncommitted]);

  const fileCount = useMemo(() => {
    function count(nodes: WorkspaceFileTreeNode[]): number {
      return nodes.reduce((acc, node) => {
        if (node.type === "file") return acc + 1;
        return acc + (node.children ? count(node.children) : 0);
      }, 0);
    }
    return count(fileTree);
  }, [fileTree]);

  // Initialize expanded paths and selected file when file tree first loads for a wsId
  const initializedWsRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!wsId || !filesQuery.data || initializedWsRef.current === wsId) return;
    initializedWsRef.current = wsId;
    setExpandedPaths(buildInitialExpanded(filesQuery.data));
    const firstFilePath = findFirstFilePath(filesQuery.data);
    setSelectedPath(firstFilePath ?? "");
  }, [wsId, filesQuery.data]);

  const {
    messages,
    isStreaming,
    streamingStartedAt,
    workspaceStatus,
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
    clearChat,
    switchSession,
    answerQuestion,
    batchAnswerQuestions,
    approvePlan,
    rejectToolInput,
    dismissPlan,
    agentPlanMode,
    lockedProvider,
    switchCounter,
  } = useConversation(wsId);

  const {
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
  } = useTabs(sessionId, wsId);

  // Clear unread only when the active conversation is actually visible.
  // If the file tab is open, keep unread state so the tab can show a dot.
  useEffect(() => {
    if (isFileTabActive) return;
    if (wsId && sessionId && liveData[wsId]?.unreadSessions?.[sessionId]) {
      clearUnread(wsId, sessionId);
    }
  }, [isFileTabActive, wsId, sessionId, liveData, clearUnread]);

  // ── Scroll-to-bottom trigger: incremented on send/queue to force scroll ──
  const [scrollToBottomTrigger, setScrollToBottomTrigger] = useState(0);

  // ── Message queue: lets users type one follow-up while agent is busy ──
  // Stored per (workspace, session) so switching sessions/workspaces preserves
  // each session's pending message instead of silently dropping it.
  const [queuedMessages, setQueuedMessages] = useState<Record<string, QueuedMessage>>({});
  const queueKey = wsId && sessionId ? `${wsId}:${sessionId}` : null;
  const queuedMessage = queueKey ? queuedMessages[queueKey] ?? null : null;
  const setQueuedMessage = useCallback((msg: QueuedMessage | null) => {
    if (!queueKey) return;
    setQueuedMessages((prev) => {
      if (msg === null) {
        if (!(queueKey in prev)) return prev;
        const next = { ...prev };
        delete next[queueKey];
        return next;
      }
      return { ...prev, [queueKey]: msg };
    });
  }, [queueKey]);

  // Auto-dequeue when the agent finishes and workspace is truly idle
  useEffect(() => {
    if (!queuedMessage) return;
    if (isStreaming) return;
    if (workspaceStatus !== "idle") return;
    if (pendingToolInputs.length > 0) return;

    const { content, images, options, fileMentions } = queuedMessage;
    const sent = sendMessage(content, images, options, undefined, fileMentions);
    if (sent) setQueuedMessage(null);
    // If send fails (WS disconnected), keep queue — effect re-fires on reconnect
  }, [queuedMessage, isStreaming, workspaceStatus, pendingToolInputs, sendMessage, setQueuedMessage]);

  const { tasks, currentTask, counts: taskCounts } = useTasks(messages, activeToolCalls);
  const { agents: backgroundAgents, runningCount: bgRunningCount } = useBackgroundAgents(messages, activeToolCalls);

  const { sessions, createSession, deleteSession, refresh: refreshSessions } = useSessions(wsId);

  // Mirror iOS: fall back to session metadata when WS hasn't delivered lockedProvider yet.
  const effectiveLockedProvider = lockedProvider
    ?? sessions.find((s) => s.sessionId === sessionId)?.lockedProvider;

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
    id: "hive-right-split-v4",
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

  const handleCreateSession = useCallback(async () => {
    const meta = await createSession();
    if (meta) {
      switchSession(meta.sessionId);
    }
  }, [createSession, switchSession]);

  const handleActivateSession = useCallback((targetSessionId: string) => {
    activateTab(`session:${targetSessionId}`);
    if (targetSessionId === sessionId) return;
    switchSession(targetSessionId);
    if (wsId) clearUnread(wsId, targetSessionId);
  }, [sessionId, switchSession, wsId, clearUnread, activateTab]);

  const handleDeleteSession = useCallback(async (targetSessionId: string) => {
    const isActive = targetSessionId === sessionId;
    const success = await deleteSession(targetSessionId);
    if (!success) return;

    if (isActive) {
      const next = sessions.find((s) => s.sessionId !== targetSessionId);
      if (next) {
        handleActivateSession(next.sessionId);
      } else {
        clearChat();
        if (wsId) wsTransport.clearCachedData(wsId);
        void queryClient.invalidateQueries({ queryKey: ["workspace", wsId] });
      }
    }
  }, [deleteSession, sessionId, sessions, handleActivateSession, clearChat, wsId, queryClient]);

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
        setScrollToBottomTrigger((c) => c + 1);
        return true;
      }
      const sent = sendMessage(content, images, options, undefined, fileMentions);
      if (sent) setScrollToBottomTrigger((c) => c + 1);
      return sent;
    },
    [hasPendingPlan, hasPendingExitPlanInput, rejectToolInput, sendMessage],
  );

  // Refs for inline diff → chat input bridge
  const chatInputRef = useRef<ChatInputHandle>(null);
  const diffViewerRef = useRef<InlineDiffViewerHandle>(null);

  // Inline diff state
  const [diffStyle, setDiffStyle] = useState<"split" | "unified">(() => {
    const stored = localStorage.getItem("diff-style");
    return stored === "split" ? "split" : "unified";
  });
  const handleDiffStyleChange = useCallback((style: "split" | "unified") => {
    setDiffStyle(style);
    localStorage.setItem("diff-style", style);
  }, []);
  const [diffCommentCount, setDiffCommentCount] = useState(0);

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

  const handlePasteToPrompt = useCallback(() => {
    diffViewerRef.current?.pasteToPrompt();
  }, []);

  const handleDiffPasteText = useCallback((text: string) => {
    if (sessionId) activateTab(`session:${sessionId}`);
    requestAnimationFrame(() => chatInputRef.current?.appendText(text));
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
          <div
            className="relative z-20 flex h-12 items-center gap-2 border-b border-border/50 pr-4 backdrop-blur-sm transition-[padding-left] duration-200 ease-in-out"
            style={{ paddingLeft: collapsed ? "max(var(--traffic-light-clearance, 0px), 1rem)" : "1rem" }}
            data-tauri-drag-region
          >
            <span className="truncate text-sm font-semibold text-foreground">{workspace?.projectName ?? workspace?.name}</span>
            {displayBranch && (
              <BranchLabel branch={displayBranch} showIcon={false} className="text-xs text-muted-foreground" />
            )}
            <div className="flex min-w-0 items-center gap-1">
              {workspace?.defaultBranch && (
                <span className="truncate text-xs text-muted-foreground/60">{"> origin/"}{workspace.defaultBranch}</span>
              )}
              <WorkspacePathCopyButton
                path={workspacePath}
                disabledReason={copyWorkspacePathDisabledReason}
              />
            </div>
            <div className="ml-auto" />
            {terminalApps.length > 0 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="xs" className="ml-2 text-muted-foreground hover:text-foreground">
                    <TerminalIcon className="size-3.5" />
                    Open
                    <ChevronDownIcon className="ml-0.5 size-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[140px]">
                  <DropdownMenuItem
                    disabled={!canOpenVscode}
                    onSelect={() => { if (vscodeUri) void openExternal(vscodeUri); }}
                  >
                    <VscodeIcon className="size-3.5" />
                    VS Code
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {terminalApps.map((t) => {
                    const Icon = t.id === "iterm2" ? Iterm2Icon : TerminalIcon;
                    return (
                      <DropdownMenuItem
                        key={t.id}
                        disabled={!canSsh}
                        onSelect={() => {
                          if (canSsh && workspace?.worktreePath) {
                            void openTerminalSsh(t.id, sshHost, workspace.worktreePath);
                          }
                        }}
                      >
                        <Icon className="size-3.5" />
                        {t.name} (SSH)
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <Button
                        variant="ghost"
                        size="xs"
                        className="ml-2 text-muted-foreground hover:text-foreground"
                        onClick={() => { if (vscodeUri) void openExternal(vscodeUri); }}
                        disabled={!canOpenVscode}
                      >
                        <VscodeIcon className="mr-1.5 size-3.5" />
                        VS Code
                      </Button>
                    </span>
                  </TooltipTrigger>
                  {vscodeDisabledReason && (
                    <TooltipContent>{vscodeDisabledReason}</TooltipContent>
                  )}
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
          <ConversationTabs
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
          />
          <div className={!isFileTabActive ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
            <ChatConversation
              messages={messages}
              isStreaming={isStreaming}
              streamingStartedAt={streamingStartedAt}
              currentStreamingText={currentStreamingText}
              currentThinking={currentThinking}
              activeToolCalls={activeToolCalls}
              activeAgentActivities={activeAgentActivities}
              pendingToolInputs={pendingToolInputs}
              onQuestionAnswer={answerQuestion}
              onFileMentionClick={handleFileTreeSelect}
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
            />
            {(tasks.length > 0 || backgroundAgents.length > 0) && !pendingToolInputs.some((p) => p.toolName === "AskUserQuestion") && (
              <TaskTracker
                tasks={tasks}
                currentTask={currentTask}
                counts={taskCounts}
                isStreaming={isStreaming}
                backgroundAgents={backgroundAgents}
                backgroundRunningCount={bgRunningCount}
              />
            )}
            {pendingToolInputs.some((p) => p.toolName === "AskUserQuestion") ? (
              <QuestionPanel
                pendingToolInputs={pendingToolInputs}
                onBatchSubmit={batchAnswerQuestions}
                onDismiss={() => rejectToolInput("[question_dismissed]")}
              />
            ) : (
              <div className="relative">
                {hasPendingPlan && pendingPlanData && (
                  <PlanActionBar
                    planContent={pendingPlanData.content}
                    planPath={pendingPlanData.planPath}
                    onApprove={approvePlan}
                    onHandOff={handleHandOff}
                  />
                )}
                <ChatInput
                  ref={chatInputRef}
                  wsId={wsId}
                  sessionId={sessionId}
                  lockedProvider={effectiveLockedProvider}
                  onSend={handleSend}
                  onStop={stopStreaming}
                  disabled={false}
                  isStreaming={isStreaming}
                  connectionStatus={connectionStatus}
                  placeholder={hasPendingPlan ? "Enter your plan adjustments here..." : undefined}
                  messages={messages}
                  queuedMessage={queuedMessage}
                  onQueue={(msg) => { setQueuedMessage(msg); setScrollToBottomTrigger((c) => c + 1); }}
                  agentPlanMode={agentPlanMode}
                />
              </div>
            )}
          </div>
          {isFileTabActive && openFile && wsId && (
            <div className="flex min-h-0 flex-1 flex-col">
              <FileContentToolbar
                filePath={openFile}
                mode={fileViewMode}
                onModeChange={handleFileViewModeChange}
                isModified={isFileModified}
                diffScope={diffScope}
                availableDiffScopes={availableDiffScopes}
                onDiffScopeChange={setDiffScope}
                diffStyle={diffStyle}
                onDiffStyleChange={handleDiffStyleChange}
                commentCount={diffCommentCount}
                onPasteToPrompt={handlePasteToPrompt}
              />
              {fileViewMode === "source" ? (
                <FileViewer wsId={wsId} filePath={openFile} />
              ) : (
                <InlineDiffViewer
                  ref={diffViewerRef}
                  wsId={wsId}
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

        <ResizeHandle orientation="vertical" disabled={!isLg} className={!isLg ? "hidden" : ""} />

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
                {diffTotalCount > 0 && (
                  <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                    {diffTotalCount}
                  </Badge>
                )}
              </button>
            </div>
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
