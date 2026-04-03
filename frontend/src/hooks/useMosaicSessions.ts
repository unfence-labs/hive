import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "hive-mosaic-workspaces";
const MAX_SELECTED = 4;

const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

function readIds(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((v) => typeof v === "string")) {
      return parsed as string[];
    }
  } catch {
    // corrupt data — treat as empty
  }
  return [];
}

function getSnapshot(): string {
  return localStorage.getItem(STORAGE_KEY) ?? "[]";
}

function getServerSnapshot(): string {
  return "[]";
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function writeIds(ids: string[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  notify();
}

/** Parse a tile ID into workspace ID and session ID. */
export function parseTileId(id: string): { wsId: string; sessionId?: string } {
  const sep = id.indexOf(":");
  if (sep === -1) return { wsId: id };
  return { wsId: id.substring(0, sep), sessionId: id.substring(sep + 1) };
}

/** Returns true when localStorage has never been written for mosaic selection. */
export function isMosaicFirstEntry(): boolean {
  return localStorage.getItem(STORAGE_KEY) === null;
}

export function useMosaicSessions() {
  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const selectedIds: string[] = (() => {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as string[];
    } catch {
      /* empty */
    }
    return [];
  })();

  const isSelected = useCallback(
    (tileId: string) => selectedIds.includes(tileId),
    [selectedIds],
  );

  const atMax = selectedIds.length >= MAX_SELECTED;

  const toggleSession = useCallback((tileId: string) => {
    const current = readIds();
    if (current.includes(tileId)) {
      writeIds(current.filter((x) => x !== tileId));
    } else if (current.length < MAX_SELECTED) {
      writeIds([...current, tileId]);
    }
  }, []);

  const selectSession = useCallback((tileId: string) => {
    const current = readIds();
    if (!current.includes(tileId) && current.length < MAX_SELECTED) {
      writeIds([...current, tileId]);
    }
  }, []);

  const deselectSession = useCallback((tileId: string) => {
    const current = readIds();
    writeIds(current.filter((x) => x !== tileId));
  }, []);

  /** Bulk-set selected IDs. */
  const setSelectedIds = useCallback((ids: string[]) => {
    writeIds(ids.slice(0, MAX_SELECTED));
  }, []);

  return { selectedIds, isSelected, atMax, toggleSession, selectSession, deselectSession, setSelectedIds };
}
