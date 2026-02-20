import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { wsTransport } from "@/lib/ws-transport";

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

  useEffect(() => {
    const unsubscribers = workspaceIds.map((wsId) =>
      wsTransport.onMessage(wsId, (msg) => {
        switch (msg.type) {
          case "done":
          case "cancelled":
            // Session titles update after a turn completes (naming.ts).
            void queryClient.invalidateQueries({ queryKey: ["sessions", wsId] });
            break;

          case "diff_stats":
            // Files were created/modified/deleted by Claude.
            void queryClient.invalidateQueries({ queryKey: ["files", wsId] });
            void queryClient.invalidateQueries({ queryKey: ["diff-stat", wsId] });
            break;

          case "status":
            // Workspace busy/idle transition.
            void queryClient.invalidateQueries({ queryKey: ["workspace", wsId] });
            break;
        }
      }),
    );

    return () => {
      for (const sub of unsubscribers) sub.unsubscribe();
    };
  }, [workspaceIds, queryClient]);
}
