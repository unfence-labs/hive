import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { RotateCcwIcon } from "lucide-react";
import { api } from "@/hooks/useApi";
import { useConversation } from "@/hooks/useConversation";
import {
  FileTree,
  FileTreeFile,
  FileTreeFolder,
} from "@/components/ai-elements/file-tree";
import ChatConversation from "@/components/ChatConversation";
import ChatInput from "@/components/ChatInput";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [fileTree, setFileTree] = useState<WorkspaceFileTreeNode[]>([]);
  const [fileTreeError, setFileTreeError] = useState<string | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(DEFAULT_EXPANDED);
  const [loading, setLoading] = useState(true);
  const [selectedPath, setSelectedPath] = useState("");

  const fetchWorkspace = useCallback(async () => {
    if (!wsId) {
      setWorkspace(null);
      setFileTree([]);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
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
      setLoading(false);
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
    connectionStatus,
    error,
    sendMessage,
    stopStreaming,
    clearChat,
    answerQuestion,
    approvePlan,
  } = useConversation(wsId);

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

  if (loading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Workspace not found.
      </div>
    );
  }

  const effectiveWorkspaceStatus = workspaceStatus ?? workspace.status;
  const hasActiveSession = effectiveWorkspaceStatus === "busy";

  return (
    <div className="flex h-full flex-col">
      {/* Chat area + right panel */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex h-14 items-center gap-2 border-b px-4">
            <span className="truncate text-sm font-semibold text-foreground">{workspace.name}</span>
            <span className="truncate text-sm text-muted-foreground">{workspace.branch}</span>
            <Badge variant={hasActiveSession ? "default" : "secondary"}>
              <span
                className={`mr-1.5 inline-block h-2 w-2 rounded-full ${
                  hasActiveSession ? "bg-blue-400" : "bg-muted-foreground/40"
                }`}
              />
              {hasActiveSession ? "session active" : "session idle"}
            </Badge>
            <Badge variant={isStreaming ? "default" : "outline"}>
              {isStreaming ? "streaming" : "ready"}
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
          </div>
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
            onQuestionAnswer={answerQuestion}
            onPlanApproval={approvePlan}
          />
          <ChatInput
            onSend={sendMessage}
            onStop={stopStreaming}
            disabled={false}
            isStreaming={isStreaming}
            connectionStatus={connectionStatus}
          />
        </div>

        <aside className="hidden w-80 shrink-0 border-l bg-background lg:flex lg:flex-col">
          <div className="flex h-14 items-center border-b px-4 text-xs uppercase tracking-wide text-muted-foreground">
            Files
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-3">
            {fileTreeError ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                {fileTreeError}
              </div>
            ) : (
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
    </div>
  );
}
