import { api } from "@/hooks/useApi";
import type { ConversationMessage } from "@/types";

interface ConversationState {
  sessionId: string;
  messages: ConversationMessage[];
  status: string;
}

export function useConversationApi(workspaceId: string | undefined) {
  const base = workspaceId ? `/api/workspaces/${workspaceId}/conversation` : null;

  const startConversation = async () => {
    if (!base) throw new Error("No workspace ID");
    return api.post<ConversationState>(base);
  };

  const endConversation = async () => {
    if (!base) throw new Error("No workspace ID");
    return api.delete<void>(base);
  };

  const getState = async () => {
    if (!base) throw new Error("No workspace ID");
    return api.get<ConversationState>(base);
  };

  const getMessages = async () => {
    if (!base) throw new Error("No workspace ID");
    return api.get<ConversationMessage[]>(`${base}/messages`);
  };

  return { startConversation, endConversation, getState, getMessages };
}
