import { useEffect, useState } from "react";
import { wsTransport } from "@/lib/ws-transport";
import type { BranchInfo, DiffStatResponse } from "@/types";

export interface WorkspaceLiveData {
  status?: "idle" | "busy";
  streaming?: boolean;
  streamingSessions?: Record<string, boolean>;
  branch?: string;
  branchInfo?: BranchInfo;
  diffStats?: DiffStatResponse;
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
            const current = prev[wsId] ?? {};
            const prevSessions = { ...(current.streamingSessions ?? {}) };
            const currentSessions = current.streamingSessions ?? {};

            if (msg.sessionId) {
              if (msg.streaming) {
                prevSessions[msg.sessionId] = true;
              } else {
                delete prevSessions[msg.sessionId];
              }
            } else if (msg.status === "idle") {
              // No sessionId + idle = workspace-level idle, clear all
              for (const key of Object.keys(prevSessions)) {
                delete prevSessions[key];
              }
            }

            // Aggregate streaming: per-session map takes precedence, but
            // fall back to the raw message field for legacy/sessionless status.
            const anySessionStreaming = Object.keys(prevSessions).length > 0;
            const streaming = anySessionStreaming || (!msg.sessionId && (msg.streaming ?? false));
            const next = {
              status: msg.status,
              streaming,
              streamingSessions: prevSessions,
            };

            const currentKeys = Object.keys(currentSessions);
            const nextKeys = Object.keys(prevSessions);
            const sessionsUnchanged =
              currentKeys.length === nextKeys.length &&
              nextKeys.every((key) => currentSessions[key] === prevSessions[key]);

            if (
              current.status === next.status &&
              current.streaming === next.streaming &&
              sessionsUnchanged
            ) {
              return prev;
            }
            return { ...prev, [wsId]: { ...current, ...next } };
          });
        } else if (msg.type === "branch_info") {
          setLiveData((prev) => {
            const current = prev[wsId];
            if (
              current?.branch === msg.info.name &&
              current?.branchInfo?.prSyncError === msg.info.prSyncError &&
              current?.branchInfo?.pr?.number === msg.info.pr?.number &&
              current?.branchInfo?.pr?.state === msg.info.pr?.state &&
              current?.branchInfo?.pr?.mergeable === msg.info.pr?.mergeable &&
              current?.branchInfo?.pr?.mergeableState === msg.info.pr?.mergeableState &&
              current?.branchInfo?.pr?.checksStatus === msg.info.pr?.checksStatus
            ) {
              return prev;
            }
            return {
              ...prev,
              [wsId]: {
                ...prev[wsId],
                branch: msg.info.name,
                branchInfo: msg.info,
              },
            };
          });
        } else if (msg.type === "diff_stats") {
          setLiveData((prev) => ({
            ...prev,
            [wsId]: {
              ...prev[wsId],
              diffStats: msg.stats,
            },
          }));
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
