import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { api } from "@/hooks/useApi";
import { useConversation } from "@/hooks/useConversation";
import { useConversationApi } from "@/hooks/useConversationApi";
import ChatConversation from "@/components/ChatConversation";
import ChatInput from "@/components/ChatInput";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Workspace } from "@/types";

export default function WorkspaceView() {
  const { wsId } = useParams();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchWorkspace = useCallback(async () => {
    if (!wsId) return;
    try {
      setLoading(true);
      const data = await api.get<Workspace>(`/api/workspaces/${wsId}`);
      setWorkspace(data);
    } catch {
      setWorkspace(null);
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

  const { endSession } = useConversationApi(wsId);

  const handleCleanSession = async () => {
    if (!wsId) return;
    try {
      await endSession();
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
      {/* Header */}
      <div className="flex items-center justify-between border-b px-6 py-4">
        <div>
          <h1 className="text-2xl font-bold">{workspace.name}</h1>
          <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            <span>{workspace.branch}</span>
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
          </div>
        </div>
        <div className="flex gap-2">
          {hasActiveSession && (
            <Button variant="destructive" size="sm" onClick={handleCleanSession}>
              Clean Session
            </Button>
          )}
        </div>
      </div>

      {/* Chat area */}
      <div className="flex flex-1 flex-col overflow-hidden">
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
    </div>
  );
}
