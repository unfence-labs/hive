import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getServerUrl } from "./useServerUrl";

export type ConnectionStatus = "unknown" | "connected" | "disconnected";

interface HealthResult {
  status: ConnectionStatus;
  backendEnv: string | null;
}

async function checkHealth(): Promise<HealthResult> {
  const base = getServerUrl();
  if (!base) return { status: "unknown", backendEnv: null };
  try {
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return { status: "disconnected", backendEnv: null };
    const data = await res.json();
    return { status: "connected", backendEnv: data.env ?? null };
  } catch {
    return { status: "disconnected", backendEnv: null };
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
    status: query.data?.status ?? ("unknown" as ConnectionStatus),
    backendEnv: query.data?.backendEnv ?? null,
    check: () => queryClient.refetchQueries({ queryKey: ["health"] }),
  };
}
