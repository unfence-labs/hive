import { useState } from "react";
import { Check } from "lucide-react";
import { useAccentColor } from "@/hooks/useAccentColor";
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

interface SettingsViewProps {
  onRefreshConnection?: () => void;
}

export default function SettingsView({ onRefreshConnection }: SettingsViewProps) {
  const { accentId, setAccent, options } = useAccentColor();
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
        <h1 className="text-sm font-semibold">Settings</h1>
      </div>

      <div className="max-w-xl space-y-8 p-6">
        {/* Accent Color */}
        <section>
          <h2 className="mb-1 text-sm font-medium text-foreground">Accent color</h2>
          <p className="mb-4 text-xs text-muted-foreground">
            Applies to active states, badges, focus rings, and highlights.
          </p>
          <div className="flex gap-3">
            {options.map((option) => {
              const isActive = option.id === accentId;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setAccent(option.id)}
                  className={cn(
                    "group flex flex-col items-center gap-1.5 rounded-lg p-2 transition-colors",
                    isActive ? "bg-primary/10" : "hover:bg-muted/50",
                  )}
                  aria-label={`Accent color: ${option.label}`}
                  title={option.label}
                >
                  <span
                    className="relative flex h-8 w-8 items-center justify-center rounded-full transition-shadow"
                    style={{
                      backgroundColor: option.color,
                      boxShadow: isActive
                        ? `0 0 0 2px var(--background), 0 0 0 4px ${option.color}, 0 0 16px ${option.color}40`
                        : "none",
                    }}
                  >
                    {isActive && <Check className="size-4 text-white" strokeWidth={3} />}
                  </span>
                  <span className={cn(
                    "text-[10px]",
                    isActive ? "text-foreground" : "text-muted-foreground",
                  )}>
                    {option.label}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* Tailscale Connection */}
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
