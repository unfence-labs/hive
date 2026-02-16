import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useParams } from "react-router-dom";
import { MessageSquareIcon, TerminalSquareIcon } from "lucide-react";
import { api } from "@/hooks/useApi";
import { useConversation } from "@/hooks/useConversation";
import { useSessions } from "@/hooks/useSessions";
import { useWorkspaceLiveData } from "@/hooks/useWorkspaceLiveData";
import {
  FileTree,
  FileTreeFile,
  FileTreeFolder,
} from "@/components/ai-elements/file-tree";
import ChatConversation from "@/components/ChatConversation";
import ChatInput from "@/components/ChatInput";
import QuestionPanel from "@/components/chat/QuestionPanel";
import { ConversationTabs } from "@/components/ConversationTabs";
import { FileViewer } from "@/components/FileViewer";
import { BranchLabel } from "@/components/BranchLabel";
import { useTerminalContext } from "@/contexts/TerminalContext";
import { GitDiffModal } from "@/components/diff/GitDiffModal";
import { ModifiedFileList } from "@/components/diff/ModifiedFileList";
import { PrStatusSection } from "@/components/PrStatusSection";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { wsTransport } from "@/lib/ws-transport";
import type { DiffStatResponse, ImageAttachment, MessageOptions, Workspace, WorkspaceFileTreeNode } from "@/types";

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
  const [view, setView] = useState<"chatbot" | "terminal">("chatbot");
  const { activeTerminals, openTerminal, setVisibleTerminal } = useTerminalContext();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [fileTree, setFileTree] = useState<WorkspaceFileTreeNode[]>([]);
  const [fileTreeError, setFileTreeError] = useState<string | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(DEFAULT_EXPANDED);
  const [loadedWsId, setLoadedWsId] = useState<string | undefined>(undefined);
  const [selectedPath, setSelectedPath] = useState("");
  const [initialDiffStats, setInitialDiffStats] = useState<DiffStatResponse | null>(null);

  // File viewer state
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"conversation" | "file">("conversation");

  // Sidebar tab state
  const [sidebarTab, setSidebarTab] = useState<"all" | "modified">("all");

  // Diff modal state
  const [diffModalOpen, setDiffModalOpen] = useState(false);
  const [diffModalFile, setDiffModalFile] = useState<string | undefined>();

  // Live data via WebSocket (branch + diff stats)
  const liveWsIds = useMemo(() => (wsId ? [wsId] : []), [wsId]);
  const liveData = useWorkspaceLiveData(liveWsIds);
  const displayBranch = (wsId && liveData[wsId]?.branch) || workspace?.branch;
  const branchInfo = wsId ? liveData[wsId]?.branchInfo : undefined;

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

  // Lightweight file tree refresh — preserves expanded/selected state
  const refreshFileTree = useCallback(async () => {
    if (!wsId) return;
    try {
      const tree = await api.get<WorkspaceFileTreeNode[]>(`/api/workspaces/${wsId}/files`);
      setFileTree(tree);
      setFileTreeError(null);
    } catch {
      // Silently ignore — stale tree is better than error flash
    }
  }, [wsId]);

  const fetchWorkspace = useCallback(async () => {
    if (!wsId) {
      setWorkspace(null);
      setFileTree([]);
      setInitialDiffStats(null);
      setLoadedWsId(undefined);
      return;
    }
    try {
      setInitialDiffStats(null);
      const [workspaceResult, filesResult, diffStatsResult] = await Promise.allSettled([
        api.get<Workspace>(`/api/workspaces/${wsId}`),
        api.get<WorkspaceFileTreeNode[]>(`/api/workspaces/${wsId}/files`),
        api.get<DiffStatResponse>(`/api/workspaces/${wsId}/diff/stat`),
      ]);

      if (workspaceResult.status === "fulfilled") {
        setWorkspace(workspaceResult.value);
      } else {
        setWorkspace(null);
      }

      if (filesResult.status === "fulfilled") {
        setFileTree(filesResult.value);
        setFileTreeError(null);
        setExpandedPaths(buildInitialExpanded(filesResult.value));
        const firstFilePath = findFirstFilePath(filesResult.value);
        setSelectedPath(firstFilePath ?? "");
      } else {
        setFileTree([]);
        setFileTreeError("Failed to load file tree.");
        setExpandedPaths(new Set(DEFAULT_EXPANDED));
        setSelectedPath("");
      }

      if (diffStatsResult.status === "fulfilled") {
        setInitialDiffStats(diffStatsResult.value);
      } else {
        setInitialDiffStats(null);
      }
    } catch {
      setWorkspace(null);
      setFileTree([]);
      setInitialDiffStats(null);
      setFileTreeError("Failed to load file tree.");
    } finally {
      setLoadedWsId(wsId);
    }
  }, [wsId]);

  useEffect(() => {
    fetchWorkspace();
  }, [fetchWorkspace]);

  const {
    messages,
    isStreaming,
    streamingStartedAt,
    currentStreamingText,
    currentThinking,
    activeToolCalls,
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
  } = useConversation(wsId);

  const { sessions, createSession, activateSession, deleteSession, refresh: refreshSessions } = useSessions(wsId);

  // Refresh file tree when diff stats change (files created/modified/deleted)
  const diffStatsRef = useRef(liveData[wsId ?? ""]?.diffStats);
  useEffect(() => {
    const current = liveData[wsId ?? ""]?.diffStats;
    if (diffStatsRef.current && current && current !== diffStatsRef.current) {
      refreshFileTree();
    }
    diffStatsRef.current = current;
  }, [liveData, wsId, refreshFileTree]);

  // Reset to chatbot view and hide terminal overlay when switching workspaces
  useEffect(() => {
    setView("chatbot");
    setOpenFile(null);
    setActiveTab("conversation");
    return () => setVisibleTerminal(null);
  }, [wsId, setVisibleTerminal]);

  // Switch to chatbot when terminal exits (e.g. user types "exit")
  useEffect(() => {
    if (view === "terminal" && wsId && !activeTerminals.has(wsId)) {
      setView("chatbot");
    }
  }, [view, wsId, activeTerminals]);

  // Refresh session list when streaming stops
  const prevStreamingRef = useRef(isStreaming);
  useEffect(() => {
    if (prevStreamingRef.current && !isStreaming) {
      refreshSessions();
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming, refreshSessions]);

  const handleCreateSession = useCallback(async () => {
    const meta = await createSession();
    if (meta) {
      await switchSession(meta.sessionId);
    }
  }, [createSession, switchSession]);

  const handleActivateSession = useCallback(async (targetSessionId: string) => {
    setActiveTab("conversation");
    const meta = await activateSession(targetSessionId);
    if (meta) {
      await switchSession(meta.sessionId);
    }
  }, [activateSession, switchSession]);

  const handleDeleteSession = useCallback(async (targetSessionId: string) => {
    const isActive = targetSessionId === sessionId;
    const success = await deleteSession(targetSessionId);
    if (!success) return;

    if (isActive) {
      const next = sessions.find((s) => s.sessionId !== targetSessionId);
      if (next) {
        await handleActivateSession(next.sessionId);
      } else {
        clearChat();
        if (wsId) wsTransport.clearCachedData(wsId);
        await fetchWorkspace();
      }
    }
  }, [deleteSession, sessionId, sessions, handleActivateSession, clearChat, fetchWorkspace, wsId]);

  const handleFileTreeSelect = useCallback((path: string) => {
    setSelectedPath(path);
    setOpenFile(path);
    setActiveTab("file");
    setView("chatbot");
  }, []);

  const handleModifiedFileClick = useCallback((filePath: string) => {
    setDiffModalFile(filePath);
    setDiffModalOpen(true);
  }, []);

  const handleHandOff = useCallback(async (planContent: string, planPath?: string) => {
    dismissPlan("Plan handed off to a new session.");
    const meta = await createSession();
    if (!meta) return;
    await switchSession(meta.sessionId);
    await refreshSessions();
    const handoffPrompt = planPath
      ? `Execute the approved plan from \`${planPath}\`. Read that file and implement it end-to-end.`
      : `Here is the implementation plan to execute:\n\n${planContent}`;
    sendMessage(handoffPrompt, undefined, undefined, meta.sessionId);
  }, [dismissPlan, createSession, switchSession, refreshSessions, sendMessage]);

  // Detect pending plan from explicit pending tool inputs OR from the last
  // assistant message having an ExitPlanMode tool (fallback matching the
  // isMessageInteractive heuristic in ChatConversation).
  const lastMsg = messages[messages.length - 1];
  const hasPendingPlan =
    pendingToolInputs.some((p) => p.toolName === "ExitPlanMode") ||
    (!isStreaming &&
      lastMsg?.role === "assistant" &&
      lastMsg?.toolCalls?.some((tc) => tc.name === "ExitPlanMode") === true);

  const handleSend = useCallback(
    (content: string, images?: ImageAttachment[], options?: MessageOptions): boolean => {
      if (hasPendingPlan && pendingToolInputs.some((p) => p.toolName === "ExitPlanMode")) {
        rejectToolInput(content);
        return true;
      }
      return sendMessage(content, images, options);
    },
    [hasPendingPlan, pendingToolInputs, rejectToolInput, sendMessage],
  );

  // sendMessage is already a stable callback from useConversation
  const handleAddToPrompt = sendMessage;

  // Full skeleton only on first ever load (no data yet)
  if (!loadedWsId) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  if (loadedWsId === wsId && !workspace) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Workspace not found.
      </div>
    );
  }


  return (
    <div className="flex h-full flex-col">
      {/* Chat area + right panel */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="relative z-20 flex h-12 items-center gap-2 border-b border-border/50 px-4 backdrop-blur-sm">
            <span className="truncate text-sm font-semibold text-foreground">{workspace?.projectName ?? workspace?.name}</span>
            {displayBranch && (
              <BranchLabel branch={displayBranch} showIcon={false} className="text-xs text-muted-foreground" />
            )}
            {workspace?.defaultBranch && (
              <span className="truncate text-xs text-muted-foreground/60">{"> origin/"}{workspace.defaultBranch}</span>
            )}
            <ButtonGroup className="ml-auto">
              <Button
                variant="outline"
                size="xs"
                className={view === "chatbot"
                  ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/10 hover:text-primary dark:border-primary/40 dark:bg-primary/10"
                  : "hover:bg-transparent hover:text-current"}
                onClick={() => {
                  setView("chatbot");
                  setVisibleTerminal(null);
                }}
              >
                <MessageSquareIcon className="mr-1.5 size-3.5" />
                Chatbot
              </Button>
              <Button
                variant="outline"
                size="xs"
                className={view === "terminal"
                  ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/10 hover:text-primary dark:border-primary/40 dark:bg-primary/10"
                  : "hover:bg-transparent hover:text-current"}
                onClick={() => {
                  setView("terminal");
                  if (wsId) openTerminal(wsId);
                }}
              >
                <TerminalSquareIcon className="mr-1.5 size-3.5" />
                Terminal
              </Button>
            </ButtonGroup>
          </div>
          <ConversationTabs
            sessions={sessions}
            activeSessionId={sessionId}
            isStreaming={isStreaming}
            streamingSessions={wsId ? liveData[wsId]?.streamingSessions : undefined}
            onCreateSession={handleCreateSession}
            onActivateSession={handleActivateSession}
            onDeleteSession={handleDeleteSession}
            openFile={openFile}
            isFileActive={activeTab === "file"}
            onFileTabClick={() => setActiveTab("file")}
            onFileTabClose={() => {
              setOpenFile(null);
              setActiveTab("conversation");
            }}
          />
          <div className={view === "chatbot" && activeTab === "conversation" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
            {error && (
              <div className="border-b bg-destructive/10 px-4 py-2 text-sm text-destructive">
                {error}
              </div>
            )}
            <ChatConversation
              messages={messages}
              isStreaming={isStreaming}
              streamingStartedAt={streamingStartedAt}
              currentStreamingText={currentStreamingText}
              currentThinking={currentThinking}
              activeToolCalls={activeToolCalls}
              pendingToolInputs={pendingToolInputs}
              onQuestionAnswer={answerQuestion}
              onPlanApproval={approvePlan}
              onHandOff={handleHandOff}
              workspaceName={workspace?.name}
              projectName={workspace?.projectName}
              branch={displayBranch}
              defaultBranch={workspace?.defaultBranch}
              fileCount={fileCount}
            />
            {pendingToolInputs.some((p) => p.toolName === "AskUserQuestion") ? (
              <QuestionPanel
                pendingToolInputs={pendingToolInputs}
                onBatchSubmit={batchAnswerQuestions}
                onDismiss={() => rejectToolInput("cancel")}
              />
            ) : (
              <ChatInput
                wsId={wsId}
                onSend={handleSend}
                onStop={stopStreaming}
                disabled={false}
                isStreaming={isStreaming}
                connectionStatus={connectionStatus}
                placeholder={hasPendingPlan ? "Enter your plan adjustments here..." : undefined}
              />
            )}
          </div>
          {view === "chatbot" && activeTab === "file" && openFile && wsId && (
            <div className="flex min-h-0 flex-1 flex-col">
              <FileViewer wsId={wsId} filePath={openFile} />
            </div>
          )}
          {view === "terminal" && (
            <div className="min-h-0 flex-1" />
          )}
        </div>

        <aside className="hidden w-80 shrink-0 border-l border-border/50 bg-sidebar lg:flex lg:flex-col">
          <div className="flex h-12 items-center gap-3 border-b border-border/50 px-4">
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
          <div className="min-h-0 flex-1 overflow-auto p-3">
            {sidebarTab === "modified" && (
              <ModifiedFileList
                committed={diffCommitted}
                uncommitted={diffUncommitted}
                onFileClick={handleModifiedFileClick}
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
          <PrStatusSection branchInfo={branchInfo} />
        </aside>
      </div>

      {/* Diff modal */}
      {wsId && (
        <GitDiffModal
          open={diffModalOpen}
          onOpenChange={setDiffModalOpen}
          wsId={wsId}
          initialFile={diffModalFile}
          onAddToPrompt={handleAddToPrompt}
        />
      )}
    </div>
  );
}
