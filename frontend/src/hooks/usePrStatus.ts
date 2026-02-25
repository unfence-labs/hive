import { useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "./useApi";
import type { BulkPrStatusResponse, PrStatusResponse } from "@/types";

export function usePrStatus(wsId: string | undefined) {
  const query = useQuery({
    queryKey: ["pr-status", wsId],
    queryFn: (): Promise<PrStatusResponse> =>
      api.get<PrStatusResponse>(`/api/workspaces/${wsId}/pr-status`),
    enabled: !!wsId,
    refetchInterval: 15_000,
    staleTime: 10_000,
    gcTime: 5 * 60_000,
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
  const lastResults = useRef<Record<string, PrStatusResponse>>(emptyResults);
  const hasFetched = useRef(false);

  const query = useQuery({
    queryKey: ["pr-status-bulk", stableKey],
    queryFn: (): Promise<BulkPrStatusResponse> =>
      api.post<BulkPrStatusResponse>("/api/workspaces/pr-status/bulk", {
        workspaceIds: wsIds,
      }),
    enabled: wsIds.length > 0,
    refetchInterval: 15_000,
    staleTime: 10_000,
    gcTime: 5 * 60_000,
  });

  if (query.data?.results) {
    lastResults.current = query.data.results;
    hasFetched.current = true;
  } else if (query.isSuccess) {
    hasFetched.current = true;
  }

  return {
    results: lastResults.current,
    fetched: hasFetched.current,
  };
}
