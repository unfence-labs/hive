"use client";

import { useEffect, useState } from "react";

const THEMES = [
  { id: "ember", label: "Ember", swatch: "#ff7048", bg: "#0b0b10" },
  { id: "daylight", label: "Daylight", swatch: "#5b57f5", bg: "#f6f6f3" },
] as const;

type ThemeId = (typeof THEMES)[number]["id"];
const STORAGE_KEY = "hive-theme";
const DEFAULT_THEME: ThemeId = "ember";

export function ThemeSwitcher() {
  const [theme, setTheme] = useState<ThemeId>(DEFAULT_THEME);
  const [open, setOpen] = useState(false);

  // Sync from whatever the no-flash inline script already applied.
  useEffect(() => {
    const current = document.documentElement.dataset.theme as ThemeId | undefined;
    if (current) setTheme(current);
  }, []);

  const apply = (id: ThemeId) => {
    setTheme(id);
    document.documentElement.dataset.theme = id;
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* private mode. Theme still applies for this session. */
    }
  };

  const active = THEMES.find((t) => t.id === theme) ?? THEMES[0];

  return (
    <div className={`theme-switcher${open ? " open" : ""}`}>
      <div className="theme-options" role="listbox" aria-label="Color theme">
        {THEMES.map((t) => (
          <button
            key={t.id}
            type="button"
            role="option"
            aria-selected={t.id === theme}
            className={`theme-option${t.id === theme ? " active" : ""}`}
            style={
              { "--swatch": t.swatch, "--swatch-bg": t.bg } as React.CSSProperties
            }
            onClick={() => apply(t.id)}
            title={t.label}
          >
            <span className="theme-dot" />
            <span className="theme-name">{t.label}</span>
          </button>
        ))}
      </div>
      <button
        type="button"
        className="theme-trigger"
        aria-expanded={open}
        aria-label={`Color theme: ${active.label}. Change theme`}
        onClick={() => setOpen((v) => !v)}
        style={{ "--swatch": active.swatch } as React.CSSProperties}
      >
        <PaletteIcon />
      </button>
    </div>
  );
}

function PaletteIcon() {
  return (
    <svg viewBox="0 0 24 24" width="19" height="19" fill="none" aria-hidden="true">
      <path
        d="M12 3a9 9 0 0 0 0 18c1.1 0 1.8-.9 1.8-1.9 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.1 0-1 .8-1.8 1.8-1.8H16a5 5 0 0 0 5-5c0-3.9-4-7-9-7Z"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <circle cx="7.5" cy="11" r="1.1" fill="currentColor" />
      <circle cx="10.5" cy="7.5" r="1.1" fill="currentColor" />
      <circle cx="14.5" cy="7.5" r="1.1" fill="currentColor" />
      <circle cx="17" cy="11" r="1.1" fill="currentColor" />
    </svg>
  );
}
