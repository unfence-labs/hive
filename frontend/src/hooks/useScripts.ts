import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "@/hooks/useApi";
import { getServerUrl } from "@/hooks/useServerUrl";
import type { Terminal as XTerm } from "@xterm/xterm";
import type {
  ScriptType,
  ScriptStatusInfo,
  HiveConfig,
  WorkspaceScriptsResponse,
} from "@/types";

interface ScriptsState {
  config: HiveConfig | null;
  status: {
    setup: ScriptStatusInfo;
    run: ScriptStatusInfo;
  };
  loading: boolean;
}

const DEFAULT_STATUS: ScriptStatusInfo = { state: "idle" };

function buildWsUrl(workspaceId: string, type: ScriptType): string {
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
  const [state, setState] = useState<ScriptsState>({
    config: null,
    status: { setup: DEFAULT_STATUS, run: DEFAULT_STATUS },
    loading: true,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const connectedTypeRef = useRef<ScriptType | null>(null);

  // Fetch config + status on mount / wsId change
  const refresh = useCallback(async () => {
    if (!wsId) {
      setState({ config: null, status: { setup: DEFAULT_STATUS, run: DEFAULT_STATUS }, loading: false });
      return;
    }
    try {
      const data = await api.get<WorkspaceScriptsResponse>(`/api/workspaces/${wsId}/scripts`);
      setState({ config: data.config, status: data.status, loading: false });
    } catch {
      setState({ config: null, status: { setup: DEFAULT_STATUS, run: DEFAULT_STATUS }, loading: false });
    }
  }, [wsId]);

  useEffect(() => {
    refresh();
    return () => {
      // Cleanup WS on unmount
      wsRef.current?.close();
      wsRef.current = null;
      connectedTypeRef.current = null;
    };
  }, [refresh]);

  const startScript = useCallback(async (type: ScriptType) => {
    if (!wsId) return;
    try {
      await api.post(`/api/workspaces/${wsId}/scripts/${type}/start`);
      setState((prev) => ({
        ...prev,
        status: { ...prev.status, [type]: { state: "running" as const } },
      }));
    } catch {
      // Refresh to get actual status
      await refresh();
    }
  }, [wsId, refresh]);

  const stopScript = useCallback(async (type: ScriptType) => {
    if (!wsId) return;
    // Close WS first so the PTY exit message doesn't override the idle status
    if (connectedTypeRef.current === type) {
      wsRef.current?.close();
      wsRef.current = null;
      connectedTypeRef.current = null;
    }
    try {
      await api.post(`/api/workspaces/${wsId}/scripts/${type}/stop`);
      setState((prev) => ({
        ...prev,
        status: { ...prev.status, [type]: { state: "idle" as const } },
      }));
    } catch {
      await refresh();
    }
  }, [wsId, refresh]);

  const connectOutput = useCallback((type: ScriptType, term: XTerm) => {
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
            setState((prev) => ({
              ...prev,
              status: {
                ...prev.status,
                [type]: { state: exitCode === 0 ? "done" : "error", exitCode },
              },
            }));
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
  }, [wsId]);

  const disconnectOutput = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    connectedTypeRef.current = null;
  }, []);

  return {
    config: state.config,
    status: state.status,
    loading: state.loading,
    startScript,
    stopScript,
    connectOutput,
    disconnectOutput,
    refresh,
  };
}
