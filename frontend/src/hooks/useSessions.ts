import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { api } from "@/hooks/useApi";
import type { SessionMetadata } from "@/types";

/** Sort sessions by creation time (oldest first) for stable tab ordering. */
function sortByCreatedAtAsc(sessions: SessionMetadata[]): SessionMetadata[] {
  return [...sessions].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
}

export function useSessions(workspaceId: string | undefined) {
  const [sessions, setSessions] = useState<SessionMetadata[]>([]);
  const [loading, setLoading] = useState(false);
  const requestTokenRef = useRef(0);

  const fetchSessions = useCallback(async () => {
    const requestToken = requestTokenRef.current + 1;
    requestTokenRef.current = requestToken;

    if (!workspaceId) {
      setSessions([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const result = await api.get<SessionMetadata[]>(
        `/api/workspaces/${workspaceId}/sessions`,
      );
      if (requestTokenRef.current === requestToken) {
        setSessions(result);
      }
    } catch {
      if (requestTokenRef.current === requestToken) {
        setSessions([]);
      }
    } finally {
      if (requestTokenRef.current === requestToken) {
        setLoading(false);
      }
    }
  }, [workspaceId]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const createSession = useCallback(async (): Promise<SessionMetadata | null> => {
    if (!workspaceId) return null;
    try {
      const meta = await api.post<SessionMetadata>(
        `/api/workspaces/${workspaceId}/sessions`,
      );
      await fetchSessions();
      return meta;
    } catch {
      return null;
    }
  }, [workspaceId, fetchSessions]);

  const activateSession = useCallback(async (sessionId: string): Promise<SessionMetadata | null> => {
    if (!workspaceId) return null;
    try {
      const meta = await api.post<SessionMetadata>(
        `/api/workspaces/${workspaceId}/sessions/${sessionId}/activate`,
      );
      await fetchSessions();
      return meta;
    } catch {
      return null;
    }
  }, [workspaceId, fetchSessions]);

  const deleteSession = useCallback(async (sessionId: string): Promise<boolean> => {
    if (!workspaceId) return false;
    try {
      await api.delete(`/api/workspaces/${workspaceId}/sessions/${sessionId}`);
      await fetchSessions();
      return true;
    } catch {
      return false;
    }
  }, [workspaceId, fetchSessions]);

  const stableSessions = useMemo(() => sortByCreatedAtAsc(sessions), [sessions]);

  return {
    sessions: stableSessions,
    loading,
    createSession,
    activateSession,
    deleteSession,
    refresh: fetchSessions,
  };
}
