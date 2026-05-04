import { useState, useCallback, useEffect, useRef } from "react";
import { parseTabId, tabId, type DiffScope, type TabId } from "../types";

export type FileViewMode = "source" | "diff";

export interface UseTabsReturn {
  activeTabId: TabId | null;
  openFile: string | null;
  fileViewMode: FileViewMode;
  diffScope: DiffScope;
  isFileTabActive: boolean;
  activateTab: (id: TabId) => void;
  openFileTab: (path: string) => void;
  openDiffTab: (path: string, scope?: DiffScope) => void;
  setFileViewMode: (mode: FileViewMode) => void;
  setDiffScope: (scope: DiffScope) => void;
  closeFileTab: () => void;
}

interface TabSnapshot {
  activeTabId: TabId | null;
  openFile: string | null;
  fileViewMode: FileViewMode;
  diffScope: DiffScope;
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
  const latestSnapshot = useRef<TabSnapshot>({ activeTabId: null, openFile: null, fileViewMode: "source", diffScope: "uncommitted" });
  const latestWsId = useRef<string | undefined>(wsId);

  // Resolve initial state: restore from cache if available, else default.
  const [activeTabId, setActiveTabId] = useState<TabId | null>(() => {
    const cached = wsId ? snapshotByWorkspace.get(wsId) : undefined;
    if (cached) return cached.activeTabId;
    return currentSessionId ? tabId({ type: "session", sessionId: currentSessionId }) : null;
  });
  const [openFile, setOpenFile] = useState<string | null>(() => {
    const cached = wsId ? snapshotByWorkspace.get(wsId) : undefined;
    return cached?.openFile ?? null;
  });
  const [fileViewMode, setFileViewMode] = useState<FileViewMode>(() => {
    const cached = wsId ? snapshotByWorkspace.get(wsId) : undefined;
    return cached?.fileViewMode ?? "source";
  });
  const [diffScope, setDiffScope] = useState<DiffScope>(() => {
    const cached = wsId ? snapshotByWorkspace.get(wsId) : undefined;
    return cached?.diffScope ?? "uncommitted";
  });

  // On workspace switch: save outgoing state, restore incoming state.
  useEffect(() => {
    if (prevWsId.current === wsId) return;

    // Save outgoing workspace state.
    if (prevWsId.current) {
      snapshotByWorkspace.set(prevWsId.current, { activeTabId, openFile, fileViewMode, diffScope });
    }
    prevWsId.current = wsId;

    // Restore incoming workspace state (or reset).
    const cached = wsId ? snapshotByWorkspace.get(wsId) : undefined;
    if (cached) {
      setActiveTabId(cached.activeTabId);
      setOpenFile(cached.openFile);
      setFileViewMode(cached.fileViewMode);
      setDiffScope(cached.diffScope ?? "uncommitted");
    } else {
      setActiveTabId(null);
      setOpenFile(null);
      setFileViewMode("source");
      setDiffScope("uncommitted");
    }
  }, [wsId]); // eslint-disable-line react-hooks/exhaustive-deps

  // When currentSessionId changes and the active tab is a session tab (or null), track it.
  // If the user is on a file tab, don't disturb them.
  useEffect(() => {
    if (!currentSessionId) return;
    setActiveTabId((prev) => {
      if (!prev || prev.startsWith("session:")) {
        return tabId({ type: "session", sessionId: currentSessionId });
      }
      return prev;
    });
  }, [currentSessionId]);

  const activateTab = useCallback((id: TabId) => {
    setActiveTabId(id);
  }, []);

  const openFileTab = useCallback((path: string) => {
    setOpenFile(path);
    setFileViewMode("source");
    setActiveTabId(tabId({ type: "file", path }));
  }, []);

  const openDiffTab = useCallback((path: string, scope: DiffScope = "uncommitted") => {
    setOpenFile(path);
    setFileViewMode("diff");
    setDiffScope(scope);
    setActiveTabId(tabId({ type: "file", path }));
  }, []);

  const closeFileTab = useCallback(() => {
    setOpenFile(null);
    setFileViewMode("source");
    setDiffScope("uncommitted");
    setActiveTabId(currentSessionId ? tabId({ type: "session", sessionId: currentSessionId }) : null);
  }, [currentSessionId]);

  useEffect(() => {
    latestSnapshot.current = { activeTabId, openFile, fileViewMode, diffScope };
    latestWsId.current = wsId;
  }, [activeTabId, openFile, fileViewMode, diffScope, wsId]);

  // Preserve current workspace tab state across unmount/remount cycles.
  useEffect(() => {
    return () => {
      if (!latestWsId.current) return;
      snapshotByWorkspace.set(latestWsId.current, latestSnapshot.current);
    };
  }, []);

  const isFileTabActive = activeTabId ? parseTabId(activeTabId).type === "file" : false;

  return {
    activeTabId,
    openFile,
    fileViewMode,
    diffScope,
    isFileTabActive,
    activateTab,
    openFileTab,
    openDiffTab,
    setFileViewMode,
    setDiffScope,
    closeFileTab,
  };
}
