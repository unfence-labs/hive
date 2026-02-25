import { useSyncExternalStore } from "react";

const STORAGE_KEY = "hive-sidebar-collapsed";
const listeners = new Set<() => void>();

function getSnapshot(): boolean {
  return localStorage.getItem(STORAGE_KEY) === "true";
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function toggleSidebar(): void {
  const next = !getSnapshot();
  localStorage.setItem(STORAGE_KEY, String(next));
  for (const fn of listeners) fn();
}

export function useSidebarCollapsed() {
  const collapsed = useSyncExternalStore(subscribe, getSnapshot);
  return { collapsed, toggleSidebar } as const;
}
