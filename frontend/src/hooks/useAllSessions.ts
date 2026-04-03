import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { api } from "@/hooks/useApi";
import type { SessionMetadata, Workspace } from "@/types";

export interface SessionTile {
  session: SessionMetadata;
  wsId: string;
  isActive: boolean;
  tileId: string; // `${wsId}:${session.sessionId}`
}

/**
 * Fetch sessions for ALL workspaces in parallel and return a flat,
 * deduplicated list of SessionTile descriptors.
 */
export function useAllSessions(workspaces: Workspace[]): {
  sessions: SessionTile[];
  isLoading: boolean;
} {
  const queries = useQueries({
    queries: workspaces.map((ws) => ({
      queryKey: ["sessions", ws.id],
      queryFn: () =>
        api.get<SessionMetadata[]>(`/api/workspaces/${ws.id}/sessions`),
      staleTime: 30_000,
    })),
  });

  const isLoading = queries.some((q) => q.isLoading);

  const sessions = useMemo(() => {
    const seen = new Set<string>();
    const result: SessionTile[] = [];

    for (let i = 0; i < workspaces.length; i++) {
      const ws = workspaces[i];
      const data = queries[i]?.data;
      if (!data) continue;

      // Sort sessions by creation time (oldest first) for stable ordering
      const sorted = [...data].sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );

      for (const session of sorted) {
        const tileId = `${ws.id}:${session.sessionId}`;
        if (seen.has(tileId)) continue;
        seen.add(tileId);
        result.push({
          session,
          wsId: ws.id,
          isActive: session.sessionId === ws.activeSessionId,
          tileId,
        });
      }
    }

    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- queries.data drives recalculation
  }, [workspaces, ...queries.map((q) => q.data)]);

  return { sessions, isLoading };
}
