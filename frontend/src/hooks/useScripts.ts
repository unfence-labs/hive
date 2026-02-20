import { useCallback, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/hooks/useApi";
import { getServerUrl } from "@/hooks/useServerUrl";
import type { Terminal as XTerm } from "@xterm/xterm";
import type {
  ScriptStatusInfo,
  WorkspaceScriptsResponse,
} from "@/types";

const EMPTY_STATUS: Record<string, ScriptStatusInfo> = {};

function buildWsUrl(workspaceId: string, type: string): string {
  const serverUrl = getServerUrl();
  let wsHost: string;
  if (serverUrl) {
    wsHost = serverUrl.replace(/^http/, "ws");
  } else {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    wsHost = import.meta.env.VITE_WS_URL || `${protocol}//${window.location.host}`;
  }
  const authToken = (import.meta.env.VITE_HIVE_AUTH_TOKEN as string | undefined)?.trim();
  const params = new URLSearchParams({ type });
  if (authToken) params.set("token", authToken);
  return `${wsHost}/ws/script/${workspaceId}?${params.toString()}`;
}

export function useScripts(wsId: string | undefined) {
  const queryClient = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const connectedTypeRef = useRef<string | null>(null);

  const query = useQuery({
    queryKey: ["scripts", wsId],
    queryFn: () => api.get<WorkspaceScriptsResponse>(`/api/workspaces/${wsId}/scripts`),
    enabled: !!wsId,
  });

  // Cleanup WS on unmount
  useEffect(() => {
    return () => {
      wsRef.current?.close();
      wsRef.current = null;
      connectedTypeRef.current = null;
    };
  }, [wsId]);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["scripts", wsId] });

  const startScript = useMutation({
    mutationFn: (type: string) =>
      api.post(`/api/workspaces/${wsId}/scripts/${type}/start`),
    onMutate: (type) => {
      queryClient.setQueryData<WorkspaceScriptsResponse>(["scripts", wsId], (prev) =>
        prev
          ? { ...prev, status: { ...prev.status, [type]: { state: "running" as const } } }
          : prev,
      );
    },
    onError: invalidate,
  });

  const stopScript = useMutation({
    mutationFn: (type: string) => {
      // Close WS first so the PTY exit message doesn't override the idle status
      if (connectedTypeRef.current === type) {
        wsRef.current?.close();
        wsRef.current = null;
        connectedTypeRef.current = null;
      }
      return api.post(`/api/workspaces/${wsId}/scripts/${type}/stop`);
    },
    onMutate: (type) => {
      queryClient.setQueryData<WorkspaceScriptsResponse>(["scripts", wsId], (prev) =>
        prev
          ? { ...prev, status: { ...prev.status, [type]: { state: "idle" as const } } }
          : prev,
      );
    },
    onError: invalidate,
  });

  const connectOutput = useCallback((type: string, term: XTerm) => {
    if (!wsId) return;

    // Disconnect previous connection if different type
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    connectedTypeRef.current = type;
    const url = buildWsUrl(wsId, type);
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    const encoder = new TextEncoder();

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        term.write(new Uint8Array(event.data));
      } else {
        try {
          const msg = JSON.parse(event.data as string);
          if (msg.type === "exit") {
            const exitCode = msg.code ?? -1;
            queryClient.setQueryData<WorkspaceScriptsResponse>(["scripts", wsId], (prev) =>
              prev
                ? {
                    ...prev,
                    status: {
                      ...prev.status,
                      [type]: { state: exitCode === 0 ? "done" : "error", exitCode },
                    },
                  }
                : prev,
            );
          }
        } catch {
          // ignore
        }
      }
    };

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
    };

    // Bidirectional: allow interactive input
    const inputDisposable = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(encoder.encode(data));
      }
    });

    const resizeDisposable = term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols, rows }));
      }
    });

    ws.onclose = () => {
      inputDisposable.dispose();
      resizeDisposable.dispose();
      if (wsRef.current === ws) {
        wsRef.current = null;
        connectedTypeRef.current = null;
      }
    };
  }, [wsId, queryClient]);

  const disconnectOutput = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    connectedTypeRef.current = null;
  }, []);

  return {
    config: query.data?.config ?? null,
    status: query.data?.status ?? EMPTY_STATUS,
    loading: query.isLoading,
    startScript: (type: string) => startScript.mutate(type),
    stopScript: (type: string) => stopScript.mutate(type),
    connectOutput,
    disconnectOutput,
    refresh: invalidate,
  };
}
