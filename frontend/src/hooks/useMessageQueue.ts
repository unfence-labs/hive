import { useEffect, useState } from "react";
import type { QueuedMessage } from "@/types";

interface MessageQueueDeps {
  /** Key(s) that reset the queue when they change (e.g. wsId, sessionId). */
  resetKey: string;
  isStreaming: boolean;
  workspaceStatus?: string;
  pendingToolInputCount: number;
  sendMessage: (
    content: string,
    images?: QueuedMessage["images"],
    options?: QueuedMessage["options"],
    sessionId?: string,
    fileMentions?: QueuedMessage["fileMentions"],
  ) => boolean;
  /** Optional: for mosaic tiles that need to switch session before draining. */
  pinnedSessionId?: string | null;
  currentSessionId?: string | null;
  switchSession?: (sessionId: string) => void;
}

export function useMessageQueue(deps: MessageQueueDeps) {
  const {
    resetKey,
    isStreaming,
    workspaceStatus,
    pendingToolInputCount,
    sendMessage,
    pinnedSessionId,
    currentSessionId,
    switchSession,
  } = deps;

  const [queuedMessage, setQueuedMessage] = useState<QueuedMessage | null>(null);

  // Clear queue on workspace/session switch
  useEffect(() => {
    setQueuedMessage(null);
  }, [resetKey]);

  // Auto-drain when idle
  useEffect(() => {
    if (!queuedMessage) return;
    if (isStreaming) return;
    if (workspaceStatus !== "idle") return;
    if (pendingToolInputCount > 0) return;

    // If a pinned session differs from the active one, switch first
    if (pinnedSessionId && pinnedSessionId !== currentSessionId) {
      switchSession?.(pinnedSessionId);
      return; // Wait for switch to complete before sending
    }

    const { content, images, options, fileMentions } = queuedMessage;
    const sent = sendMessage(content, images, options, pinnedSessionId ?? undefined, fileMentions);
    if (sent) setQueuedMessage(null);
  }, [
    queuedMessage,
    isStreaming,
    workspaceStatus,
    pendingToolInputCount,
    sendMessage,
    pinnedSessionId,
    currentSessionId,
    switchSession,
  ]);

  return { queuedMessage, setQueuedMessage };
}
