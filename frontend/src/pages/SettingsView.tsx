import { useState } from "react";
import { Check } from "lucide-react";
import { useAccentColor } from "@/hooks/useAccentColor";
import { useServerUrl } from "@/hooks/useServerUrl";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export default function SettingsView() {
  const { accentId, setAccent, options } = useAccentColor();
  const { serverUrl, setServerUrl } = useServerUrl();
  const [draft, setDraft] = useState(serverUrl);

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

        {/* Server URL */}
        <section>
          <h2 className="mb-1 text-sm font-medium text-foreground">Server URL</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Backend address for API and WebSocket connections. Leave empty to use the current host.
          </p>
          <div className="flex gap-2">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => setServerUrl(draft)}
              onKeyDown={(e) => { if (e.key === "Enter") setServerUrl(draft); }}
              placeholder="http://localhost:3000"
              className="max-w-xs font-mono text-xs"
            />
            {draft !== serverUrl && (
              <span className="self-center text-[10px] text-muted-foreground">unsaved</span>
            )}
          </div>
          {serverUrl && (
            <p className="mt-2 text-[10px] text-muted-foreground">
              Active: <span className="font-mono text-foreground">{serverUrl}</span>
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
