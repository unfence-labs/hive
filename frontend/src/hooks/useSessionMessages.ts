import { useCallback, useRef } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api } from "@/hooks/useApi";
import {
  getSendState,
  resolveEchoedSend,
  resolveOptimisticSend,
} from "@/lib/optimistic-sends";
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

function historyErrorMessage(error: unknown): string | undefined {
  if (!error) return undefined;
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Failed to load conversation history.";
}

function mergeFetchedMessagesWithCachedUserEchoes(
  fetched: ChatMessage[],
  cached: ChatMessage[] | undefined,
  sessionId: string,
): ChatMessage[] {
  if (!cached?.length) return fetched;

  const fetchedIds = new Set(fetched.map((message) => message.id));
  const cachedIds = new Set(cached.map((message) => message.id));
  const newServerUserMessages = fetched.filter(
    (message) => message.role === "user" && !cachedIds.has(message.id),
  );
  const confirmedByClientId = new Set(
    newServerUserMessages
      .map((message) => message.clientMessageId)
      .filter((id): id is string => !!id),
  );

  const missingUserMessages: ChatMessage[] = [];
  for (const message of cached) {
    if (
      message.role !== "user" ||
      message.sessionId !== sessionId ||
      !message.id ||
      fetchedIds.has(message.id)
    ) {
      continue;
    }
    if (getSendState(message.id) !== undefined && confirmedByClientId.has(message.id)) {
      resolveOptimisticSend(message.id);
      continue;
    }
    missingUserMessages.push(message);
  }

  return missingUserMessages.length > 0 ? [...fetched, ...missingUserMessages] : fetched;
}

/**
 * Fetch a session's finalized messages and merge back any cached user echoes
 * that the fetch didn't yet include. Re-reads the cache at fetch end so an
 * in-flight WS user echo isn't dropped by a concurrent fetch/prefetch. Shared
 * by both the live hook and the prefetch helper to keep behavior identical.
 */
export function fetchAndMergeSessionMessages(
  queryClient: QueryClient,
  workspaceId: string,
  sessionId: string,
): Promise<ChatMessage[]> {
  const key = sessionMessagesKey(workspaceId, sessionId);
  const cacheAtStart = queryClient.getQueryData<ChatMessage[]>(key);
  return fetchSessionMessages(workspaceId, sessionId).then((fetched) => {
    const cacheAtEnd = queryClient.getQueryData<ChatMessage[]>(key);
    return mergeFetchedMessagesWithCachedUserEchoes(fetched, cacheAtEnd ?? cacheAtStart, sessionId);
  });
}

/** Subscribe to a session's finalized messages. Returns `[]` until loaded. */
export function useSessionMessages(
  workspaceId: string | undefined,
  sessionId: string | undefined,
): {
  messages: ChatMessage[];
  isLoading: boolean;
  isFetching: boolean;
  hasData: boolean;
  error: string | undefined;
  errorUpdatedAt: number;
  retry: () => void;
} {
  const queryClient = useQueryClient();
  const key = sessionMessagesKey(workspaceId, sessionId);
  const query = useQuery({
    queryKey: key,
    queryFn: () => fetchAndMergeSessionMessages(queryClient, workspaceId!, sessionId!),
    enabled: !!workspaceId && !!sessionId,
    // Freshness is driven by WS done/cancelled invalidation (see
    // useWsCacheInvalidation), not time-based expiry — matching the app-wide
    // policy in query-client.ts. So inherit the global staleTime default instead
    // of forcing a full-transcript refetch on every workspace switch-back.
  });
  // A manual refetch clears Query's error while it is in flight when no data
  // exists. Retain that last error so the recoverable empty state can show
  // "Retrying…" instead of briefly turning blank.
  const retainedErrorRef = useRef<{
    workspaceId: string | undefined;
    sessionId: string | undefined;
    message: string;
  } | undefined>(undefined);
  const queryError = historyErrorMessage(query.error);
  if (query.data !== undefined) {
    retainedErrorRef.current = undefined;
  } else if (queryError) {
    retainedErrorRef.current = { workspaceId, sessionId, message: queryError };
  } else if (
    retainedErrorRef.current &&
    (retainedErrorRef.current.workspaceId !== workspaceId ||
      retainedErrorRef.current.sessionId !== sessionId)
  ) {
    retainedErrorRef.current = undefined;
  }
  const retainedErrorEntry = retainedErrorRef.current;
  const retainedError = retainedErrorEntry && retainedErrorEntry.workspaceId === workspaceId &&
    retainedErrorEntry.sessionId === sessionId
    ? retainedErrorEntry.message
    : undefined;
  const { refetch } = query;
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);

  return {
    messages: query.data ?? EMPTY_MESSAGES,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    hasData: query.data !== undefined,
    error: queryError ?? retainedError,
    errorUpdatedAt: query.errorUpdatedAt,
    retry,
  };
}

/**
 * Pre-warm the REST history cache for a session so a later switch finds warm
 * data (React Query `isLoading` stays false → no empty-state flash). Pure
 * additive optimization: `prefetchQuery` dedupes by key against in-flight
 * fetches and no-ops while data is still fresh within the global staleTime, so
 * it's safe to call alongside the active session's own fetch.
 */
export function prefetchSessionMessages(
  queryClient: QueryClient,
  workspaceId: string | undefined,
  sessionId: string | undefined,
): void {
  if (!workspaceId || !sessionId) return;
  // Inherits the global staleTime (see useSessionMessages), so it no-ops while
  // the cached transcript is still fresh.
  void queryClient.prefetchQuery({
    queryKey: sessionMessagesKey(workspaceId, sessionId),
    queryFn: () => fetchAndMergeSessionMessages(queryClient, workspaceId, sessionId),
  });
}

/** Read the currently-cached messages for a session synchronously (no fetch). */
export function getCachedSessionMessages(
  queryClient: QueryClient,
  workspaceId: string | undefined,
  sessionId: string | undefined,
): ChatMessage[] | undefined {
  return queryClient.getQueryData<ChatMessage[]>(sessionMessagesKey(workspaceId, sessionId));
}

/** Append a WS-echoed user message or finalized assistant UI copy to the cache. */
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

/**
 * Swap an optimistic local user message for its server echo, in place. Returns
 * true when a swap happened — the caller must then skip its own append.
 */
export function resolveCachedOptimisticEcho(
  queryClient: QueryClient,
  workspaceId: string | undefined,
  sessionId: string | undefined,
  serverMessage: ChatMessage,
): boolean {
  if (!workspaceId || !sessionId || serverMessage.role !== "user") return false;
  const localId = resolveEchoedSend(sessionId, serverMessage);
  if (!localId) return false;
  resolveOptimisticSend(localId);
  let swapped = false;
  queryClient.setQueryData<ChatMessage[]>(sessionMessagesKey(workspaceId, sessionId), (prev) => {
    const list = prev ?? [];
    const idx = list.findIndex((message) => message.id === localId);
    if (idx < 0) return list;
    swapped = true;
    return [...list.slice(0, idx), serverMessage, ...list.slice(idx + 1)];
  });
  return swapped;
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
