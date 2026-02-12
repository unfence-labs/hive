import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "react-router-dom";
import { MessageSquareIcon, RefreshCwIcon, RotateCcwIcon, TerminalSquareIcon } from "lucide-react";
import { api } from "@/hooks/useApi";
import { useConversation } from "@/hooks/useConversation";
import { useDiffStat } from "@/hooks/useDiffStat";
import {
  FileTree,
  FileTreeFile,
  FileTreeFolder,
} from "@/components/ai-elements/file-tree";
import ChatConversation from "@/components/ChatConversation";
import ChatInput from "@/components/ChatInput";
import Terminal from "@/components/Terminal";
import { GitDiffModal } from "@/components/diff/GitDiffModal";
import { ModifiedFileList } from "@/components/diff/ModifiedFileList";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { Workspace, WorkspaceFileTreeNode } from "@/types";

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
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [fileTree, setFileTree] = useState<WorkspaceFileTreeNode[]>([]);
  const [fileTreeError, setFileTreeError] = useState<string | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(DEFAULT_EXPANDED);
  const [loadedWsId, setLoadedWsId] = useState<string | undefined>(undefined);
  const [selectedPath, setSelectedPath] = useState("");

  // Sidebar tab state
  const [sidebarTab, setSidebarTab] = useState<"all" | "modified">("all");

  // Diff modal state
  const [diffModalOpen, setDiffModalOpen] = useState(false);
  const [diffModalFile, setDiffModalFile] = useState<string | undefined>();

  // Diff stats for the modified tab
  const { committed: diffCommitted, uncommitted: diffUncommitted, totalCount: diffTotalCount, loading: diffStatsLoading, refresh: refreshDiffStats } = useDiffStat(wsId);

  const fetchWorkspace = useCallback(async () => {
    if (!wsId) {
      setWorkspace(null);
      setFileTree([]);
      setLoadedWsId(undefined);
      return;
    }
    try {
      const [workspaceResult, filesResult] = await Promise.allSettled([
        api.get<Workspace>(`/api/workspaces/${wsId}`),
        api.get<WorkspaceFileTreeNode[]>(`/api/workspaces/${wsId}/files`),
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
    } catch {
      setWorkspace(null);
      setFileTree([]);
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
    workspaceStatus,
    currentStreamingText,
    currentThinking,
    activeToolCalls,
    pendingToolInputs,
    connectionStatus,
    error,
    sendMessage,
    stopStreaming,
    clearChat,
    answerQuestion,
    approvePlan,
    rejectToolInput,
  } = useConversation(wsId);

  const effectiveWorkspaceStatus = workspaceStatus ?? workspace?.status;

  // Refresh diff stats when streaming stops (agent finished working on files)
  const prevStreamingRef = useRef(isStreaming);
  useEffect(() => {
    if (prevStreamingRef.current && !isStreaming) {
      refreshDiffStats();
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming, refreshDiffStats]);

  const handleCleanSession = async () => {
    if (!wsId) return;
    try {
      await api.delete(`/api/workspaces/${wsId}/session`);
    } catch {
      // Best-effort; always clear UI below.
    } finally {
      clearChat();
      await fetchWorkspace();
    }
  };

  const handleModifiedFileClick = useCallback((filePath: string) => {
    setDiffModalFile(filePath);
    setDiffModalOpen(true);
  }, []);

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

  const hasActiveSession = effectiveWorkspaceStatus === "busy";

  return (
    <div className="flex h-full flex-col">
      {/* Chat area + right panel */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex h-12 items-center gap-2 border-b border-border/50 px-4 backdrop-blur-sm">
            <span className="truncate text-sm font-semibold text-foreground">{workspace?.name}</span>
            <span className="truncate text-xs text-muted-foreground">{workspace?.branch}</span>
            <Badge variant={hasActiveSession ? "default" : "secondary"} className="text-[10px]">
              <span
                className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${
                  hasActiveSession ? "bg-primary-foreground" : "bg-muted-foreground/40"
                }`}
              />
              {hasActiveSession ? "active" : "idle"}
            </Badge>
            <Button
              variant="ghost"
              size="icon-xs"
              className="ml-auto text-muted-foreground hover:text-foreground"
              onClick={handleCleanSession}
              aria-label="Restart session"
              title="Restart session"
            >
              <RotateCcwIcon />
            </Button>
            <ButtonGroup className="ml-2">
              <Button
                variant="outline"
                size="xs"
                className={view === "chatbot"
                  ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/10 hover:text-primary dark:border-primary/40 dark:bg-primary/10"
                  : "hover:bg-transparent hover:text-current"}
                onClick={() => setView("chatbot")}
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
                onClick={() => setView("terminal")}
              >
                <TerminalSquareIcon className="mr-1.5 size-3.5" />
                Terminal
              </Button>
            </ButtonGroup>
          </div>
          <div className={view === "chatbot" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
            {error && (
              <div className="border-b bg-destructive/10 px-4 py-2 text-sm text-destructive">
                {error}
              </div>
            )}
            <ChatConversation
              messages={messages}
              isStreaming={isStreaming}
              currentStreamingText={currentStreamingText}
              currentThinking={currentThinking}
              activeToolCalls={activeToolCalls}
              pendingToolInputs={pendingToolInputs}
              onQuestionAnswer={answerQuestion}
              onPlanApproval={approvePlan}
              onRejectToolInput={rejectToolInput}
            />
            <ChatInput
              onSend={sendMessage}
              onStop={stopStreaming}
              disabled={false}
              isStreaming={isStreaming}
              isAwaitingResponse={pendingToolInputs.length > 0}
              connectionStatus={connectionStatus}
            />
          </div>
          {view === "terminal" && wsId && (
            <div className="min-h-0 flex-1 overflow-hidden">
              <Terminal workspaceId={wsId} />
            </div>
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
            {sidebarTab === "modified" && (
              <button
                type="button"
                className="ml-auto rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                onClick={refreshDiffStats}
                aria-label="Refresh changes"
                title="Refresh changes"
              >
                <RefreshCwIcon className={cn("size-3.5", diffStatsLoading && "animate-spin")} />
              </button>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-3">
            {sidebarTab === "modified" && (
              <ModifiedFileList
                committed={diffCommitted}
                uncommitted={diffUncommitted}
                loading={diffStatsLoading}
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
                onPathSelect={setSelectedPath}
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
