import { useState } from "react";
import { useTailscaleConfig } from "@/hooks/useTailscaleConfig";
import { useConnectionStatus } from "@/hooks/useConnectionStatus";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const STATUS_DOT: Record<string, string> = {
  connected: "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)]",
  disconnected: "bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.6)]",
  unknown: "bg-muted-foreground/40",
};

const STATUS_LABEL: Record<string, string> = {
  connected: "Connected",
  disconnected: "Unreachable",
  unknown: "Not configured",
};

interface ConnectionSettingsProps {
  onRefreshConnection?: () => void;
}

export default function ConnectionSettings({ onRefreshConnection }: ConnectionSettingsProps) {
  const { ip, port, setIp, setPort } = useTailscaleConfig();
  const { status, check } = useConnectionStatus();
  const [ipDraft, setIpDraft] = useState(ip);
  const [portDraft, setPortDraft] = useState(port);

  const save = (nextIp: string, nextPort: string) => {
    setIp(nextIp);
    setPort(nextPort);
    setTimeout(async () => { await check(); onRefreshConnection?.(); }, 300);
  };
  const saveIp = () => save(ipDraft, port);
  const savePort = () => save(ip, portDraft);

  return (
    <div className="flex h-full flex-col overflow-auto">
      <div className="border-b border-border/50 px-6 py-4">
        <h1 className="text-sm font-semibold">Connection</h1>
      </div>

      <div className="max-w-xl space-y-8 p-6">
        <section>
          <h2 className="mb-1 text-sm font-medium text-foreground">Tailscale connection</h2>
          <p className="mb-4 text-xs text-muted-foreground">
            Connect to your Hive backend via Tailscale.
          </p>

          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Tailscale IP
              </label>
              <Input
                value={ipDraft}
                onChange={(e) => setIpDraft(e.target.value)}
                onBlur={saveIp}
                onKeyDown={(e) => { if (e.key === "Enter") saveIp(); }}
                placeholder="100.x.x.x"
                className="max-w-xs font-mono text-xs"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Backend port
              </label>
              <Input
                value={portDraft}
                onChange={(e) => setPortDraft(e.target.value)}
                onBlur={savePort}
                onKeyDown={(e) => { if (e.key === "Enter") savePort(); }}
                placeholder="3000"
                className="max-w-xs font-mono text-xs"
              />
            </div>

            <div className="flex items-center gap-2">
              <span className={cn("h-2 w-2 rounded-full", STATUS_DOT[status])} />
              <span className="text-xs text-muted-foreground">{STATUS_LABEL[status]}</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
