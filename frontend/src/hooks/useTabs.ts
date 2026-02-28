import { useState, useCallback, useEffect } from "react";
import type { TabId } from "../types";

export interface UseTabsReturn {
  activeTabId: TabId | null;
  openFile: string | null;
  isFileTabActive: boolean;
  activateTab: (id: TabId) => void;
  openFileTab: (path: string) => void;
  closeFileTab: () => void;
  resetForWorkspace: () => void;
}

export function useTabs(currentSessionId: string | undefined): UseTabsReturn {
  const [activeTabId, setActiveTabId] = useState<TabId | null>(
    currentSessionId ? `session:${currentSessionId}` : null,
  );
  const [openFile, setOpenFile] = useState<string | null>(null);

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

  const resetForWorkspace = useCallback(() => {
    setOpenFile(null);
    // Will be set by the currentSessionId sync effect on next render.
    setActiveTabId(null);
  }, []);

  const isFileTabActive = activeTabId?.startsWith("file:") ?? false;

  return {
    activeTabId,
    openFile,
    isFileTabActive,
    activateTab,
    openFileTab,
    closeFileTab,
    resetForWorkspace,
  };
}
