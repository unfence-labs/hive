import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SEND_CONFIRM_TIMEOUT_MS,
  _resetOptimisticSends,
  getSendState,
  markOptimisticSendFailed,
  resolveOptimisticSend,
  subscribeSendStates,
  trackOptimisticSend,
} from "@/lib/optimistic-sends";

const payload = { content: "hello", sessionId: "sess-1" };

describe("optimistic-sends timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    _resetOptimisticSends();
  });

  it("flips a tracked send to failed after SEND_CONFIRM_TIMEOUT_MS and notifies listeners", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSendStates(listener);

    trackOptimisticSend("local-1", payload);
    listener.mockClear();

    vi.advanceTimersByTime(SEND_CONFIRM_TIMEOUT_MS);

    expect(getSendState("local-1")).toBe("failed");
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  it("does not flip a send resolved before the timeout", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSendStates(listener);

    trackOptimisticSend("local-1", payload);
    resolveOptimisticSend("local-1");
    listener.mockClear();

    vi.advanceTimersByTime(SEND_CONFIRM_TIMEOUT_MS);

    expect(getSendState("local-1")).toBeUndefined();
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("restarts the timeout when a send is re-tracked (retry)", () => {
    trackOptimisticSend("local-1", payload);
    vi.advanceTimersByTime(10_000);

    trackOptimisticSend("local-1", payload);
    vi.advanceTimersByTime(10_000);
    expect(getSendState("local-1")).toBe("sending");

    vi.advanceTimersByTime(5_000);
    expect(getSendState("local-1")).toBe("failed");
  });

  it("does not double-notify when a manually-failed send's timer later fires", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSendStates(listener);

    trackOptimisticSend("local-1", payload);
    markOptimisticSendFailed("local-1");
    listener.mockClear();

    vi.advanceTimersByTime(SEND_CONFIRM_TIMEOUT_MS);

    expect(getSendState("local-1")).toBe("failed");
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});
