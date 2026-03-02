import { useQuery } from "@tanstack/react-query";
import { getServerUrl } from "./useServerUrl";

export interface SystemMetrics {
  cpuPercent: number;
  memPercent: number;
  diskPercent: number;
}

async function fetchMetrics(): Promise<SystemMetrics | null> {
  const base = getServerUrl();
  if (!base) return null;
  try {
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const data = await res.json();
    return data.system ?? null;
  } catch {
    return null;
  }
}

export function useServerMetrics() {
  const query = useQuery({
    queryKey: ["server-metrics"],
    queryFn: fetchMetrics,
    refetchInterval: 15_000,
    staleTime: 10_000,
    retry: 0,
  });

  return query.data ?? null;
}
