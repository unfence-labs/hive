import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/hooks/useApi";
import { getServerUrl } from "@/hooks/useServerUrl";
import { useWorkspaceLiveDataContext } from "@/contexts/WorkspaceLiveDataContext";
import type { PreviewStatusPayload } from "@/types";

/**
 * Origin the preview proxy is reachable at. The proxy listens on its own port
 * on the same host as the backend, so derive the host from the configured
 * server URL (empty = same origin as the app).
 */
export function previewProxyOrigin(port: number): string {
  const base = getServerUrl() || window.location.origin;
  try {
    return `http://${new URL(base).hostname}:${port}`;
  } catch {
    return `http://127.0.0.1:${port}`;
  }
}

export interface UsePreviewReturn {
  /** Latest merged preview state (WS live event wins over the REST snapshot). */
  status: PreviewStatusPayload | null;
  /** Start (or retarget) the proxy. Omit url to use the detected dev URL. */
  start: (url?: string) => Promise<PreviewStatusPayload>;
  stop: () => void;
  isStarting: boolean;
  startError: string | null;
}

export function usePreview(wsId: string | undefined): UsePreviewReturn {
  const queryClient = useQueryClient();
  const liveData = useWorkspaceLiveDataContext();

  const query = useQuery({
    queryKey: ["preview", wsId],
    queryFn: () => api.get<PreviewStatusPayload>(`/api/workspaces/${wsId}/preview`),
    enabled: !!wsId,
  });

  const livePreview = wsId ? liveData[wsId]?.preview : undefined;
  const status = useMemo<PreviewStatusPayload | null>(
    () => livePreview ?? query.data ?? null,
    [livePreview, query.data],
  );

  const startMutation = useMutation({
    mutationFn: (url?: string) =>
      api.post<PreviewStatusPayload>(
        `/api/workspaces/${wsId}/preview/start`,
        url ? { url } : {},
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(["preview", wsId], data);
    },
  });

  const stopMutation = useMutation({
    mutationFn: () => api.post<PreviewStatusPayload>(`/api/workspaces/${wsId}/preview/stop`),
    onSuccess: (data) => {
      queryClient.setQueryData(["preview", wsId], data);
    },
  });

  const start = useCallback(
    (url?: string) => startMutation.mutateAsync(url),
    [startMutation],
  );
  const stop = useCallback(() => stopMutation.mutate(), [stopMutation]);

  return {
    status,
    start,
    stop,
    isStarting: startMutation.isPending,
    startError: startMutation.error?.message ?? null,
  };
}
