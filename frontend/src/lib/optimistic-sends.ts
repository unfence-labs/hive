import type { FileMention, ImageAttachment, MessageOptions } from "@/types";

export type SendState = "sending" | "unconfirmed" | "failed";

export interface OptimisticSendPayload {
  content: string;
  images?: ImageAttachment[];
  fileMentions?: FileMention[];
  options?: MessageOptions;
  sessionId: string;
}

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

export function getSendStates(): Record<string, SendState> {
  return snapshot;
}

export function getSendState(messageId: string): SendState | undefined {
  return sends.get(messageId)?.state;
}

export function trackOptimisticSend(messageId: string, payload: OptimisticSendPayload): void {
  clearTimeout(sends.get(messageId)?.timer);
  const timer = setTimeout(() => markOptimisticSendUnconfirmed(messageId), SEND_CONFIRM_TIMEOUT_MS);
  sends.set(messageId, { state: "sending", payload, timer });
  notify();
}

export function markOptimisticSendUnconfirmed(messageId: string): void {
  const send = sends.get(messageId);
  if (!send || send.state !== "sending") return;
  clearTimeout(send.timer);
  send.timer = undefined;
  send.state = "unconfirmed";
  notify();
}

export function markOptimisticSendFailed(messageId: string): void {
  const send = sends.get(messageId);
  if (!send || send.state === "failed") return;
  clearTimeout(send.timer);
  send.timer = undefined;
  send.state = "failed";
  notify();
}

export function getOptimisticSendPayload(messageId: string): OptimisticSendPayload | undefined {
  return sends.get(messageId)?.payload;
}

export function clearTrackedSends(sessionId: string): void {
  let changed = false;
  for (const [id, send] of sends) {
    if (send.payload.sessionId !== sessionId) continue;
    clearTimeout(send.timer);
    sends.delete(id);
    changed = true;
  }
  if (changed) notify();
}

export function resolveOptimisticSend(messageId: string): void {
  clearTimeout(sends.get(messageId)?.timer);
  if (sends.delete(messageId)) notify();
}

export function resolveEchoedSend(
  sessionId: string,
  serverMessage: { clientMessageId?: string },
): string | undefined {
  if (!serverMessage.clientMessageId) return undefined;
  const send = sends.get(serverMessage.clientMessageId);
  return send?.payload.sessionId === sessionId ? serverMessage.clientMessageId : undefined;
}

export function _resetOptimisticSends(): void {
  for (const send of sends.values()) clearTimeout(send.timer);
  sends.clear();
  snapshot = {};
}
