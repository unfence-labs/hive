import { useCallback, useEffect, useState } from "react";
import { getServerUrl } from "./useServerUrl";

export type ConnectionStatus = "unknown" | "connected" | "disconnected";

export function useConnectionStatus() {
  const [status, setStatus] = useState<ConnectionStatus>("unknown");

  const check = useCallback(async () => {
    const base = getServerUrl();
    if (!base) {
      setStatus("unknown");
      return;
    }
    try {
      const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(3000) });
      setStatus(res.ok ? "connected" : "disconnected");
    } catch {
      setStatus("disconnected");
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  return { status, check };
}
