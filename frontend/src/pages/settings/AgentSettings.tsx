import { useQuery } from "@tanstack/react-query";
import { Loader2, CheckCircle2, ArrowUpCircle, CircleSlash } from "lucide-react";
import { SettingsHeader } from "@/components/AppLayout";
import { CenterCard } from "@/components/CenterCard";
import { api } from "@/hooks/useApi";
import { cn } from "@/lib/utils";

interface AgentStatusEntry {
  id: string;
  label: string;
  installed: boolean;
  version: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
}

interface AgentStatusResponse {
  agents: AgentStatusEntry[];
}

export default function AgentSettings() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["settings", "cli"],
    queryFn: () => api.get<AgentStatusResponse>("/api/settings/cli"),
  });

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <SettingsHeader>
        <h1 className="text-sm font-medium">CLI</h1>
      </SettingsHeader>

      <CenterCard scroll>
      <div className="max-w-2xl space-y-4 px-4 py-5">
        <p className="text-xs text-muted-foreground">
          Agent CLI tools detected on this server.
        </p>

        {isLoading && (
          <div className="flex items-center gap-2 py-8 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking agent versions…
          </div>
        )}

        {isError && (
          <p className="py-4 text-xs text-destructive">
            Could not load agent information.
          </p>
        )}

        {data?.agents.map((agent) => (
          <AgentCard key={agent.id} agent={agent} />
        ))}
      </div>
      </CenterCard>
    </div>
  );
}

function AgentCard({ agent }: { agent: AgentStatusEntry }) {
  return (
    <section
      className={cn(
        "rounded-lg border border-border/50 bg-card/50 p-5",
        !agent.installed && "opacity-50",
      )}
    >
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-sm font-medium text-foreground">{agent.label}</h2>
          {agent.installed && agent.version && (
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              v{agent.version}
            </p>
          )}
        </div>
        <StatusBadge agent={agent} />
      </div>
    </section>
  );
}

function StatusBadge({ agent }: { agent: AgentStatusEntry }) {
  if (!agent.installed) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
        <CircleSlash className="h-3 w-3" />
        Not installed
      </span>
    );
  }

  if (agent.updateAvailable) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-warning-border bg-warning-muted px-2.5 py-0.5 text-[11px] font-medium text-warning-foreground">
        <ArrowUpCircle className="h-3 w-3" />
        Update available{agent.latestVersion && ` (${agent.latestVersion})`}
      </span>
    );
  }

  if (agent.latestVersion != null) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-success-border bg-success-muted px-2.5 py-0.5 text-[11px] font-medium text-success-foreground">
        <CheckCircle2 className="h-3 w-3" />
        Up to date
      </span>
    );
  }

  // Installed but couldn't check for updates (registry unreachable)
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
      Installed
    </span>
  );
}
