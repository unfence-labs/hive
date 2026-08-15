/** True when a persisted assistant message counts toward a session's
 *  assistantMessageCount: visible text or a surfaced cancellation;
 *  tool-/reasoning-only messages are persisted but not counted.
 *  Single TypeScript source of truth: the backend increment (_handleExit in
 *  conversation-session.ts), the legacy metadata migration, and the web
 *  rendered count all consume this function. iOS re-implements the rule in
 *  ChatView.readProgress (ChatView.swift); keep it in sync. */
export interface CountedMessageLike {
  role: string;
  content: string;
  cancelled?: boolean;
}

export function isCountedAssistantMessage(msg: CountedMessageLike): boolean {
  return msg.role === "assistant" && (msg.content !== "" || msg.cancelled === true);
}
