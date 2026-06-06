import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { wsTransport } from "@/lib/ws-transport";
import {
  BRAIN_FILES_QUERY_KEY,
  BRAIN_PARSED_DIFF_QUERY_KEY,
  BRAIN_STATUS_QUERY_KEY,
  BRAIN_WORKSPACE_ID,
  brainFileQueryKey,
} from "@/lib/brain";

/** Tool names that mutate the Brain working tree. */
const WRITE_TOOLS = new Set(["Write", "Edit"]);

/**
 * Refresh Brain editor state when the Brain agent writes files.
 *
 * The Brain is not git-sync polled, so file changes surface only through the
 * agent's tool stream. We invalidate the file tree, pending-change status, the
 * parsed inline-viewer diff, and the open file's content when a write/edit tool
 * completes or a turn finishes. For
 * the currently open file this is a last-write-wins refresh (agreed): the editor
 * adopts the agent's new content.
 *
 * @param openFilePath - The path currently open in the editor (refreshed too).
 */
export function useBrainChatRefresh(openFilePath: string | null): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const invalidateBrainFiles = () => {
      void queryClient.invalidateQueries({ queryKey: BRAIN_FILES_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: BRAIN_STATUS_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: BRAIN_PARSED_DIFF_QUERY_KEY });
      if (openFilePath) {
        void queryClient.invalidateQueries({ queryKey: brainFileQueryKey(openFilePath) });
      }
    };

    const sub = wsTransport.onMessage(BRAIN_WORKSPACE_ID, (msg) => {
      if (msg.type === "done" || msg.type === "cancelled") {
        invalidateBrainFiles();
      } else if (msg.type === "tool_use" && WRITE_TOOLS.has(msg.name)) {
        invalidateBrainFiles();
      }
    });

    return () => sub.unsubscribe();
  }, [queryClient, openFilePath]);
}
