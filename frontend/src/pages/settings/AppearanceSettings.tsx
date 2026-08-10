import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useAccentColor } from "@/hooks/useAccentColor";
import { useThemeMode, type ThemeMode } from "@/hooks/useThemeMode";
import { TOAST_POSITIONS, useToastPosition } from "@/hooks/useToastPosition";
import { SettingsHeader } from "@/components/AppLayout";
import { CenterCard } from "@/components/CenterCard";
import { cn } from "@/lib/utils";

const THEME_OPTIONS: { id: ThemeMode; label: string; Icon: typeof Sun }[] = [
  { id: "system", label: "System", Icon: Monitor },
  { id: "light", label: "Light", Icon: Sun },
  { id: "dark", label: "Dark", Icon: Moon },
];

export default function AppearanceSettings() {
  const { accentId, setAccent, options } = useAccentColor();
  const { mode, setMode } = useThemeMode();
  const { position, setPosition } = useToastPosition();

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <SettingsHeader>
        <h1 className="text-sm font-medium">Appearance</h1>
      </SettingsHeader>

      <CenterCard scroll>
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

        <section>
          <div className="rounded-lg border border-border/50 bg-card/50 p-5">
            <h2 className="text-sm font-medium text-foreground">Toast position</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Choose where notifications appear in the app.
            </p>
            <div
              role="radiogroup"
              aria-label="Toast position"
              className="mt-5 grid h-28 w-48 grid-cols-3 grid-rows-2 overflow-hidden rounded-lg border border-border bg-background shadow-inner"
            >
              {TOAST_POSITIONS.map((option) => (
                <label
                  key={option.id}
                  title={option.label}
                  className="group relative flex min-h-11 cursor-pointer items-center justify-center border-border transition-colors has-checked:bg-primary/8 has-focus-visible:z-10 has-focus-visible:ring-[3px] has-focus-visible:ring-inset has-focus-visible:ring-ring/50 [&:nth-child(-n+3)]:border-b [&:not(:nth-child(3n))]:border-r"
                >
                  <input
                    type="radio"
                    name="toast-position"
                    value={option.id}
                    checked={position === option.id}
                    onChange={() => setPosition(option.id)}
                    className="sr-only"
                  />
                  <span
                    aria-hidden="true"
                    className={cn(
                      "h-2 w-8 rounded-sm border transition-colors",
                      position === option.id
                        ? "border-primary bg-primary"
                        : "border-muted-foreground/40 bg-muted group-hover:border-muted-foreground/70",
                    )}
                  />
                  <span className="sr-only">{option.label}</span>
                </label>
              ))}
            </div>
          </div>
        </section>
      </div>
      </CenterCard>
    </div>
  );
}
