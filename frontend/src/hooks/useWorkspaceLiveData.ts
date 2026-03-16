import { useCallback, useEffect, useState } from "react";
import { wsTransport } from "@/lib/ws-transport";
import type { BranchInfo, DiffStatResponse, ScriptState } from "@/types";

export interface WorkspaceLiveData {
  status?: "idle" | "busy";
  streaming?: boolean;
  streamingSessions?: Record<string, boolean>;
  branch?: string;
  branchInfo?: BranchInfo;
  diffStats?: DiffStatResponse;
  scriptRunning?: boolean;
  scriptStates?: Record<string, ScriptState>;
  unreadSessions?: Record<string, boolean>;
}

export type ClearUnreadFn = (wsId: string, sessionId?: string) => void;

export function useWorkspaceLiveData(
  workspaceIds: string[],
): { liveData: Record<string, WorkspaceLiveData>; clearUnread: ClearUnreadFn } {
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
            if (prev[wsId]?.branch === msg.info.name) return prev;
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
        } else if ((msg.type === "done" || msg.type === "cancelled") && msg.sessionId) {
          setLiveData((prev) => {
            const current = prev[wsId] ?? {};
            const prevUnread = current.unreadSessions ?? {};
            const wasStreaming = !!(current.streamingSessions ?? {})[msg.sessionId!];
            const alreadyUnread = !!prevUnread[msg.sessionId!];
            if (!wasStreaming && alreadyUnread) return prev;
            const nextSessions = wasStreaming
              ? { ...(current.streamingSessions ?? {}) }
              : (current.streamingSessions ?? {});
            if (wasStreaming) delete nextSessions[msg.sessionId!];
            const anySessionStreaming = Object.keys(nextSessions).length > 0;
            return {
              ...prev,
              [wsId]: {
                ...current,
                streaming: anySessionStreaming,
                streamingSessions: nextSessions,
                unreadSessions: { ...prevUnread, [msg.sessionId!]: true },
              },
            };
          });
        } else if (msg.type === "script_status") {
          setLiveData((prev) => {
            const current = prev[wsId] ?? {};
            const prevScripts = { ...current.scriptStates };
            prevScripts[msg.scriptType] = msg.state;
            const scriptRunning = Object.values(prevScripts).some((s) => s === "running");
            if (current.scriptRunning === scriptRunning && current.scriptStates?.[msg.scriptType] === msg.state) {
              return prev;
            }
            return { ...prev, [wsId]: { ...current, scriptRunning, scriptStates: prevScripts } };
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

  const clearUnread = useCallback<ClearUnreadFn>((wsId, sessionId) => {
    setLiveData((prev) => {
      const current = prev[wsId];
      if (!current?.unreadSessions) return prev;
      if (sessionId) {
        if (!current.unreadSessions[sessionId]) return prev;
        const { [sessionId]: _, ...rest } = current.unreadSessions;
        return {
          ...prev,
          [wsId]: { ...current, unreadSessions: Object.keys(rest).length > 0 ? rest : undefined },
        };
      }
      return { ...prev, [wsId]: { ...current, unreadSessions: undefined } };
    });
  }, []);

  return { liveData, clearUnread };
}
