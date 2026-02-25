import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  useWorkspaceLiveData,
  type ClearUnreadFn,
  type WorkspaceLiveData,
} from "@/hooks/useWorkspaceLiveData";

type LiveDataMap = Record<string, WorkspaceLiveData>;

interface LiveDataContextValue {
  liveData: LiveDataMap;
  clearUnread: ClearUnreadFn;
}

const noop: ClearUnreadFn = () => {};

const WorkspaceLiveDataContext = createContext<LiveDataContextValue>({
  liveData: {},
  clearUnread: noop,
});

interface Props {
  workspaceIds: string[];
  children: ReactNode;
}

export function WorkspaceLiveDataProvider({ workspaceIds, children }: Props) {
  const { liveData, clearUnread } = useWorkspaceLiveData(workspaceIds);
  const value = useMemo(() => ({ liveData, clearUnread }), [liveData, clearUnread]);
  return (
    <WorkspaceLiveDataContext.Provider value={value}>
      {children}
    </WorkspaceLiveDataContext.Provider>
  );
}

/** Full live data map keyed by workspace ID. */
export function useWorkspaceLiveDataContext(): LiveDataMap {
  return useContext(WorkspaceLiveDataContext).liveData;
}

/** Clear unread state for a workspace (and optionally a specific session). */
export function useClearUnread(): ClearUnreadFn {
  return useContext(WorkspaceLiveDataContext).clearUnread;
}

/** Convenience hook for a single workspace's live data. */
export function useWorkspaceLive(
  wsId: string | undefined,
): WorkspaceLiveData {
  const { liveData } = useContext(WorkspaceLiveDataContext);
  return (wsId ? liveData[wsId] : undefined) ?? {};
}
