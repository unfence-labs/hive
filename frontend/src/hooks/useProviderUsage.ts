import { useQuery } from "@tanstack/react-query";
import { api } from "@/hooks/useApi";

export interface ProviderUsageBucket {
  id: string;
  label: string | null;
  usedPercent: number | null;
  windowDurationMins: number | null;
  resetsAt: number | null;
  planType?: string | null;
  credits?: unknown;
  rateLimitReachedType?: string | null;
}

export interface ProviderUsageEntry {
  id: string;
  label: string;
  status: "available" | "unavailable" | "unknown" | "error";
  buckets: ProviderUsageBucket[];
  lastUpdatedAt: string | null;
  message?: string;
}

export interface ProviderUsageResponse {
  providers: ProviderUsageEntry[];
  generatedAt: string;
}

export function useProviderUsage() {
  return useQuery({
    queryKey: ["provider-usage"],
    queryFn: () => api.get<ProviderUsageResponse>("/api/provider-usage"),
    refetchInterval: 120_000,
    staleTime: 120_000,
    retry: 0,
  });
}
