import { useState, useEffect, useCallback } from "react";
import { api } from "@/hooks/useApi";
import type { SessionMetadata } from "@/types";

export function useSessions(workspaceId: string | undefined) {
  const [sessions, setSessions] = useState<SessionMetadata[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchSessions = useCallback(async () => {
    if (!workspaceId) {
      setSessions([]);
      return;
    }
    setLoading(true);
    try {
      const result = await api.get<SessionMetadata[]>(
        `/api/workspaces/${workspaceId}/sessions`,
      );
      setSessions(result);
    } catch {
      setSessions([]);
    } finally {
      setLoading(false);
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

  return {
    sessions,
    loading,
    createSession,
    activateSession,
    deleteSession,
    refresh: fetchSessions,
  };
}
