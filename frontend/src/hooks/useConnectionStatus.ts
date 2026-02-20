import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getServerUrl } from "./useServerUrl";

export type ConnectionStatus = "unknown" | "connected" | "disconnected";

async function checkHealth(): Promise<ConnectionStatus> {
  const base = getServerUrl();
  if (!base) return "unknown";
  try {
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok ? "connected" : "disconnected";
  } catch {
    return "disconnected";
  }
}

export function useConnectionStatus() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["health"],
    queryFn: checkHealth,
    staleTime: 0,
    refetchInterval: false,
    retry: 0,
  });

  return {
    status: query.data ?? ("unknown" as ConnectionStatus),
    check: () => queryClient.refetchQueries({ queryKey: ["health"] }),
  };
}
