import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SEND_CONFIRM_TIMEOUT_MS,
  _resetOptimisticSends,
  clearTrackedSends,
  getOptimisticSendPayload,
  getSendState,
  markOptimisticSendFailed,
  resolveEchoedSend,
  resolveOptimisticSend,
  trackOptimisticSend,
} from "@/lib/optimistic-sends";
import type { OptimisticSendPayload } from "@/lib/optimistic-sends";

function payload(overrides: Partial<OptimisticSendPayload> = {}): OptimisticSendPayload {
  return { content: "hello", sessionId: "sess-1", ...overrides };
}

describe("optimistic sends", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    _resetOptimisticSends();
    vi.useRealTimers();
  });

  it("marks an unanswered send unconfirmed after the timeout", () => {
    trackOptimisticSend("local-1", payload());

    vi.advanceTimersByTime(SEND_CONFIRM_TIMEOUT_MS);

    expect(getSendState("local-1")).toBe("unconfirmed");
  });

  it("does not time out a resolved send", () => {
    trackOptimisticSend("local-1", payload());
    resolveOptimisticSend("local-1");

    vi.advanceTimersByTime(SEND_CONFIRM_TIMEOUT_MS);

    expect(getSendState("local-1")).toBeUndefined();
  });

  it("keeps a definite failure failed when the timeout elapses", () => {
    trackOptimisticSend("local-1", payload());
    markOptimisticSendFailed("local-1");

    vi.advanceTimersByTime(SEND_CONFIRM_TIMEOUT_MS);

    expect(getSendState("local-1")).toBe("failed");
  });

  it("resolves the exact client id among identical sends", () => {
    trackOptimisticSend("local-1", payload({ content: "continue" }));
    trackOptimisticSend("local-2", payload({ content: "continue" }));

    expect(resolveEchoedSend("sess-1", {
      clientMessageId: "local-2",
      content: "continue",
    })).toBe("local-2");
  });

  it("does not content-match an echo carrying another client's id", () => {
    trackOptimisticSend("local-1", payload());

    expect(resolveEchoedSend("sess-1", {
      clientMessageId: "other-client-id",
      content: "hello",
    })).toBeUndefined();
  });

  it("keeps the original retry payload", () => {
    const original = payload({
      images: [{ name: "shot.png", mediaType: "image/png", dataUrl: "data:image/png;base64,AAAA" }],
      options: { planMode: true },
    });

    trackOptimisticSend("local-1", original);

    expect(getOptimisticSendPayload("local-1")).toBe(original);
  });

  it("clears only sends belonging to the deleted session", () => {
    trackOptimisticSend("local-1", payload());
    trackOptimisticSend("local-2", payload({ sessionId: "sess-2" }));

    clearTrackedSends("sess-1");

    expect(getSendState("local-1")).toBeUndefined();
    expect(getSendState("local-2")).toBe("sending");
  });
});
