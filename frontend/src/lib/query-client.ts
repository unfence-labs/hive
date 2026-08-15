import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // WS invalidation is the freshness mechanism, not time-based expiry.
      staleTime: 5 * 60 * 1000,
      // Short focus changes must stay quiet. Meaningful foreground recovery is
      // coordinated explicitly so the whole app refreshes as one operation.
      refetchOnWindowFocus: false,
      // The same coordinator owns network recovery instead of per-query refetches.
      refetchOnReconnect: false,
      // Remote VPS — transient failures happen. Retry twice with backoff.
      retry: 2,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10_000),
    },
    mutations: {
      // Mutations are user-initiated; retrying a POST blindly risks duplicates.
      retry: 0,
    },
  },
});
