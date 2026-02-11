import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Agent } from "@/types";

interface AgentHistoryProps {
  agents: Agent[];
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function AgentHistory({ agents }: AgentHistoryProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const pastAgents = agents.filter((a) => a.status !== "running").reverse();

  if (pastAgents.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">(no previous agents)</div>
    );
  }

  return (
    <ScrollArea className="max-h-64">
      <div className="space-y-2">
        {pastAgents.map((agent, i) => (
          <div key={agent.id} className="rounded-lg border p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">
                  Agent {pastAgents.length - i}
                </span>
                <Badge
                  variant={agent.exitCode === 0 ? "secondary" : "destructive"}
                >
                  {agent.status === "done" ? `exit ${agent.exitCode}` : agent.status}
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {agent.finishedAt ? timeAgo(agent.finishedAt) : ""}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setExpandedId(expandedId === agent.id ? null : agent.id)
                  }
                >
                  {expandedId === agent.id ? "Hide" : "View"}
                </Button>
              </div>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{agent.prompt}</p>
            {expandedId === agent.id && (
              <div className="mt-2 rounded bg-muted p-2 text-xs font-mono">
                Agent output would be streamed here from logs.
              </div>
            )}
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
