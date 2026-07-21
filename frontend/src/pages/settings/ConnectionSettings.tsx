import { useState } from "react";
import { RefreshCw, Server } from "lucide-react";
import { isTauri } from "@/lib/is-tauri";
import { openSetupWizard } from "@/hooks/useSetupWizardRequest";
import { SettingsHeader } from "@/components/AppLayout";
import { CenterCard } from "@/components/CenterCard";
import { useConnection } from "@/hooks/useConnection";
import { useConnectionStatus } from "@/hooks/useConnectionStatus";
import { switchServer } from "@/lib/server-connection";
import { ToolsPanel } from "@/pages/setup/screens/ToolsPanel";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const STATUS_CONFIG: Record<string, { dot: string; label: string; badge: string }> = {
  connected: {
    dot: "bg-success",
    label: "Connected",
    badge: "border-success-border bg-success-muted text-success-foreground",
  },
  disconnected: {
    dot: "bg-destructive",
    label: "Unreachable",
    badge: "border-destructive/30 bg-destructive/10 text-destructive",
  },
  unknown: {
    dot: "bg-muted-foreground/40",
    label: "Checking...",
    badge: "border-border bg-muted/50 text-muted-foreground",
  },
};

interface ConnectionSettingsProps {
  onRefreshConnection?: () => void;
}

export default function ConnectionSettings({ onRefreshConnection }: ConnectionSettingsProps) {
  const { connection, isConfigured } = useConnection();
  const { status, check } = useConnectionStatus();
  const [hostDraft, setHostDraft] = useState("");
  const [portDraft, setPortDraft] = useState("3000");
  const [sshUserDraft, setSshUserDraft] = useState("");
  const [tokenDraft, setTokenDraft] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const connect = async () => {
    const port = Number(portDraft);
    setConnecting(true);
    setConnectionError(null);
    try {
      await switchServer(
        {
          host: hostDraft.trim(),
          port,
          sshUser: sshUserDraft.trim() || undefined,
          authToken: tokenDraft.trim() || undefined,
        },
        { verify: true },
      );
      setTokenDraft("");
      onRefreshConnection?.();
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : "The server could not be reached.");
    } finally {
      setConnecting(false);
    }
  };

  const recheck = async () => {
    setChecking(true);
    try {
      await check();
      onRefreshConnection?.();
    } finally {
      setChecking(false);
    }
  };

  const reset = async () => {
    if (
      !window.confirm(
        "Disconnect from this server? The connection details are cleared; the server itself is untouched.",
      )
    ) {
      return;
    }
    await switchServer(null);
    setHostDraft("");
    setPortDraft("3000");
    setSshUserDraft("");
    setTokenDraft("");
    setConnectionError(null);
    onRefreshConnection?.();
  };

  const port = Number(portDraft);
  const canConnect =
    hostDraft.trim().length > 0 && Number.isInteger(port) && port >= 1 && port <= 65_535;
  const cfg = STATUS_CONFIG[status];

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <SettingsHeader>
        <h1 className="text-sm font-medium">Connection</h1>
      </SettingsHeader>

      <CenterCard scroll>
        <div className="max-w-2xl space-y-6 px-4 py-5">
          {!isConfigured || !connection ? (
            <section className="rounded-lg border border-border/50 bg-card/50 p-5">
              <h2 className="text-sm font-medium text-foreground">Connect your server</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Set up a new Hive server, or connect to an existing one.
              </p>

              {isTauri() && (
                <Button size="sm" className="mt-4" onClick={openSetupWizard}>
                  <Server className="h-3.5 w-3.5" />
                  Set up a new server
                </Button>
              )}

              <div className="mt-5 space-y-3 border-t border-border/40 pt-4">
                <p className="text-xs font-medium text-muted-foreground">
                  Connect to an existing Hive server
                </p>
                <div className="grid grid-cols-[minmax(0,1fr)_100px] gap-3">
                  <div>
                    <label htmlFor="server-host" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      IP or hostname
                    </label>
                    <Input
                      id="server-host"
                      value={hostDraft}
                      onChange={(event) => setHostDraft(event.target.value)}
                      placeholder="100.x.x.x"
                      autoComplete="off"
                      spellCheck={false}
                      className="font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label htmlFor="server-port" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      Port
                    </label>
                    <Input
                      id="server-port"
                      value={portDraft}
                      onChange={(event) => setPortDraft(event.target.value)}
                      placeholder="3000"
                      inputMode="numeric"
                      className="font-mono text-xs"
                    />
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="ssh-user" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      SSH user <span className="font-normal">(optional)</span>
                    </label>
                    <Input
                      id="ssh-user"
                      value={sshUserDraft}
                      onChange={(event) => setSshUserDraft(event.target.value)}
                      placeholder="root"
                      autoComplete="username"
                      className="font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label htmlFor="server-token" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      Access token <span className="font-normal">(optional)</span>
                    </label>
                    <Input
                      id="server-token"
                      type="password"
                      value={tokenDraft}
                      onChange={(event) => setTokenDraft(event.target.value)}
                      placeholder="Legacy secured servers"
                      autoComplete="off"
                      className="font-mono text-xs"
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && canConnect && !connecting) void connect();
                      }}
                    />
                  </div>
                </div>
                {connectionError && (
                  <p role="alert" className="text-xs text-destructive">{connectionError}</p>
                )}
                <Button size="sm" onClick={() => void connect()} disabled={!canConnect || connecting}>
                  {connecting ? "Connecting..." : "Connect"}
                </Button>
              </div>
            </section>
          ) : (
            <>
              <section className="rounded-lg border border-border/50 bg-card/50 p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-sm font-medium text-foreground">Server</h2>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">
                      {connection.host}:{connection.port}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
                      cfg.badge,
                    )}
                  >
                    <span className={cn("h-1.5 w-1.5 rounded-full", cfg.dot)} />
                    {cfg.label}
                  </span>
                </div>

                <div className="mt-4 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void recheck()}
                    disabled={checking}
                    className={cn(
                      "inline-flex cursor-pointer items-center gap-2 rounded-md border border-border/50 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground",
                      checking && "pointer-events-none opacity-60",
                    )}
                  >
                    <RefreshCw className={cn("h-3 w-3", checking && "animate-spin")} />
                    Test connection
                  </button>
                  <button
                    type="button"
                    onClick={() => void reset()}
                    className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border/50 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  >
                    Disconnect...
                  </button>
                </div>
              </section>

              <ToolsPanel />
            </>
          )}
        </div>
      </CenterCard>
    </div>
  );
}
