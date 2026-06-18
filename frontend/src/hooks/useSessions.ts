import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/hooks/useApi";
import type { SessionMetadata } from "@/types";

/** Sort sessions by creation time (oldest first) for stable tab ordering. */
function sortByCreatedAtAsc(sessions: SessionMetadata[]): SessionMetadata[] {
  return [...sessions].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
}

export function useSessions(workspaceId: string | undefined) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["sessions", workspaceId],
    queryFn: () =>
      api.get<SessionMetadata[]>(
        `/api/workspaces/${workspaceId}/sessions`,
      ),
    enabled: !!workspaceId,
  });

  const sorted = useMemo(
    () => sortByCreatedAtAsc(query.data ?? []),
    [query.data],
  );

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["sessions", workspaceId] });

  const createSession = useMutation({
    mutationFn: (kind?: "terminal") =>
      api.post<SessionMetadata>(
        `/api/workspaces/${workspaceId}/sessions`,
        kind ? { kind } : undefined,
      ),
    onSuccess: invalidate,
  });

  const convertToTerminal = useMutation({
    mutationFn: (sessionId: string) =>
      api.post<SessionMetadata>(
        `/api/workspaces/${workspaceId}/sessions/${sessionId}/convert-to-terminal`,
      ),
    onSuccess: invalidate,
  });

  const deleteSession = useMutation({
    mutationFn: (sessionId: string) =>
      api.delete(`/api/workspaces/${workspaceId}/sessions/${sessionId}`),
    onSuccess: invalidate,
  });

  return {
    sessions: sorted,
    loading: query.isLoading,
    createSession: async (kind?: "terminal"): Promise<SessionMetadata | null> => {
      if (!workspaceId) return null;
      try {
        return await createSession.mutateAsync(kind);
      } catch {
        return null;
      }
    },
    convertToTerminal: async (sessionId: string): Promise<SessionMetadata | null> => {
      if (!workspaceId) return null;
      try {
        return await convertToTerminal.mutateAsync(sessionId);
      } catch {
        return null;
      }
    },
    deleteSession: async (sessionId: string): Promise<boolean> => {
      if (!workspaceId) return false;
      try {
        await deleteSession.mutateAsync(sessionId);
        return true;
      } catch {
        return false;
      }
    },
    refresh: invalidate,
  };
}
