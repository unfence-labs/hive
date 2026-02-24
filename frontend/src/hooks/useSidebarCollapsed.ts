import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "hive-sidebar-collapsed";

const listeners = new Set<() => void>();

function getSnapshot(): boolean {
  return localStorage.getItem(STORAGE_KEY) === "true";
}

function getServerSnapshot(): boolean {
  return false;
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function notify() {
  for (const listener of listeners) listener();
}

export function toggleSidebar() {
  const next = !getSnapshot();
  localStorage.setItem(STORAGE_KEY, String(next));
  notify();
}

export function useSidebarCollapsed() {
  const collapsed = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggle = useCallback(() => {
    toggleSidebar();
  }, []);

  return { collapsed, toggle };
}
