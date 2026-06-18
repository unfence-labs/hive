import { useCallback, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/hooks/useApi";
import { buildWsUrl } from "@/lib/ws-url";
import { connectPtyTerminal } from "@/lib/pty-terminal";
import type { Terminal as XTerm } from "@xterm/xterm";
import type {
  ScriptStatusInfo,
  WorkspaceScriptsResponse,
} from "@/types";

const EMPTY_STATUS: Record<string, ScriptStatusInfo> = {};

export function useScripts(wsId: string | undefined) {
  const queryClient = useQueryClient();
  // Disconnect fn for the active PTY bridge (closes the socket + disposes
  // listeners). Tracked so a stop mutation can close it before the exit message
  // races the optimistic idle status.
  const disconnectRef = useRef<(() => void) | null>(null);
  const connectedTypeRef = useRef<string | null>(null);

  const query = useQuery({
    queryKey: ["scripts", wsId],
    queryFn: () => api.get<WorkspaceScriptsResponse>(`/api/workspaces/${wsId}/scripts`),
    enabled: !!wsId,
  });

  // Cleanup WS on unmount
  useEffect(() => {
    return () => {
      disconnectRef.current?.();
      disconnectRef.current = null;
      connectedTypeRef.current = null;
    };
  }, [wsId]);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["scripts", wsId] });

  const setOptimisticStatus = (type: string, next: ScriptStatusInfo) => {
    queryClient.setQueryData<WorkspaceScriptsResponse>(["scripts", wsId], (prev) =>
      prev
        ? { ...prev, status: { ...prev.status, [type]: next } }
        : prev,
    );
  };

  const closeConnectionIfType = (type: string) => {
    if (connectedTypeRef.current !== type) return;
    disconnectRef.current?.();
    disconnectRef.current = null;
    connectedTypeRef.current = null;
  };

  const startScript = useMutation({
    mutationFn: (type: string) =>
      api.post(`/api/workspaces/${wsId}/scripts/${type}/start`),
    onMutate: (type) => {
      setOptimisticStatus(type, { state: "running" });
    },
    onError: invalidate,
  });

  const stopScript = useMutation({
    mutationFn: (type: string) => {
      // Close WS first so the PTY exit message doesn't override the idle status
      closeConnectionIfType(type);
      return api.post(`/api/workspaces/${wsId}/scripts/${type}/stop`);
    },
    onMutate: (type) => {
      setOptimisticStatus(type, { state: "idle" });
    },
    onError: invalidate,
  });

  const startTerminal = useMutation({
    mutationFn: () => api.post(`/api/workspaces/${wsId}/terminal/start`),
    onMutate: () => {
      setOptimisticStatus("terminal", { state: "running" });
    },
    onError: invalidate,
  });

  const stopTerminal = useMutation({
    mutationFn: () => {
      closeConnectionIfType("terminal");
      return api.post(`/api/workspaces/${wsId}/terminal/stop`);
    },
    onMutate: () => {
      setOptimisticStatus("terminal", { state: "idle" });
    },
    onError: invalidate,
  });

  const connectOutput = useCallback((type: string, term: XTerm) => {
    if (!wsId) return;

    // Disconnect previous connection if different type
    disconnectRef.current?.();
    disconnectRef.current = null;

    connectedTypeRef.current = type;
    const url = buildWsUrl(`/ws/script/${wsId}`, { type });
    disconnectRef.current = connectPtyTerminal(term, url, {
      onExit: (exitCode) => {
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
      },
    });
  }, [wsId, queryClient]);

  const disconnectOutput = useCallback(() => {
    disconnectRef.current?.();
    disconnectRef.current = null;
    connectedTypeRef.current = null;
  }, []);

  return {
    config: query.data?.config ?? null,
    status: query.data?.status ?? EMPTY_STATUS,
    loading: query.isLoading,
    startScript: (type: string) => {
      if (!wsId) return;
      startScript.mutate(type);
    },
    stopScript: (type: string) => {
      if (!wsId) return;
      stopScript.mutate(type);
    },
    startTerminal: () => {
      if (!wsId) return;
      startTerminal.mutate();
    },
    stopTerminal: () => {
      if (!wsId) return;
      stopTerminal.mutate();
    },
    connectOutput,
    disconnectOutput,
    refresh: invalidate,
  };
}
