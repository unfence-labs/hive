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

  const toggleId = useCallback((id: string) => {
    const current = readIds();
    if (current.includes(id)) {
      writeIds(current.filter((x) => x !== id));
    } else if (current.length < MAX_MOSAIC) {
      writeIds([...current, id]);
    }
  }, []);

  const removeId = useCallback((id: string) => {
    const current = readIds();
    writeIds(current.filter((x) => x !== id));
  }, []);

  return { selectedIds, setSelectedIds, toggleId, removeId };
}

export { MAX_MOSAIC };
