import { api } from "@/hooks/useApi";

export function useConversationApi(workspaceId: string | undefined) {
  const endSession = async () => {
    if (!workspaceId) throw new Error("No workspace ID");
    return api.delete<void>(`/api/workspaces/${workspaceId}/session`);
  };

  return { endSession };
}
