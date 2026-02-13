import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "hive-vps-target";

const listeners = new Set<() => void>();

function getSnapshot(): string {
  return localStorage.getItem(STORAGE_KEY) ?? "";
}

function getServerSnapshot(): string {
  return "";
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function notify() {
  for (const listener of listeners) listener();
}

export function useVpsTarget() {
  const vpsTarget = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setVpsTarget = useCallback((value: string) => {
    const trimmed = value.trim();
    if (trimmed) {
      localStorage.setItem(STORAGE_KEY, trimmed);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
    notify();
  }, []);

  return { vpsTarget, setVpsTarget };
}
