import { useEffect, useMemo, useSyncExternalStore } from "react";
import {
  useQuery,
  useQueries,
  useQueryClient,
} from "@tanstack/react-query";
import { wsTransport } from "@/lib/ws-transport";
import type { PrStatusResponse } from "@/types";

export const prStatusKey = (wsId: string) => ["pr-status", wsId] as const;

const PR_GC_TIME = 5 * 60_000;
const prInterestListeners = new Set<() => void>();
let prWorkspaceIds = new Set<string>();

function notifyPrInterestListeners(): void {
  for (const listener of prInterestListeners) listener();
}

function subscribePrInterest(listener: () => void): () => void {
  prInterestListeners.add(listener);
  return () => { prInterestListeners.delete(listener); };
}

function isPrWorkspaceInterested(wsId: string | undefined): boolean {
  return !!wsId && prWorkspaceIds.has(wsId);
}

function readPrStatusFromCache(
  queryClient: ReturnType<typeof useQueryClient>,
  wsId: string,
): PrStatusResponse | undefined {
  return queryClient.getQueryData<PrStatusResponse>(prStatusKey(wsId));
}

export function usePrStatus(wsId: string | undefined) {
  const queryClient = useQueryClient();
  const interested = useSyncExternalStore(
    subscribePrInterest,
    () => isPrWorkspaceInterested(wsId),
    () => false,
  );

  const query = useQuery({
    queryKey: prStatusKey(wsId ?? ""),
    queryFn: async (): Promise<PrStatusResponse> =>
      readPrStatusFromCache(queryClient, wsId ?? "") ?? { pr: null },
    enabled: false,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: PR_GC_TIME,
  });

  const hasData = query.data !== undefined;
  const loading = !!wsId && interested && !hasData;

  return {
    pr: query.data?.pr ?? null,
    error: query.data?.error ?? null,
    loading,
  };
}

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

export function useSyncPrWorkspaces(wsIds: string[]): void {
  const stableKey = useMemo(() => wsIds.slice().sort().join(","), [wsIds]);

  useEffect(() => {
    const next = new Set(wsIds);
    const changed = next.size !== prWorkspaceIds.size || [...next].some((wsId) => !prWorkspaceIds.has(wsId));
    prWorkspaceIds = next;
    // Rehydrate transport state on every mount: disconnectAll clears it while
    // this module-level interest set survives remounts.
    wsTransport.syncPrWorkspaces([...next]);
    if (changed) notifyPrInterestListeners();
  }, [stableKey, wsIds]);
}
