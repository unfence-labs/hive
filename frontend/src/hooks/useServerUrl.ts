import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "hive-server-url";

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

/** Read the stored server URL outside of React (for useApi, ws-transport). */
export function getServerUrl(): string {
  return localStorage.getItem(STORAGE_KEY) ?? "";
}

export function useServerUrl() {
  const serverUrl = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setServerUrl = useCallback((url: string) => {
    const trimmed = url.trim().replace(/\/+$/, "");
    if (trimmed) {
      localStorage.setItem(STORAGE_KEY, trimmed);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
    notify();
  }, []);

  return { serverUrl, setServerUrl };
}
