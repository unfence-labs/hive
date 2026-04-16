import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useAccentColor } from "@/hooks/useAccentColor";
import { useThemeMode, type ThemeMode } from "@/hooks/useThemeMode";
import { SettingsHeader } from "@/components/AppLayout";
import { cn } from "@/lib/utils";

const THEME_OPTIONS: { id: ThemeMode; label: string; Icon: typeof Sun }[] = [
  { id: "system", label: "System", Icon: Monitor },
  { id: "light", label: "Light", Icon: Sun },
  { id: "dark", label: "Dark", Icon: Moon },
];

export default function AppearanceSettings() {
  const { accentId, setAccent, options } = useAccentColor();
  const { mode, setMode } = useThemeMode();

  return (
    <div className="flex h-full flex-col overflow-auto">
      <SettingsHeader>
        <h1 className="text-sm font-medium">Appearance</h1>
      </SettingsHeader>

      <div className="max-w-2xl space-y-5 px-4 py-5">
        <section>
          <div className="rounded-lg border border-border/50 bg-card/50 p-5">
            <h2 className="text-sm font-medium text-foreground">Theme</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Choose how Hive looks. System follows your OS preference.
            </p>
            <div
              role="radiogroup"
              aria-label="Theme mode"
              className="mt-5 grid grid-cols-3 gap-2"
            >
              {THEME_OPTIONS.map(({ id, label, Icon }) => {
                const isActive = id === mode;
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={isActive}
                    onClick={() => setMode(id)}
                    className={cn(
                      "group flex cursor-pointer flex-col items-center gap-2 rounded-lg border px-3 py-4 transition-all duration-200",
                      isActive
                        ? "border-primary/40 bg-primary/8 text-foreground"
                        : "border-border/50 bg-transparent text-muted-foreground hover:border-border hover:bg-muted/40 hover:text-foreground",
                    )}
                  >
                    <Icon
                      className={cn(
                        "h-5 w-5 transition-colors",
                        isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
                      )}
                      strokeWidth={1.75}
                    />
                    <span className="text-xs font-medium">{label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

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
