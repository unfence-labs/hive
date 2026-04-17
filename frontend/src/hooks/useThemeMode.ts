import { useCallback, useSyncExternalStore } from "react";

export type ThemeMode = "system" | "light" | "dark";

export const THEME_MODES: ThemeMode[] = ["system", "light", "dark"];

const STORAGE_KEY = "hive-theme";
const DEFAULT_MODE: ThemeMode = "system";

const listeners = new Set<() => void>();

function isThemeMode(value: string | null): value is ThemeMode {
  return value === "system" || value === "light" || value === "dark";
}

function getSnapshot(): ThemeMode {
  const raw = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
  return isThemeMode(raw) ? raw : DEFAULT_MODE;
}

function getServerSnapshot(): ThemeMode {
  return DEFAULT_MODE;
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function applyTheme(mode: ThemeMode) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const effectivelyDark = mode === "dark" || (mode === "system" && systemPrefersDark());
  root.classList.toggle("dark", effectivelyDark);
  root.classList.toggle("light", !effectivelyDark);
}

// System preference listener — re-apply when in "system" mode
if (typeof window !== "undefined") {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", () => {
    if (getSnapshot() === "system") applyTheme("system");
  });
}

export function useThemeMode() {
  const mode = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setMode = useCallback((next: ThemeMode) => {
    localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next);
    for (const listener of listeners) listener();
  }, []);

  return { mode, setMode, options: THEME_MODES };
}
