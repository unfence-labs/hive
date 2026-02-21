import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CodeXmlIcon, ChevronDownIcon, TerminalIcon } from "lucide-react";
import { api } from "@/hooks/useApi";
import { useConversation } from "@/hooks/useConversation";
import { useSessions } from "@/hooks/useSessions";
import { useWorkspaceLiveDataContext } from "@/contexts/WorkspaceLiveDataContext";
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
import { GitDiffModal } from "@/components/diff/GitDiffModal";
import { ModifiedFileList } from "@/components/diff/ModifiedFileList";
import { PrStatusSection } from "@/components/PrStatusSection";
import ScriptPanel from "@/components/ScriptPanel";
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
import { cn } from "@/lib/utils";
import { wsTransport } from "@/lib/ws-transport";
import { useScripts } from "@/hooks/useScripts";
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
  const fileTree = filesQuery.data ?? [];
  const fileTreeError = filesQuery.error?.message ?? null;
  const initialDiffStats = diffStatQuery.data ?? null;

  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(DEFAULT_EXPANDED);
  const [selectedPath, setSelectedPath] = useState("");

  // File viewer state
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"conversation" | "file">("conversation");

  // Sidebar tab state
  const [sidebarTab, setSidebarTab] = useState<"all" | "modified">("all");

  // Sidebar split: fraction of height given to file tree (vs ScriptPanel)
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const [sidebarSplit, setSidebarSplit] = useState<number>(() => {
    const stored = localStorage.getItem("sidebar-split");
    const parsed = stored ? parseFloat(stored) : NaN;
    return Number.isFinite(parsed) && parsed > 0 && parsed < 1 ? parsed : 0.5;
  });
  const [isDraggingSplit, setIsDraggingSplit] = useState(false);

  // Diff modal state
  const [diffModalOpen, setDiffModalOpen] = useState(false);
  const [diffModalFile, setDiffModalFile] = useState<string | undefined>();

  // Live data via WebSocket (branch + diff stats)
  const liveData = useWorkspaceLiveDataContext();
  const displayBranch = (wsId && liveData[wsId]?.branch) || workspace?.branch;
  const branchInfo = wsId ? liveData[wsId]?.branchInfo : undefined;

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
    lockedProvider,
  } = useConversation(wsId);

  const { sessions, createSession, activateSession, deleteSession, refresh: refreshSessions } = useSessions(wsId);

  // Mirror iOS: fall back to session metadata when WS hasn't delivered lockedProvider yet.
  const effectiveLockedProvider = lockedProvider
    ?? sessions.find((s) => s.sessionId === sessionId)?.lockedProvider;

  // Scripts (hive.json setup/run)
  const {
    config: scriptsConfig,
    status: scriptsStatus,
    startScript,
    stopScript,
    connectOutput: connectScriptOutput,
    disconnectOutput: disconnectScriptOutput,
  } = useScripts(wsId);

  // Sidebar split drag handler
  const handleDividerPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const container = splitContainerRef.current;
      if (!container) return;

      const containerRect = container.getBoundingClientRect();
      const totalHeight = containerRect.height;
      setIsDraggingSplit(true);

      const onPointerMove = (moveEvent: PointerEvent) => {
        const offsetY = moveEvent.clientY - containerRect.top;
        const clamped = Math.min(0.85, Math.max(0.15, offsetY / totalHeight));
        setSidebarSplit(clamped);
      };

      const onPointerUp = (upEvent: PointerEvent) => {
        const offsetY = upEvent.clientY - containerRect.top;
        const clamped = Math.min(0.85, Math.max(0.15, offsetY / totalHeight));
        localStorage.setItem("sidebar-split", String(clamped));
        setIsDraggingSplit(false);
        document.removeEventListener("pointermove", onPointerMove);
        document.removeEventListener("pointerup", onPointerUp);
      };

      document.addEventListener("pointermove", onPointerMove);
      document.addEventListener("pointerup", onPointerUp);
    },
    [],
  );

  // Reset file viewer when switching workspaces
  useEffect(() => {
    setOpenFile(null);
    setActiveTab("conversation");
  }, [wsId]);

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
        void queryClient.invalidateQueries({ queryKey: ["workspace", wsId] });
      }
    }
  }, [deleteSession, sessionId, sessions, handleActivateSession, clearChat, wsId, queryClient]);

  const handleFileTreeSelect = useCallback((path: string) => {
    setSelectedPath(path);
    setOpenFile(path);
    setActiveTab("file");
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
          <div className="relative z-20 flex h-12 items-center gap-2 border-b border-border/50 px-4 backdrop-blur-sm" data-tauri-drag-region>
            <span className="truncate text-sm font-semibold text-foreground">{workspace?.projectName ?? workspace?.name}</span>
            {displayBranch && (
              <BranchLabel branch={displayBranch} showIcon={false} className="text-xs text-muted-foreground" />
            )}
            {workspace?.defaultBranch && (
              <span className="truncate text-xs text-muted-foreground/60">{"> origin/"}{workspace.defaultBranch}</span>
            )}
            <div className="ml-auto" />
            {terminalApps.length > 0 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="xs" className="ml-2">
                    <CodeXmlIcon className="mr-1.5 size-3.5" />
                    Code
                    <ChevronDownIcon className="ml-1 size-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    disabled={!canOpenVscode}
                    onSelect={() => { if (vscodeUri) void openExternal(vscodeUri); }}
                  >
                    <CodeXmlIcon className="size-3.5" />
                    Open in VS Code
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {terminalApps.map((t) => (
                    <DropdownMenuItem
                      key={t.id}
                      disabled={!canSsh}
                      onSelect={() => {
                        if (canSsh && workspace?.worktreePath) {
                          void openTerminalSsh(t.id, sshHost, workspace.worktreePath);
                        }
                      }}
                    >
                      <TerminalIcon className="size-3.5" />
                      {t.name} (SSH)
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <Button
                        variant="outline"
                        size="xs"
                        className="ml-2"
                        onClick={() => { if (vscodeUri) void openExternal(vscodeUri); }}
                        disabled={!canOpenVscode}
                      >
                        <CodeXmlIcon className="mr-1.5 size-3.5" />
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
            onConversationTabClick={() => setActiveTab("conversation")}
          />
          <div className={activeTab === "conversation" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
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
                sessionId={sessionId}
                lockedProvider={effectiveLockedProvider}
                onSend={handleSend}
                onStop={stopStreaming}
                disabled={false}
                isStreaming={isStreaming}
                connectionStatus={connectionStatus}
                placeholder={hasPendingPlan ? "Enter your plan adjustments here..." : undefined}
              />
            )}
          </div>
          {activeTab === "file" && openFile && wsId && (
            <div className="flex min-h-0 flex-1 flex-col">
              <FileViewer wsId={wsId} filePath={openFile} />
            </div>
          )}
        </div>

        <aside className="hidden w-[420px] shrink-0 border-l border-border/50 bg-sidebar lg:flex lg:flex-col">
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
          <div
            ref={splitContainerRef}
            className={cn(
              "flex min-h-0 flex-1 flex-col overflow-hidden",
              isDraggingSplit && "select-none [&_*]:pointer-events-none",
            )}
          >
            <div
              className="overflow-auto p-3"
              style={{ height: `${sidebarSplit * 100}%`, flexShrink: 0 }}
            >
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

            <div
              role="separator"
              aria-orientation="horizontal"
              className="group relative h-1.5 shrink-0 cursor-row-resize select-none"
              onPointerDown={handleDividerPointerDown}
            >
              <div className="absolute inset-x-0 top-[2px] h-px bg-border/50 transition-colors group-hover:bg-border" />
            </div>

            <ScriptPanel
              key={wsId}
              config={scriptsConfig}
              status={scriptsStatus}
              onStart={startScript}
              onStop={stopScript}
              onConnectOutput={connectScriptOutput}
              onDisconnectOutput={disconnectScriptOutput}
            />
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
