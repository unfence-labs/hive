import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "hive-mosaic-workspaces";
const MAX_MOSAIC = 4;

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

/** Serialised snapshot string so useSyncExternalStore can use referential equality. */
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

/** Parse a tile ID into workspace ID and optional pinned session ID. */
export function parseTileId(id: string): { wsId: string; sessionId?: string } {
  const sep = id.indexOf(":");
  if (sep === -1) return { wsId: id };
  return { wsId: id.substring(0, sep), sessionId: id.substring(sep + 1) };
}

export function useMosaicWorkspaces() {
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

  const setSelectedIds = useCallback((ids: string[]) => {
    writeIds(ids.slice(0, MAX_MOSAIC));
  }, []);

  /** Toggle a workspace from the picker (removes ALL tiles for that workspace, or adds the base ID). */
  const toggleId = useCallback((wsId: string) => {
    const current = readIds();
    const hasTiles = current.some((x) => parseTileId(x).wsId === wsId);
    if (hasTiles) {
      writeIds(current.filter((x) => parseTileId(x).wsId !== wsId));
    } else if (current.length < MAX_MOSAIC) {
      writeIds([...current, wsId]);
    }
  }, []);

  /** Remove a specific tile (base or composite). */
  const removeId = useCallback((id: string) => {
    const current = readIds();
    writeIds(current.filter((x) => x !== id));
  }, []);

  /** Add a session-pinned tile (composite ID like "wsId:sessionId"). */
  const addTileId = useCallback((compositeId: string) => {
    const current = readIds();
    if (current.length < MAX_MOSAIC && !current.includes(compositeId)) {
      writeIds([...current, compositeId]);
    }
  }, []);

  return { selectedIds, setSelectedIds, toggleId, removeId, addTileId };
}

export { MAX_MOSAIC };
