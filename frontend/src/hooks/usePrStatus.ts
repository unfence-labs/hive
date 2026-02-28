import { useMemo } from "react";
import {
  useQuery,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import { api } from "./useApi";
import type { BulkPrStatusResponse, PrStatusResponse } from "@/types";

export const prStatusKey = (wsId: string) => ["pr-status", wsId] as const;

export function usePrStatus(wsId: string | undefined) {
  const query = useQuery({
    queryKey: prStatusKey(wsId ?? ""),
    queryFn: (): Promise<PrStatusResponse> =>
      api.get<PrStatusResponse>(`/api/workspaces/${wsId}/pr-status`),
    enabled: !!wsId,
    staleTime: 10_000,
    gcTime: 5 * 60_000,
    placeholderData: keepPreviousData,
    // No refetchInterval — data is seeded by useBulkPrStatus (Sidebar)
    // via queryClient.setQueryData, ensuring all consumers update together.
  });

  return {
    pr: query.data?.pr ?? null,
    error: query.data?.error ?? null,
    loading: query.isLoading,
  };
}

const emptyResults: Record<string, PrStatusResponse> = {};

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
    refetchInterval: 15_000,
    staleTime: 10_000,
    gcTime: 5 * 60_000,
    placeholderData: keepPreviousData,
  });

  return {
    results: query.data?.results ?? emptyResults,
    loading: query.isLoading,
  };
}
