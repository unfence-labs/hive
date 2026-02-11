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
    currentStreamingText,
    currentThinking,
    activeToolCalls,
    connectionStatus,
    error,
    sendMessage,
    stopStreaming,
  } = useConversation(wsId);

  const { endSession } = useConversationApi(wsId);

  const handleEndSession = async () => {
    if (!wsId) return;
    try {
      await endSession();
    } catch {
      // Best-effort; always refresh workspace state below.
    } finally {
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

  const isBusy = workspace.status === "busy";

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-6 py-4">
        <div>
          <h1 className="text-2xl font-bold">{workspace.name}</h1>
          <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            <span>{workspace.branch}</span>
            <Badge variant={isBusy ? "default" : "secondary"}>
              <span
                className={`mr-1.5 inline-block h-2 w-2 rounded-full ${
                  isBusy ? "bg-blue-400" : "bg-muted-foreground/40"
                }`}
              />
              {workspace.status}
            </Badge>
          </div>
        </div>
        <div className="flex gap-2">
          {isBusy && (
            <Button variant="destructive" size="sm" onClick={handleEndSession}>
              End Session
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
