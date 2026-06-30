import { useQuery, type QueryClient } from "@tanstack/react-query";
import { api } from "@/hooks/useApi";
import type { ChatMessage } from "@/types";

/**
 * Finalized conversation history is owned by React Query (fetched over REST),
 * not pushed over the WebSocket. The WS carries live state only (status, stream
 * deltas/snapshot, done/cancelled). This keeps the WS bootstrap light and gives
 * instant switch-back from the query cache.
 */

const EMPTY_MESSAGES: ChatMessage[] = [];

export function sessionMessagesKey(
  workspaceId: string | undefined,
  sessionId: string | undefined,
): [string, string, string] {
  return ["session-messages", workspaceId ?? "", sessionId ?? ""];
}

function fetchSessionMessages(workspaceId: string, sessionId: string): Promise<ChatMessage[]> {
  return api.get<ChatMessage[]>(`/api/workspaces/${workspaceId}/sessions/${sessionId}/messages`);
}

/** Subscribe to a session's finalized messages. Returns `[]` until loaded. */
export function useSessionMessages(
  workspaceId: string | undefined,
  sessionId: string | undefined,
): { messages: ChatMessage[]; isLoading: boolean } {
  const query = useQuery({
    queryKey: sessionMessagesKey(workspaceId, sessionId),
    queryFn: () => fetchSessionMessages(workspaceId!, sessionId!),
    enabled: !!workspaceId && !!sessionId,
    // Cached data renders instantly on switch-back; a short staleness window
    // avoids refetch storms while done/cancelled invalidation forces refresh.
    staleTime: 5_000,
  });
  return { messages: query.data ?? EMPTY_MESSAGES, isLoading: query.isLoading };
}

/** Read the currently-cached messages for a session synchronously (no fetch). */
export function getCachedSessionMessages(
  queryClient: QueryClient,
  workspaceId: string | undefined,
  sessionId: string | undefined,
): ChatMessage[] | undefined {
  return queryClient.getQueryData<ChatMessage[]>(sessionMessagesKey(workspaceId, sessionId));
}

/** Optimistically append a finalized message to a session's cache (dedup by id). */
export function appendCachedSessionMessage(
  queryClient: QueryClient,
  workspaceId: string | undefined,
  sessionId: string | undefined,
  message: ChatMessage,
): void {
  if (!workspaceId || !sessionId) return;
  queryClient.setQueryData<ChatMessage[]>(sessionMessagesKey(workspaceId, sessionId), (prev) => {
    const list = prev ?? [];
    if (message.id && list.some((m) => m.id === message.id)) return list;
    return [...list, message];
  });
}

/** Mark a session's messages stale so the authoritative server copy is refetched. */
export function invalidateSessionMessages(
  queryClient: QueryClient,
  workspaceId: string | undefined,
  sessionId: string | undefined,
): void {
  if (!workspaceId || !sessionId) return;
  void queryClient.invalidateQueries({ queryKey: sessionMessagesKey(workspaceId, sessionId) });
}

/** Drop a session's cached messages entirely (e.g. after deletion). */
export function removeCachedSessionMessages(
  queryClient: QueryClient,
  workspaceId: string | undefined,
  sessionId?: string,
): void {
  queryClient.removeQueries({
    queryKey: sessionId
      ? sessionMessagesKey(workspaceId, sessionId)
      : ["session-messages", workspaceId ?? ""],
  });
}
