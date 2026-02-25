import { useMemo } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { api } from "./useApi";
import type { BulkPrStatusResponse, PrStatusResponse } from "@/types";

const sharedOptions = {
  refetchInterval: 15_000,
  staleTime: 10_000,
  gcTime: 5 * 60_000,
  placeholderData: keepPreviousData,
} as const;

export function usePrStatus(wsId: string | undefined) {
  const query = useQuery({
    queryKey: ["pr-status", wsId],
    queryFn: (): Promise<PrStatusResponse> =>
      api.get<PrStatusResponse>(`/api/workspaces/${wsId}/pr-status`),
    enabled: !!wsId,
    ...sharedOptions,
  });

  return {
    pr: query.data?.pr ?? null,
    error: query.data?.error ?? null,
    loading: query.isLoading,
  };
}

const emptyResults: Record<string, PrStatusResponse> = {};

export function useBulkPrStatus(wsIds: string[]) {
  const stableKey = useMemo(() => wsIds.slice().sort().join(","), [wsIds]);

  const query = useQuery({
    queryKey: ["pr-status-bulk", stableKey],
    queryFn: (): Promise<BulkPrStatusResponse> =>
      api.post<BulkPrStatusResponse>("/api/workspaces/pr-status/bulk", {
        workspaceIds: wsIds,
      }),
    enabled: wsIds.length > 0,
    ...sharedOptions,
  });

  return {
    results: query.data?.results ?? emptyResults,
    loading: query.isLoading,
  };
}
