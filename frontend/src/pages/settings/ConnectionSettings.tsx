import { useState } from "react";
import { RefreshCw, Eye, EyeOff, Server } from "lucide-react";
import { isTauri } from "@/lib/is-tauri";
import { openSetupWizard } from "@/hooks/useSetupWizardRequest";
import { SettingsHeader } from "@/components/AppLayout";
import { CenterCard } from "@/components/CenterCard";
import { useTailscaleConfig } from "@/hooks/useTailscaleConfig";
import { useAuthToken } from "@/hooks/useAuthToken";
import { useConnectionStatus } from "@/hooks/useConnectionStatus";
import ServerToolsSettings from "@/pages/settings/ServerToolsSettings";
import { Input } from "@/components/ui/input";
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
    label: "Not configured",
    badge: "border-border bg-muted/50 text-muted-foreground",
  },
};

interface ConnectionSettingsProps {
  onRefreshConnection?: () => void;
}

export default function ConnectionSettings({ onRefreshConnection }: ConnectionSettingsProps) {
  const { ip, port, sshUser, setIp, setPort, setSshUser } = useTailscaleConfig();
  const { authToken, setAuthToken } = useAuthToken();
  const { status, check } = useConnectionStatus();
  const [ipDraft, setIpDraft] = useState(ip);
  const [portDraft, setPortDraft] = useState(port);
  const [sshUserDraft, setSshUserDraft] = useState(sshUser);
  const [tokenDraft, setTokenDraft] = useState(authToken);
  const [tokenRevealed, setTokenRevealed] = useState(false);
  const [checking, setChecking] = useState(false);

  const save = (nextIp: string, nextPort: string) => {
    setIp(nextIp);
    setPort(nextPort);
    setTimeout(async () => { await check(); onRefreshConnection?.(); }, 300);
  };
  const saveIp = () => save(ipDraft, port);
  const savePort = () => save(ip, portDraft);
  const saveSshUser = () => setSshUser(sshUserDraft);
  const saveToken = () => setAuthToken(tokenDraft);

  const handleTest = async () => {
    setChecking(true);
    save(ipDraft, portDraft);
    await new Promise((r) => setTimeout(r, 400));
    await check();
    onRefreshConnection?.();
    setChecking(false);
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
              <h2 className="text-sm font-medium text-foreground">Tailscale</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Connect to your backend over a Tailscale network.
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

          <div className="mt-5 space-y-4">
            <div className="grid grid-cols-[1fr_120px] gap-3">
              <div>
                <label htmlFor="ts-ip" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  Tailscale IP
                </label>
                <Input
                  id="ts-ip"
                  value={ipDraft}
                  onChange={(e) => setIpDraft(e.target.value)}
                  onBlur={saveIp}
                  onKeyDown={(e) => { if (e.key === "Enter") saveIp(); }}
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
                  onBlur={savePort}
                  onKeyDown={(e) => { if (e.key === "Enter") savePort(); }}
                  placeholder="3000"
                  inputMode="numeric"
                  className="font-mono text-xs"
                />
              </div>
            </div>

            <div>
              <label htmlFor="ssh-user" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                SSH User <span className="text-muted-foreground/60">(optional)</span>
              </label>
              <Input
                id="ssh-user"
                value={sshUserDraft}
                onChange={(e) => setSshUserDraft(e.target.value)}
                onBlur={saveSshUser}
                onKeyDown={(e) => { if (e.key === "Enter") saveSshUser(); }}
                placeholder="root"
                className="font-mono text-xs"
              />
              <p className="mt-1 text-[11px] text-muted-foreground/60">
                Used for VS Code Remote SSH. Leave blank to use IP only.
              </p>
            </div>

            <div>
              <label htmlFor="auth-token" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Auth token <span className="text-muted-foreground/60">(optional)</span>
              </label>
              <div className="relative">
                <Input
                  id="auth-token"
                  type={tokenRevealed ? "text" : "password"}
                  value={tokenDraft}
                  onChange={(e) => setTokenDraft(e.target.value)}
                  onBlur={saveToken}
                  onKeyDown={(e) => { if (e.key === "Enter") saveToken(); }}
                  placeholder="hive-…"
                  autoComplete="off"
                  spellCheck={false}
                  className="pr-9 font-mono text-xs"
                />
                <button
                  type="button"
                  onClick={() => setTokenRevealed((v) => !v)}
                  aria-label={tokenRevealed ? "Hide token" : "Show token"}
                  className="absolute inset-y-0 right-0 flex items-center px-2.5 text-muted-foreground/60 transition-colors hover:text-foreground"
                >
                  {tokenRevealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground/60">
                Sent as a bearer token to the backend. Set during install; change here if you rotate it.
              </p>
            </div>

            <button
              type="button"
              onClick={() => void handleTest()}
              disabled={checking || (!ipDraft && !portDraft)}
              className={cn(
                "inline-flex cursor-pointer items-center gap-2 rounded-md border border-border/50 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground",
                checking && "pointer-events-none opacity-60",
              )}
            >
              <RefreshCw className={cn("h-3 w-3", checking && "animate-spin")} />
              Test connection
            </button>
          </div>
        </section>

        {isTauri() && (
          <section className="rounded-lg border border-border/50 bg-card/50 p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-sm font-medium">New server</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Provision a fresh VPS from scratch: Tailscale, the Hive backend, and agent
                  CLIs — all driven from this app, no terminal needed.
                </p>
              </div>
              <button
                type="button"
                onClick={openSetupWizard}
                className="inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-md border border-border/50 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
              >
                <Server className="h-3 w-3" />
                Set up a new server
              </button>
            </div>
          </section>
        )}

        <ServerToolsSettings />
      </div>
      </CenterCard>
    </div>
  );
}
