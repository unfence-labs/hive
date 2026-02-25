import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { SettingsHeader } from "@/components/AppLayout";
import { useTailscaleConfig } from "@/hooks/useTailscaleConfig";
import { useConnectionStatus } from "@/hooks/useConnectionStatus";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const STATUS_CONFIG: Record<string, { dot: string; label: string; badge: string }> = {
  connected: {
    dot: "bg-emerald-500",
    label: "Connected",
    badge: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  },
  disconnected: {
    dot: "bg-red-500",
    label: "Unreachable",
    badge: "border-red-500/30 bg-red-500/10 text-red-400",
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
  const { status, check } = useConnectionStatus();
  const [ipDraft, setIpDraft] = useState(ip);
  const [portDraft, setPortDraft] = useState(port);
  const [sshUserDraft, setSshUserDraft] = useState(sshUser);
  const [checking, setChecking] = useState(false);

  const save = (nextIp: string, nextPort: string) => {
    setIp(nextIp);
    setPort(nextPort);
    setTimeout(async () => { await check(); onRefreshConnection?.(); }, 300);
  };
  const saveIp = () => save(ipDraft, port);
  const savePort = () => save(ip, portDraft);
  const saveSshUser = () => setSshUser(sshUserDraft);

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
    <div className="flex h-full flex-col overflow-auto">
      <SettingsHeader>
        <h1 className="text-sm font-medium">Connection</h1>
      </SettingsHeader>

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
      </div>
    </div>
  );
}
