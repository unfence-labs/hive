import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "hive-auth-token";

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

/**
 * Read the runtime auth token outside of React (for useApi, ws-url,
 * ws-transport, browser-stream, image-url). The install flow issues this token
 * at runtime instead of the old build-time `VITE_HIVE_AUTH_TOKEN`.
 *
 * The env var is kept only as a one-time seed fallback so existing dev setups
 * that still export `VITE_HIVE_AUTH_TOKEN` keep working until a token is stored.
 */
export function getAuthToken(): string {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) return stored;
  return import.meta.env.VITE_HIVE_AUTH_TOKEN?.trim() ?? "";
}

export function useAuthToken() {
  const stored = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  // Mirror getAuthToken()'s seed fallback so the hook and non-React reader agree.
  const authToken = stored || (import.meta.env.VITE_HIVE_AUTH_TOKEN?.trim() ?? "");

  const setAuthToken = useCallback((token: string) => {
    const trimmed = token.trim();
    if (trimmed) {
      localStorage.setItem(STORAGE_KEY, trimmed);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
    notify();
  }, []);

  return { authToken, setAuthToken };
}
