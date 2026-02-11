import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "@/hooks/useApi";
import AgentTerminal from "@/components/AgentTerminal";
import AgentHistory from "@/components/AgentHistory";
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

  const activeAgent = (workspace?.agents ?? []).find((a) => a.status === "running");
  const isBusy = workspace?.status === "running";

  const handleLaunchAgent = async (prompt: string) => {
    if (!wsId) return;
    const agent = await api.post<Agent>(`/api/workspaces/${wsId}/agents`, {
      prompt,
    });
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

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{workspace.name}</h1>
          <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            <span>{workspace.branch}</span>
            <Badge variant={isBusy ? "default" : "secondary"}>
              <span
                className={`mr-1.5 inline-block h-2 w-2 rounded-full ${
                  isBusy ? "bg-green-400" : "bg-muted-foreground/40"
                }`}
              />
              {workspace.status}
            </Badge>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate(`/workspaces/${wsId}/diff`)}
          >
            Diff
          </Button>
        </div>
      </div>

      {activeAgent ? (
        <div className="mb-6">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Current Agent</h2>
            <Button variant="destructive" size="sm" onClick={handleStopAgent}>
              Stop
            </Button>
          </div>
          <AgentTerminal agentId={activeAgent.id} prompt={activeAgent.prompt} />
        </div>
      ) : (
        <div className="mb-6 rounded-lg border border-dashed p-6 text-center text-muted-foreground">
          No active agent
        </div>
      )}

      <div className="mb-4">
        <h2 className="mb-2 text-lg font-semibold">History</h2>
        <AgentHistory agents={workspace.agents ?? []} />
      </div>

      <div className="mt-6">
        <LaunchAgentForm disabled={isBusy} onSubmit={handleLaunchAgent} />
      </div>
    </div>
  );
}
