import { useCallback, useSyncExternalStore } from "react";

export const TOAST_POSITIONS = [
  { id: "top-left", label: "Top left" },
  { id: "top-center", label: "Top center" },
  { id: "top-right", label: "Top right" },
  { id: "bottom-left", label: "Bottom left" },
  { id: "bottom-center", label: "Bottom center" },
  { id: "bottom-right", label: "Bottom right" },
] as const;

export type ToastPosition = (typeof TOAST_POSITIONS)[number]["id"];

const STORAGE_KEY = "hive-toast-position";
const DEFAULT_POSITION: ToastPosition = "bottom-left";
const listeners = new Set<() => void>();

function isToastPosition(value: string | null): value is ToastPosition {
  return TOAST_POSITIONS.some((option) => option.id === value);
}

function getSnapshot(): ToastPosition {
  const value = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
  return isToastPosition(value) ? value : DEFAULT_POSITION;
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function useToastPosition() {
  const position = useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_POSITION);

  const setPosition = useCallback((next: ToastPosition) => {
    localStorage.setItem(STORAGE_KEY, next);
    for (const listener of listeners) listener();
  }, []);

  return { position, setPosition };
}
