import { useEffect, useState } from "react";
import { wsTransport } from "@/lib/ws-transport";
import type { ChatMessage, UnreadSessionState } from "@/types";

function isPageActive(): boolean {
  return document.visibilityState === "visible" && document.hasFocus();
}

function usePageActive(): boolean {
  const [active, setActive] = useState(isPageActive);

  useEffect(() => {
    const update = () => setActive(isPageActive());
    document.addEventListener("visibilitychange", update);
    window.addEventListener("focus", update);
    window.addEventListener("blur", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("focus", update);
      window.removeEventListener("blur", update);
    };
  }, []);

  return active;
}

export function useMarkConversationRead({
  workspaceId,
  sessionId,
  messages,
  unread,
  isConversationVisible,
  isHistoryLoading,
}: {
  workspaceId?: string;
  sessionId?: string;
  messages: ChatMessage[];
  unread?: UnreadSessionState;
  isConversationVisible: boolean;
  isHistoryLoading: boolean;
}): void {
  const pageActive = usePageActive();
  const renderedAssistantCount = messages.reduce(
    (count, message) => count + (message.role === "assistant" ? 1 : 0),
    0,
  );

  useEffect(() => {
    if (
      !workspaceId ||
      !sessionId ||
      !unread ||
      !isConversationVisible ||
      !pageActive ||
      isHistoryLoading ||
      renderedAssistantCount <= unread.readAssistantMessageCount
    ) {
      return;
    }

    wsTransport.send(workspaceId, {
      type: "mark_read",
      sessionId,
      throughCount: renderedAssistantCount,
    });
  }, [
    workspaceId,
    sessionId,
    unread,
    isConversationVisible,
    pageActive,
    isHistoryLoading,
    renderedAssistantCount,
  ]);
}
