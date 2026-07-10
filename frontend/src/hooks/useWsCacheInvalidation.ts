import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { wsTransport } from "@/lib/ws-transport";
import { invalidateSessionMessages } from "@/hooks/useSessionMessages";
import { prStatusKey } from "@/hooks/usePrStatus";

/**
 * Subscribe to WS messages for the given workspace IDs and invalidate
 * TanStack Query caches when server-side state changes.
 *
 * Replaces the ad-hoc refreshFileTree / refreshSessions effects that
 * previously lived in WorkspaceView.
 *
 * Called once in App.tsx with the full list of known workspace IDs.
 */
export function useWsCacheInvalidation(workspaceIds: string[]): void {
  const queryClient = useQueryClient();

  // pr_status is cached via the global listener, not the per-workspace
  // handlers below: those only cover workspaces already loaded from the
  // projects list, and an event arriving before that load would be consumed
  // by another handler (e.g. the conversation's) and never buffered.
  useEffect(
    () =>
      wsTransport.onGlobalMessage((wsId, msg) => {
        if (msg.type === "pr_status") {
          queryClient.setQueryData(prStatusKey(wsId), msg.status);
        }
      }),
    [queryClient],
  );

  useEffect(() => {
    const unsubscribers = workspaceIds.map((wsId) =>
      wsTransport.onMessage(wsId, (msg) => {
        switch (msg.type) {
          case "done":
          case "cancelled":
            // Session titles update after a turn completes (naming.ts).
            void queryClient.invalidateQueries({ queryKey: ["sessions", wsId] });
            if (msg.sessionId) {
              invalidateSessionMessages(queryClient, wsId, msg.sessionId);
            }
            break;

          case "diff_stats":
            // Files were created/modified/deleted by Claude.
            void queryClient.invalidateQueries({ queryKey: ["files", wsId] });
            void queryClient.invalidateQueries({ queryKey: ["diff-stat", wsId] });
            void queryClient.invalidateQueries({ queryKey: ["file-completions", wsId] });
            break;

          case "status":
            // Workspace busy/idle transition.
            void queryClient.invalidateQueries({ queryKey: ["workspace", wsId] });
            // Auto-created sessions (first user message) should appear in tabs
            // immediately, not only after done/cancelled events.
            if (msg.sessionId && msg.streaming) {
              void queryClient.invalidateQueries({ queryKey: ["sessions", wsId] });
            }
            break;
        }
      }),
    );

    return () => {
      for (const sub of unsubscribers) sub.unsubscribe();
    };
  }, [workspaceIds, queryClient]);
}
