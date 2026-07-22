import type { FileMention, ImageAttachment, MessageOptions } from "@/types";

/**
 * Delivery tracking for user messages appended to the transcript before the
 * server confirms them, mirroring the iOS ConversationStore optimistic sends.
 * A message id absent from the map means the message is server-confirmed.
 *
 * Module-level (like `savedSessionByWorkspace` in useConversation) so delivery
 * state survives hook re-mounts on workspace/session navigation — a pending or
 * failed send must not silently render as delivered after navigating away and
 * back.
 */

export type SendState = "sending" | "failed";

export interface OptimisticSendPayload {
  content: string;
  images?: ImageAttachment[];
  fileMentions?: FileMention[];
  options?: MessageOptions;
  sessionId: string;
}

/**
 * A send unconfirmed after this long is marked failed so the user gets the
 * Retry affordance instead of a permanent "Sending…". Generous because the
 * echo can lag behind cold-session activation and image persistence.
 */
export const SEND_CONFIRM_TIMEOUT_MS = 15_000;

interface OptimisticSend {
  state: SendState;
  payload: OptimisticSendPayload;
  timer?: ReturnType<typeof setTimeout>;
}

const sends = new Map<string, OptimisticSend>();
const listeners = new Set<() => void>();
let snapshot: Record<string, SendState> = {};

function notify(): void {
  snapshot = {};
  for (const [id, send] of sends) snapshot[id] = send.state;
  for (const listener of listeners) listener();
}

export function subscribeSendStates(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Per-message delivery state, keyed by local message id. Referentially stable between mutations. */
export function getSendStates(): Record<string, SendState> {
  return snapshot;
}

/** Delivery state for a message, if it is a tracked optimistic send. */
export function getSendState(messageId: string): SendState | undefined {
  return sends.get(messageId)?.state;
}

/** Track a locally-appended user message as sending. Also re-marks a retry. */
export function trackOptimisticSend(messageId: string, payload: OptimisticSendPayload): void {
  clearTimeout(sends.get(messageId)?.timer);
  const timer = setTimeout(() => markOptimisticSendFailed(messageId), SEND_CONFIRM_TIMEOUT_MS);
  sends.set(messageId, { state: "sending", payload, timer });
  notify();
}

/** Mark a tracked send as failed (kept in the transcript with a retry affordance). */
export function markOptimisticSendFailed(messageId: string): void {
  const send = sends.get(messageId);
  if (!send || send.state === "failed") return;
  clearTimeout(send.timer);
  send.timer = undefined;
  send.state = "failed";
  notify();
}

/** Original send payload, kept so a failed message can be resent verbatim. */
export function getOptimisticSendPayload(messageId: string): OptimisticSendPayload | undefined {
  return sends.get(messageId)?.payload;
}

/** Stop tracking a message (delivery confirmed, or the user discarded it). */
export function resolveOptimisticSend(messageId: string): void {
  clearTimeout(sends.get(messageId)?.timer);
  if (sends.delete(messageId)) notify();
}

/**
 * Oldest tracked send in a session matching the given content. Server echoes
 * carry no client-generated id, so delivery is matched by content — the same
 * trade-off the iOS client makes.
 */
export function findOptimisticSend(sessionId: string, content: string): string | undefined {
  for (const [id, send] of sends) {
    if (send.payload.sessionId === sessionId && send.payload.content === content) return id;
  }
  return undefined;
}

/** @internal Test-only: clear all tracked sends between tests. */
export function _resetOptimisticSends(): void {
  for (const send of sends.values()) clearTimeout(send.timer);
  sends.clear();
  snapshot = {};
}
