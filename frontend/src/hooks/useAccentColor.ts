import { useCallback, useSyncExternalStore } from "react";

export interface AccentOption {
  id: string;
  label: string;
  color: string;
}

export const ACCENT_OPTIONS: AccentOption[] = [
  { id: "violet", label: "Violet", color: "#7c3aed" },
  { id: "blue", label: "Blue", color: "#3b82f6" },
  { id: "cyan", label: "Cyan", color: "#06b6d4" },
  { id: "emerald", label: "Emerald", color: "#10b981" },
  { id: "amber", label: "Amber", color: "#f59e0b" },
  { id: "rose", label: "Rose", color: "#f43f5e" },
];

const STORAGE_KEY = "hive-accent";
const DEFAULT_ID = "violet";

const listeners = new Set<() => void>();

function getSnapshot(): string {
  return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_ID;
}

function getServerSnapshot(): string {
  return DEFAULT_ID;
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function applyAccent(id: string) {
  const option = ACCENT_OPTIONS.find((o) => o.id === id) ?? ACCENT_OPTIONS[0];
  document.documentElement.style.setProperty("--hive-accent", option.color);
}

// Apply on module load so the accent is set before first render
applyAccent(getSnapshot());

export function useAccentColor() {
  const accentId = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setAccent = useCallback((id: string) => {
    localStorage.setItem(STORAGE_KEY, id);
    applyAccent(id);
    for (const listener of listeners) listener();
  }, []);

  const current = ACCENT_OPTIONS.find((o) => o.id === accentId) ?? ACCENT_OPTIONS[0];

  return { accentId, setAccent, current, options: ACCENT_OPTIONS };
}
