import { Check } from "lucide-react";
import { useAccentColor } from "@/hooks/useAccentColor";
import { cn } from "@/lib/utils";

export default function AppearanceSettings() {
  const { accentId, setAccent, options } = useAccentColor();

  return (
    <div className="flex h-full flex-col overflow-auto">
      <div className="border-b border-border/50 px-8 py-5" data-tauri-drag-region>
        <h1 className="text-base font-semibold">Appearance</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Customize how Hive looks on your device.
        </p>
      </div>

      <div className="max-w-2xl space-y-8 px-8 py-6">
        <section>
          <div className="rounded-lg border border-border/50 bg-card/50 p-5">
            <h2 className="text-sm font-medium text-foreground">Accent color</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Applies to active states, badges, focus rings, and highlights.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              {options.map((option) => {
                const isActive = option.id === accentId;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setAccent(option.id)}
                    className={cn(
                      "group flex cursor-pointer flex-col items-center gap-2 rounded-lg px-3 py-2.5 transition-all duration-200",
                      isActive
                        ? "bg-primary/8"
                        : "hover:bg-muted/40",
                    )}
                    aria-label={`Accent color: ${option.label}`}
                    title={option.label}
                  >
                    <span
                      className={cn(
                        "relative flex h-9 w-9 items-center justify-center rounded-full transition-all duration-200",
                        !isActive && "group-hover:scale-110",
                      )}
                      style={{
                        backgroundColor: option.color,
                        boxShadow: isActive
                          ? `0 0 0 2px var(--background), 0 0 0 3.5px ${option.color}, 0 0 20px ${option.color}30`
                          : "none",
                      }}
                    >
                      {isActive && <Check className="h-4 w-4 text-white" strokeWidth={2.5} />}
                    </span>
                    <span
                      className={cn(
                        "text-[10px] font-medium transition-colors",
                        isActive ? "text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {option.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
