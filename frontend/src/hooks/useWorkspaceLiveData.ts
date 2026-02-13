import { useEffect, useState } from "react";
import { wsTransport } from "@/lib/ws-transport";
import type { BranchInfo } from "@/types";

export interface WorkspaceLiveData {
  status?: "idle" | "busy";
  streaming?: boolean;
  branch?: string;
  branchInfo?: BranchInfo;
}

export function useWorkspaceLiveData(
  workspaceIds: string[],
): Record<string, WorkspaceLiveData> {
  const [liveData, setLiveData] = useState<Record<string, WorkspaceLiveData>>(
    {},
  );

  useEffect(() => {
    const unsubscribers = workspaceIds.map((wsId) =>
      wsTransport.onMessage(wsId, (msg) => {
        if (msg.type === "status") {
          setLiveData((prev) => {
            const next = {
              status: msg.status,
              streaming: msg.streaming ?? false,
            };
            const current = prev[wsId];
            if (
              current?.status === next.status &&
              current.streaming === next.streaming
            ) {
              return prev;
            }
            return { ...prev, [wsId]: { ...prev[wsId], ...next } };
          });
        } else if (msg.type === "branch_info") {
          setLiveData((prev) => {
            const current = prev[wsId];
            if (current?.branch === msg.info.name) return prev;
            return {
              ...prev,
              [wsId]: {
                ...prev[wsId],
                branch: msg.info.name,
                branchInfo: msg.info,
              },
            };
          });
        }
      }),
    );

    return () => {
      for (const sub of unsubscribers) sub.unsubscribe();
    };
  }, [workspaceIds]);

  // Clean up stale entries when workspace IDs change
  useEffect(() => {
    const wsSet = new Set(workspaceIds);
    setLiveData((prev) => {
      const filtered = Object.fromEntries(
        Object.entries(prev).filter(([id]) => wsSet.has(id)),
      );
      if (Object.keys(filtered).length === Object.keys(prev).length)
        return prev;
      return filtered;
    });
  }, [workspaceIds]);

  return liveData;
}
