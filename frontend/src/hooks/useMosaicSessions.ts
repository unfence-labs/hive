import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "hive-mosaic-hidden-sessions";

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

export function useMosaicSessions() {
  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const hiddenIds: string[] = (() => {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as string[];
    } catch {
      /* empty */
    }
    return [];
  })();

  const isHidden = useCallback(
    (tileId: string) => hiddenIds.includes(tileId),
    [hiddenIds],
  );

  const toggleSession = useCallback((tileId: string) => {
    const current = readIds();
    if (current.includes(tileId)) {
      writeIds(current.filter((x) => x !== tileId));
    } else {
      writeIds([...current, tileId]);
    }
  }, []);

  const hideSession = useCallback((tileId: string) => {
    const current = readIds();
    if (!current.includes(tileId)) {
      writeIds([...current, tileId]);
    }
  }, []);

  const showSession = useCallback((tileId: string) => {
    const current = readIds();
    writeIds(current.filter((x) => x !== tileId));
  }, []);

  /** Bulk-set hidden IDs (used for migration or cleanup). */
  const setHiddenIds = useCallback((ids: string[]) => {
    writeIds(ids);
  }, []);

  return { hiddenIds, isHidden, toggleSession, hideSession, showSession, setHiddenIds };
}
