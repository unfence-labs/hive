import { useCallback } from "react";
import { api } from "@/hooks/useApi";

export function useConversationApi(workspaceId: string | undefined) {
  const endSession = useCallback(async () => {
    if (!workspaceId) throw new Error("No workspace ID");
    return api.delete<void>(`/api/workspaces/${workspaceId}/session`);
  }, [workspaceId]);

  return { endSession };
}
