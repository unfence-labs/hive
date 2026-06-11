import { useMemo } from "react";
import {
  useIsFetching,
  useQuery,
  useQueries,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import { api } from "./useApi";
import type { BulkPrStatusResponse, PrStatusResponse } from "@/types";

export const prStatusKey = (wsId: string) => ["pr-status", wsId] as const;

const PR_GC_TIME = 5 * 60_000;
const PR_REFETCH_INTERVAL = 60_000;
const PR_STALE_TIME = 45_000;

function readPrStatusFromCache(
  queryClient: ReturnType<typeof useQueryClient>,
  wsId: string,
): PrStatusResponse | undefined {
  return queryClient.getQueryData<PrStatusResponse>(prStatusKey(wsId));
}

export function usePrStatus(wsId: string | undefined) {
  const queryClient = useQueryClient();
  const bulkFetchingCount = useIsFetching({ queryKey: ["pr-status-bulk"] });

  const query = useQuery({
    queryKey: prStatusKey(wsId ?? ""),
    queryFn: async (): Promise<PrStatusResponse> =>
      readPrStatusFromCache(queryClient, wsId ?? "") ?? { pr: null },
    // Cache-only consumer: the sidebar bulk query is the single poller.
    enabled: false,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: PR_GC_TIME,
    placeholderData: keepPreviousData,
  });

  const hasData = query.data !== undefined;
  const loading = !!wsId && !hasData && bulkFetchingCount > 0;

  return {
    pr: query.data?.pr ?? null,
    error: query.data?.error ?? null,
    loading,
  };
}

const emptyResults: Record<string, PrStatusResponse> = {};

export function usePrStatusMap(wsIds: string[]) {
  const queryClient = useQueryClient();
  const queries = useQueries({
    queries: wsIds.map((wsId) => ({
      queryKey: prStatusKey(wsId),
      queryFn: async (): Promise<PrStatusResponse> =>
        readPrStatusFromCache(queryClient, wsId) ?? { pr: null },
      enabled: false,
      staleTime: Number.POSITIVE_INFINITY,
      gcTime: PR_GC_TIME,
      placeholderData: keepPreviousData,
    })),
  });

  return useMemo(() => {
    const results: Record<string, PrStatusResponse> = {};
    wsIds.forEach((wsId, index) => {
      const status = queries[index]?.data;
      if (status) results[wsId] = status;
    });
    return results;
  }, [queries, wsIds]);
}

export function useBulkPrStatus(wsIds: string[]) {
  const queryClient = useQueryClient();
  const stableKey = useMemo(() => wsIds.slice().sort().join(","), [wsIds]);

  const query = useQuery({
    queryKey: ["pr-status-bulk", stableKey],
    queryFn: async (): Promise<BulkPrStatusResponse> => {
      const data = await api.post<BulkPrStatusResponse>(
        "/api/workspaces/pr-status/bulk",
        { workspaceIds: wsIds },
      );

      // Seed per-workspace cache so usePrStatus consumers see the
      // same data instantly — no duplicate fetch, no UI desync.
      if (data.results) {
        for (const [id, status] of Object.entries(data.results)) {
          queryClient.setQueryData(prStatusKey(id), status);
        }
      }

      return data;
    },
    enabled: wsIds.length > 0,
    refetchInterval: PR_REFETCH_INTERVAL,
    staleTime: PR_STALE_TIME,
    gcTime: PR_GC_TIME,
    placeholderData: keepPreviousData,
  });

  const loadingByWorkspace = useMemo(() => {
    const loading: Record<string, boolean> = {};
    if (query.isFetching) {
      for (const wsId of wsIds) {
        if (!readPrStatusFromCache(queryClient, wsId)) loading[wsId] = true;
      }
    }
    return loading;
  }, [query.isFetching, queryClient, wsIds]);

  return {
    results: query.data?.results ?? emptyResults,
    loading: query.isLoading,
    loadingByWorkspace,
  };
}
