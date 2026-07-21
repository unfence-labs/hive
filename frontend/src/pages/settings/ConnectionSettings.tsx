import { useMemo, useState } from "react";
import { createProvisionClient } from "@/lib/provision-client";
import { RefreshCw, Server, ArrowUpCircle, CheckCircle2 } from "lucide-react";
import { isTauri } from "@/lib/is-tauri";
import { openSetupWizard } from "@/hooks/useSetupWizardRequest";
import { SettingsHeader } from "@/components/AppLayout";
import { CenterCard } from "@/components/CenterCard";
import { useTailscaleConfig } from "@/hooks/useTailscaleConfig";
import { useAuthToken } from "@/hooks/useAuthToken";
import { useConnectionStatus } from "@/hooks/useConnectionStatus";
import { loadSshConnection, clearSshConnection, type SshConnection } from "@/lib/ssh-connection";
import { useProvisionRun, ProvisionStepList } from "@/pages/setup/screens/ProvisioningScreen";
import { ErrorPanel } from "@/pages/setup/screens/ErrorPanel";
import { ToolsPanel } from "@/pages/setup/screens/GuidedSetupScreen";
import type { ProvisionClient } from "@/lib/provision-client";
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
    label: "Checking…",
    badge: "border-border bg-muted/50 text-muted-foreground",
  },
};

/**
 * Inline server-update run: streams the provision checklist under the
 * "Server software" row instead of taking over the screen.
 */
function ServerUpdateRun({
  client,
  conn,
  port,
  onDone,
  onHide,
}: {
  client: ProvisionClient;
  conn: SshConnection;
  port: string;
  onDone: () => void;
  onHide: () => void;
}) {
  const { progress, retry, error } = useProvisionRun(
    client,
    {
      host: conn.host,
      user: conn.user,
      keyPath: conn.keyPath,
      tailscaleAuthKey: "",
      skipTailscale: !conn.tailnet,
      authToken: "",
      port: Number(port) || 3000,
    },
    onDone,
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-foreground">Updating the server…</span>
        <button
          type="button"
          onClick={onHide}
          className="cursor-pointer text-xs text-muted-foreground hover:text-foreground"
        >
          Hide
        </button>
      </div>
      <ProvisionStepList progress={progress} />
      {error && <ErrorPanel error={error} onRetry={retry} />}
    </div>
  );
}

interface ConnectionSettingsProps {
  onRefreshConnection?: () => void;
}

export default function ConnectionSettings({ onRefreshConnection }: ConnectionSettingsProps) {
  const { ip, port, setIp, setPort, setSshUser, isConfigured } = useTailscaleConfig();
  const { setAuthToken } = useAuthToken();
  const { status, check } = useConnectionStatus();
  const [ipDraft, setIpDraft] = useState("");
  const [portDraft, setPortDraft] = useState("3000");
  const [checking, setChecking] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [updated, setUpdated] = useState(false);
  const [sshConn, setSshConn] = useState(() => loadSshConnection());
  const provisionClient = useMemo(() => createProvisionClient(), []);

  const recheck = async () => {
    setChecking(true);
    await new Promise((r) => setTimeout(r, 300));
    await check();
    onRefreshConnection?.();
    setChecking(false);
  };

  const connect = () => {
    const nextIp = ipDraft.trim();
    if (!nextIp) return;
    setIp(nextIp);
    setPort(portDraft.trim() || "3000");
    setSshConn(loadSshConnection());
    void recheck();
  };

  const reset = () => {
    if (
      !window.confirm(
        "Disconnect from this server? The connection details are cleared; the server itself is untouched.",
      )
    ) {
      return;
    }
    setIp("");
    setPort("");
    setSshUser("");
    setAuthToken("");
    clearSshConnection();
    setSshConn(null);
    setIpDraft("");
    setPortDraft("3000");
    onRefreshConnection?.();
  };

  const cfg = STATUS_CONFIG[status];

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <SettingsHeader>
        <h1 className="text-sm font-medium">Connection</h1>
      </SettingsHeader>

      <CenterCard scroll>
        <div className="max-w-2xl space-y-6 px-4 py-5">
          {!isConfigured ? (
            <section className="rounded-lg border border-border/50 bg-card/50 p-5">
              <h2 className="text-sm font-medium text-foreground">Connect your server</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Hive runs on your own server. Set one up from scratch, or point the app at a
                server already on your Tailscale network.
              </p>

              {isTauri() && (
                <button
                  type="button"
                  onClick={openSetupWizard}
                  className="mt-4 inline-flex cursor-pointer items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
                >
                  <Server className="h-3 w-3" />
                  Set up a new server
                </button>
              )}

              <div className="mt-5 border-t border-border/40 pt-4">
                <p className="mb-3 text-xs font-medium text-muted-foreground">
                  Or connect to an existing Hive server
                </p>
                <div className="grid grid-cols-[1fr_100px_auto] items-end gap-3">
                  <div>
                    <label htmlFor="ts-ip" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      IP or hostname
                    </label>
                    <Input
                      id="ts-ip"
                      value={ipDraft}
                      onChange={(e) => setIpDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") connect(); }}
                      placeholder="100.x.x.x"
                      className="font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label htmlFor="ts-port" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      Port
                    </label>
                    <Input
                      id="ts-port"
                      value={portDraft}
                      onChange={(e) => setPortDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") connect(); }}
                      placeholder="3000"
                      inputMode="numeric"
                      className="font-mono text-xs"
                    />
                  </div>
                  <Button size="sm" onClick={connect} disabled={!ipDraft.trim()}>
                    Connect
                  </Button>
                </div>
              </div>
            </section>
          ) : (
            <>
              <section className="rounded-lg border border-border/50 bg-card/50 p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-sm font-medium text-foreground">Server</h2>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">
                      {ip}:{port}
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
                    onClick={reset}
                    className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border/50 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  >
                    Disconnect…
                  </button>
                </div>

                {isTauri() && sshConn && (
                  <div className="mt-4 border-t border-border/40 pt-3 text-xs text-muted-foreground">
                    {updating ? (
                      <ServerUpdateRun
                        client={provisionClient}
                        conn={sshConn}
                        port={port}
                        onDone={() => { setUpdating(false); setUpdated(true); }}
                        onHide={() => setUpdating(false)}
                      />
                    ) : updated ? (
                      <span className="inline-flex items-center gap-1.5 text-success-foreground">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Server updated
                      </span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span>Server software</span>
                        <button
                          type="button"
                          onClick={() => { setUpdated(false); setUpdating(true); }}
                          className="inline-flex cursor-pointer items-center gap-1 text-primary hover:underline"
                        >
                          <ArrowUpCircle className="h-3 w-3" />
                          Update
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </section>

              <ToolsPanel />
            </>
          )}
        </div>
      </CenterCard>

    </div>
  );
}
