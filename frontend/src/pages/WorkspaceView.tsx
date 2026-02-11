import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "@/hooks/useApi";
import { useConversation } from "@/hooks/useConversation";
import { useConversationApi } from "@/hooks/useConversationApi";
import AgentTerminal from "@/components/AgentTerminal";
import AgentHistory from "@/components/AgentHistory";
import ChatConversation from "@/components/ChatConversation";
import ChatInput from "@/components/ChatInput";
import LaunchAgentForm from "@/components/LaunchAgentForm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Workspace, Agent } from "@/types";

export default function WorkspaceView() {
  const { wsId } = useParams();
  const navigate = useNavigate();
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

  const inSession = workspace?.status === "in_session";
  const activeAgent = (workspace?.agents ?? []).find((a) => a.status === "running");
  const isBusy = workspace?.status === "running" || inSession;

  // Conversation hook — only active when workspace is in_session
  const conversationWsId = inSession ? wsId : undefined;
  const { messages, isStreaming, currentStreamingText, sendMessage, stopStreaming, error } =
    useConversation(conversationWsId);
  const { startConversation, endConversation } = useConversationApi(wsId);

  const handleStartConversation = async () => {
    if (!wsId) return;
    await startConversation();
    await fetchWorkspace();
  };

  const handleEndConversation = async () => {
    if (!wsId) return;
    await endConversation();
    await fetchWorkspace();
  };

  const handleLaunchAgent = async (prompt: string, mode: "conversation" | "print") => {
    if (!wsId) return;
    await api.post<Agent>(`/api/workspaces/${wsId}/agents`, { prompt, mode });
    await fetchWorkspace();
  };

  const handleStopAgent = async () => {
    if (!activeAgent) return;
    await api.delete(`/api/agents/${activeAgent.id}`);
    await fetchWorkspace();
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

  const statusColor = inSession
    ? "bg-blue-400"
    : isBusy
      ? "bg-green-400"
      : "bg-muted-foreground/40";

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-6 py-4">
        <div>
          <h1 className="text-2xl font-bold">{workspace.name}</h1>
          <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            <span>{workspace.branch}</span>
            <Badge variant={isBusy ? "default" : "secondary"}>
              <span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${statusColor}`} />
              {workspace.status}
            </Badge>
          </div>
        </div>
        <div className="flex gap-2">
          {inSession && (
            <Button variant="destructive" size="sm" onClick={handleEndConversation}>
              End Session
            </Button>
          )}
          {activeAgent && !inSession && (
            <Button variant="destructive" size="sm" onClick={handleStopAgent}>
              Stop Agent
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate(`/workspaces/${wsId}/diff`)}
          >
            Diff
          </Button>
        </div>
      </div>

      {/* Main content area */}
      {inSession ? (
        // Conversation mode — full-height chat
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
          />
          <ChatInput
            onSend={sendMessage}
            onStop={stopStreaming}
            disabled={false}
            isStreaming={isStreaming}
          />
        </div>
      ) : (
        // Print mode / idle
        <div className="flex-1 overflow-auto p-6">
          {activeAgent ? (
            <div className="mb-6">
              <h2 className="mb-2 text-lg font-semibold">Current Agent</h2>
              <AgentTerminal agentId={activeAgent.id} prompt={activeAgent.prompt} />
            </div>
          ) : (
            <div className="mb-6 rounded-lg border border-dashed p-6 text-center text-muted-foreground">
              No active agent
            </div>
          )}

          <div className="mb-4">
            <h2 className="mb-2 text-lg font-semibold">History</h2>
            <AgentHistory agents={workspace.agents ?? []} workspaceId={wsId} />
          </div>

          <div className="mt-6 space-y-3">
            <div className="flex gap-2">
              <Button
                onClick={handleStartConversation}
                disabled={isBusy}
              >
                Start Conversation
              </Button>
            </div>
            <LaunchAgentForm disabled={isBusy} onSubmit={handleLaunchAgent} />
          </div>
        </div>
      )}
    </div>
  );
}
