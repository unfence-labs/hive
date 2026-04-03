import { useQuery } from "@tanstack/react-query";
import { api } from "./useApi";
import type { ChatMessage } from "@/types";

/**
 * Fetch messages for a specific session via REST.
 * Used for read-only mosaic tiles pinned to non-active sessions.
 */
export function useSessionMessages(wsId: string, sessionId: string | null) {
  const query = useQuery({
    queryKey: ["session-messages", wsId, sessionId],
    queryFn: () =>
      api.get<ChatMessage[]>(
        `/api/workspaces/${wsId}/sessions/${sessionId}/messages`,
      ),
    enabled: !!sessionId,
    refetchInterval: 15_000, // refresh periodically for updates
  });

  return {
    messages: query.data ?? [],
    isLoading: query.isLoading,
  };
}
