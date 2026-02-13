import { useState } from "react";
import { Check } from "lucide-react";
import { useAccentColor } from "@/hooks/useAccentColor";
import { useServerUrl } from "@/hooks/useServerUrl";
import { useVpsTarget } from "@/hooks/useVpsTarget";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

function getPortFromUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.port || (u.protocol === "https:" ? "443" : "80");
  } catch {
    return "3000";
  }
}

export default function SettingsView() {
  const { accentId, setAccent, options } = useAccentColor();
  const { serverUrl, setServerUrl } = useServerUrl();
  const { vpsTarget, setVpsTarget } = useVpsTarget();
  const [draft, setDraft] = useState(serverUrl || "http://localhost:3000");
  const [vpsDraft, setVpsDraft] = useState(vpsTarget);

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

        {/* Connection */}
        <section>
          <h2 className="mb-1 text-sm font-medium text-foreground">Connection</h2>
          <p className="mb-4 text-xs text-muted-foreground">
            Connect to a remote backend via SSH tunnel.
          </p>

          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Local address
              </label>
              <div className="flex gap-2">
                <Input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => setServerUrl(draft)}
                  onKeyDown={(e) => { if (e.key === "Enter") setServerUrl(draft); }}
                  placeholder="http://localhost:3000"
                  className="max-w-xs font-mono text-xs"
                />
                {draft !== (serverUrl || "http://localhost:3000") && (
                  <span className="self-center text-[10px] text-muted-foreground">unsaved</span>
                )}
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                VPS target
              </label>
              <div className="flex gap-2">
                <Input
                  value={vpsDraft}
                  onChange={(e) => setVpsDraft(e.target.value)}
                  onBlur={() => setVpsTarget(vpsDraft)}
                  onKeyDown={(e) => { if (e.key === "Enter") setVpsTarget(vpsDraft); }}
                  placeholder="user@192.168.1.1"
                  className="max-w-xs font-mono text-xs"
                />
                {vpsDraft !== vpsTarget && (
                  <span className="self-center text-[10px] text-muted-foreground">unsaved</span>
                )}
              </div>
              {vpsTarget && (
                <p className="mt-1.5 text-[10px] text-muted-foreground">
                  Run on your machine:{" "}
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground">
                    ssh -L {getPortFromUrl(draft || "http://localhost:3000")}:localhost:{getPortFromUrl(draft || "http://localhost:3000")} {vpsTarget}
                  </code>
                </p>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
