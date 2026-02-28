import { useState, useCallback, useEffect, useRef } from "react";
import type { TabId } from "../types";

export interface UseTabsReturn {
  activeTabId: TabId | null;
  openFile: string | null;
  isFileTabActive: boolean;
  activateTab: (id: TabId) => void;
  openFileTab: (path: string) => void;
  closeFileTab: () => void;
}

interface TabSnapshot {
  activeTabId: TabId | null;
  openFile: string | null;
}

/** Module-level cache: survives component remounts, lost on page refresh. */
const snapshotByWorkspace = new Map<string, TabSnapshot>();

/** Visible for testing only. */
export function _resetSnapshotCache() {
  snapshotByWorkspace.clear();
}

export function useTabs(
  currentSessionId: string | undefined,
  wsId: string | undefined,
): UseTabsReturn {
  const prevWsId = useRef(wsId);

  // Resolve initial state: restore from cache if available, else default.
  const [activeTabId, setActiveTabId] = useState<TabId | null>(() => {
    const cached = wsId ? snapshotByWorkspace.get(wsId) : undefined;
    if (cached) return cached.activeTabId;
    return currentSessionId ? `session:${currentSessionId}` : null;
  });
  const [openFile, setOpenFile] = useState<string | null>(() => {
    const cached = wsId ? snapshotByWorkspace.get(wsId) : undefined;
    return cached?.openFile ?? null;
  });

  // On workspace switch: save outgoing state, restore incoming state.
  useEffect(() => {
    if (prevWsId.current === wsId) return;

    // Save outgoing workspace state.
    if (prevWsId.current) {
      snapshotByWorkspace.set(prevWsId.current, { activeTabId, openFile });
    }
    prevWsId.current = wsId;

    // Restore incoming workspace state (or reset).
    const cached = wsId ? snapshotByWorkspace.get(wsId) : undefined;
    if (cached) {
      setActiveTabId(cached.activeTabId);
      setOpenFile(cached.openFile);
    } else {
      setActiveTabId(null);
      setOpenFile(null);
    }
  }, [wsId]); // eslint-disable-line react-hooks/exhaustive-deps

  // When currentSessionId changes and the active tab is a session tab (or null), track it.
  // If the user is on a file tab, don't disturb them.
  useEffect(() => {
    if (!currentSessionId) return;
    setActiveTabId((prev) => {
      if (!prev || prev.startsWith("session:")) {
        return `session:${currentSessionId}`;
      }
      return prev;
    });
  }, [currentSessionId]);

  const activateTab = useCallback((id: TabId) => {
    setActiveTabId(id);
  }, []);

  const openFileTab = useCallback((path: string) => {
    setOpenFile(path);
    setActiveTabId(`file:${path}`);
  }, []);

  const closeFileTab = useCallback(() => {
    setOpenFile(null);
    setActiveTabId(currentSessionId ? `session:${currentSessionId}` : null);
  }, [currentSessionId]);

  const isFileTabActive = activeTabId?.startsWith("file:") ?? false;

  return {
    activeTabId,
    openFile,
    isFileTabActive,
    activateTab,
    openFileTab,
    closeFileTab,
  };
}
