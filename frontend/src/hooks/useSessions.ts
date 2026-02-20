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
    mutationFn: () =>
      api.post<SessionMetadata>(
        `/api/workspaces/${workspaceId}/sessions`,
      ),
    onSuccess: invalidate,
  });

  const activateSession = useMutation({
    mutationFn: (sessionId: string) =>
      api.post<SessionMetadata>(
        `/api/workspaces/${workspaceId}/sessions/${sessionId}/activate`,
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
    createSession: async (): Promise<SessionMetadata | null> => {
      try {
        return await createSession.mutateAsync();
      } catch {
        return null;
      }
    },
    activateSession: async (sessionId: string): Promise<SessionMetadata | null> => {
      try {
        return await activateSession.mutateAsync(sessionId);
      } catch {
        return null;
      }
    },
    deleteSession: async (sessionId: string): Promise<boolean> => {
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
