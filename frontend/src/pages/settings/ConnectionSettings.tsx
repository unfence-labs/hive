import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { SettingsHeader } from "@/components/AppLayout";
import { CenterCard } from "@/components/CenterCard";
import { useConnection } from "@/hooks/useConnection";
import type { ConnectionStatus } from "@/hooks/useConnectionStatus";
import { useConnectionStatus } from "@/hooks/useConnectionStatus";
import { DEFAULT_BACKEND_PORT, isValidPort, switchServer } from "@/lib/server-connection";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface StatusConfig {
  dot: string;
  label: string;
  badge: string;
  /** What the operator should do next. Absent when nothing is wrong. */
  hint?: string;
}

/**
 * "Token rejected" is its own state on purpose: the server is up and answering,
 * so pointing the operator at the network would send them after the wrong
 * problem. The hint names the one thing that fixes it.
 */
const STATUS_CONFIG: Record<ConnectionStatus, StatusConfig> = {
  connected: {
    dot: "bg-success",
    label: "Connected",
    badge: "border-success-border bg-success-muted text-success-foreground",
  },
  unauthorized: {
    dot: "bg-destructive",
    label: "Token rejected",
    badge: "border-destructive/30 bg-destructive/10 text-destructive",
    hint: "The server is reachable but rejected this access token. Enter the current one, or reinstall Hive to generate a new token.",
  },
  forbidden: {
    dot: "bg-destructive",
    label: "Client refused",
    badge: "border-destructive/30 bg-destructive/10 text-destructive",
    hint: "The server is reachable but refused this client. Connect through the host name or IP the server allows.",
  },
  disconnected: {
    dot: "bg-destructive",
    label: "Unreachable",
    badge: "border-destructive/30 bg-destructive/10 text-destructive",
    hint: "The server did not answer. Check the address and port, and that the machine is online.",
  },
  unknown: {
    dot: "bg-muted-foreground/40",
    label: "Not configured",
    badge: "border-border bg-muted/50 text-muted-foreground",
  },
};

interface ConnectionSettingsProps {
  onRefreshConnection?: () => void;
}

export default function ConnectionSettings({ onRefreshConnection }: ConnectionSettingsProps) {
  const { connection } = useConnection();
  const { status, check } = useConnectionStatus();
  const [hostDraft, setHostDraft] = useState(connection?.host ?? "");
  const [portDraft, setPortDraft] = useState(String(connection?.port ?? DEFAULT_BACKEND_PORT));
  // Write-only: the stored token is never shown back, here or anywhere else.
  // The field only carries a replacement; blank means keep what is stored.
  const [tokenDraft, setTokenDraft] = useState("");
  const [sshUserDraft, setSshUserDraft] = useState(connection?.sshUser ?? "");
  const [connecting, setConnecting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed the form whenever the stored record changes underneath it — after a
  // successful connect (so the drafts show the normalized values) and when the
  // installer writes the record while this page is open. `connection` is
  // referentially stable between store writes, so typing is never clobbered.
  const [syncedFrom, setSyncedFrom] = useState(connection);
  if (connection !== syncedFrom) {
    setSyncedFrom(connection);
    setHostDraft(connection?.host ?? "");
    setPortDraft(String(connection?.port ?? DEFAULT_BACKEND_PORT));
    setTokenDraft("");
    setSshUserDraft(connection?.sshUser ?? "");
  }

  const port = Number(portDraft);
  const canConnect = hostDraft.trim().length > 0 && isValidPort(port);

  const connect = async () => {
    setConnecting(true);
    setError(null);
    try {
      await switchServer(
        {
          host: hostDraft.trim(),
          port,
          ...(connection?.protocol ? { protocol: connection.protocol } : {}),
          // Blank keeps the stored token — clearing it on every reconnect
          // would silently disconnect a client whose token was never shown.
          authToken: tokenDraft.trim() || connection?.authToken,
          sshUser: sshUserDraft.trim() || undefined,
          // Install-owned; the operator never edits it here, but replacing the
          // record must not silently drop it.
          adminUser: connection?.adminUser,
        },
        { verify: true },
      );
      await check();
      onRefreshConnection?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The server could not be reached.");
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

  const cfg = STATUS_CONFIG[status];

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <SettingsHeader>
        <h1 className="text-sm font-medium">Connection</h1>
      </SettingsHeader>

      <CenterCard scroll>
        <div className="max-w-2xl space-y-6 px-4 py-5">
          <section className="rounded-lg border border-border/50 bg-card/50 p-5">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-sm font-medium text-foreground">Server</h2>
                {!connection && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Enter the address and access token of your Hive server.
                  </p>
                )}
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

            {cfg.hint && connection && (
              <p role="status" className="mt-3 text-xs text-destructive">
                {cfg.hint}
              </p>
            )}

            <div className="mt-5 space-y-4">
              <div className="grid grid-cols-[1fr_120px] gap-3">
                <div>
                  <label htmlFor="server-host" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    Host
                  </label>
                  <Input
                    id="server-host"
                    value={hostDraft}
                    onChange={(e) => setHostDraft(e.target.value)}
                    placeholder="203.0.113.10"
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
                    onChange={(e) => setPortDraft(e.target.value)}
                    placeholder={String(DEFAULT_BACKEND_PORT)}
                    inputMode="numeric"
                    className="font-mono text-xs"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="server-token" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  Access token
                </label>
                <Input
                  id="server-token"
                  type="password"
                  value={tokenDraft}
                  onChange={(e) => setTokenDraft(e.target.value)}
                  placeholder="Paste the access token"
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono text-xs"
                />
                <p className="mt-1 text-[11px] text-muted-foreground/60">
                  {connection?.authToken
                    ? "An access token is stored for this server. It is never shown again — enter a new one only to replace it."
                    : "Sent with every request. Leave blank only for a server that has no token."}
                </p>
              </div>

              <div>
                <label htmlFor="ssh-user" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  SSH user <span className="text-muted-foreground/60">(optional)</span>
                </label>
                <Input
                  id="ssh-user"
                  value={sshUserDraft}
                  onChange={(e) => setSshUserDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && canConnect && !connecting) void connect(); }}
                  placeholder="hive"
                  autoComplete="username"
                  className="font-mono text-xs"
                />
                <p className="mt-1 text-[11px] text-muted-foreground/60">
                  The service account used for editor and terminal sessions. Do not use the admin
                  login — files saved as root stop being writable by the agent.
                </p>
              </div>

              {connection?.adminUser && (
                <p className="text-[11px] text-muted-foreground/60">
                  Admin login used to install this server:{" "}
                  <span className="font-mono">{connection.adminUser}</span>
                </p>
              )}

              {error && (
                <p role="alert" className="text-xs text-destructive">{error}</p>
              )}

              <div className="flex items-center gap-2">
                <Button size="sm" onClick={() => void connect()} disabled={!canConnect || connecting}>
                  {connecting ? "Connecting..." : "Connect"}
                </Button>
                {connection && (
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
                )}
              </div>
            </div>
          </section>
        </div>
      </CenterCard>
    </div>
  );
}
