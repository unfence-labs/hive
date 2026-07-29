import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getConnection, serverUrlFor } from "@/hooks/useConnection";
import type { ServerConnectionFailure } from "@/lib/server-connection";
import { ServerConnectionError, probeServerConnection } from "@/lib/server-connection";

/**
 * What the badge reports. The three failure shapes are kept apart because they
 * need different fixes: no server configured yet, a server that never answered,
 * and a server that answered but refused this client's token.
 */
export type ConnectionStatus =
  | "unknown"
  | "connected"
  | "unauthorized"
  | "forbidden"
  | "disconnected";

const FAILURE_STATUS: Record<ServerConnectionFailure, ConnectionStatus> = {
  invalid: "disconnected",
  unreachable: "disconnected",
  unauthorized: "unauthorized",
  forbidden: "forbidden",
};

interface ConnectionResult {
  status: ConnectionStatus;
  backendEnv: string | null;
}

/**
 * The environment label for the dev banner. It only exists on `/health`, which
 * is unauthenticated by design and carries no secrets, so it is read separately
 * and only once the authenticated probe has already succeeded.
 */
async function readBackendEnv(base: string): Promise<string | null> {
  try {
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const data = await res.json();
    return data.env ?? null;
  } catch {
    return null;
  }
}

/**
 * Status comes from `probeServerConnection`, the same authenticated probe the
 * connect form uses. `/health` must not decide it: that route is exempt from the
 * auth guard, so polling it would show "Connected" to an operator whose token is
 * stale while every API call and WebSocket is being rejected.
 */
async function checkConnection(): Promise<ConnectionResult> {
  const connection = getConnection();
  if (!connection) return { status: "unknown", backendEnv: null };
  try {
    await probeServerConnection(connection);
  } catch (error) {
    const reason = error instanceof ServerConnectionError ? error.reason : "unreachable";
    return { status: FAILURE_STATUS[reason], backendEnv: null };
  }
  return { status: "connected", backendEnv: await readBackendEnv(serverUrlFor(connection)) };
}

export function useConnectionStatus() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["health"],
    queryFn: checkConnection,
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
