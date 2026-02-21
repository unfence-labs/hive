import { useQuery } from "@tanstack/react-query";
import { api } from "./useApi";
import type { PrStatusResponse } from "@/types";

export function usePrStatus(wsId: string | undefined) {
  const query = useQuery({
    queryKey: ["pr-status", wsId],
    queryFn: (): Promise<PrStatusResponse> =>
      api.get<PrStatusResponse>(`/api/workspaces/${wsId}/pr-status`),
    enabled: !!wsId,
    refetchInterval: 30_000,
    staleTime: 25_000,
    gcTime: 5 * 60_000,
  });

  return {
    pr: query.data?.pr ?? null,
    error: query.data?.error ?? null,
    loading: query.isLoading,
  };
}
