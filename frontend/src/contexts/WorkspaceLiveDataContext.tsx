import { createContext, useContext, type ReactNode } from "react";
import {
  useWorkspaceLiveData,
  type WorkspaceLiveData,
} from "@/hooks/useWorkspaceLiveData";

type LiveDataMap = Record<string, WorkspaceLiveData>;

const WorkspaceLiveDataContext = createContext<LiveDataMap>({});

interface Props {
  workspaceIds: string[];
  children: ReactNode;
}

export function WorkspaceLiveDataProvider({ workspaceIds, children }: Props) {
  const liveData = useWorkspaceLiveData(workspaceIds);
  return (
    <WorkspaceLiveDataContext.Provider value={liveData}>
      {children}
    </WorkspaceLiveDataContext.Provider>
  );
}

/** Full live data map keyed by workspace ID. */
export function useWorkspaceLiveDataContext(): LiveDataMap {
  return useContext(WorkspaceLiveDataContext);
}

/** Convenience hook for a single workspace's live data. */
export function useWorkspaceLive(
  wsId: string | undefined,
): WorkspaceLiveData {
  const map = useContext(WorkspaceLiveDataContext);
  return (wsId ? map[wsId] : undefined) ?? {};
}
