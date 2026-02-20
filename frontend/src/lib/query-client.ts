import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // WS invalidation is the freshness mechanism, not time-based expiry.
      staleTime: 5 * 60 * 1000,
      // Desktop app — user tabs away constantly; refetch storms on focus would
      // spam the remote VPS and cause visible flicker.
      refetchOnWindowFocus: false,
      // WS transport handles reconnects and replays cached data.
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
