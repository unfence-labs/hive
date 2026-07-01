import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWsCacheInvalidation } from "@/hooks/useWsCacheInvalidation";
import { sessionMessagesKey } from "@/hooks/useSessionMessages";
import { createWrapper } from "../test-utils";

interface Message {
  type: string;
  sessionId?: string;
  streaming?: boolean;
}

interface Listener {
  wsId: string;
  handler: (msg: Message) => void;
  unsubscribe: ReturnType<typeof vi.fn>;
}

const mocks = vi.hoisted(() => ({
  onMessage: vi.fn(),
}));

vi.mock("@/lib/ws-transport", () => ({
  wsTransport: {
    onMessage: mocks.onMessage,
    onReconnect: vi.fn(() => () => {}),
  },
}));

const listeners: Listener[] = [];

function emit(wsId: string, msg: Message) {
  const listener = listeners.find((entry) => entry.wsId === wsId);
  if (!listener) throw new Error(`No listener for workspace ${wsId}`);
  listener.handler(msg);
}

describe("useWsCacheInvalidation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listeners.length = 0;
    mocks.onMessage.mockImplementation((wsId: string, handler: (msg: Message) => void) => {
      const unsubscribe = vi.fn();
      listeners.push({ wsId, handler, unsubscribe });
      return { unsubscribe, hadBufferedMessages: false };
    });
  });

  it("subscribes to WS messages for each workspace id", () => {
    const { wrapper } = createWrapper();
    renderHook(() => useWsCacheInvalidation(["ws-1", "ws-2"]), { wrapper });

    expect(mocks.onMessage).toHaveBeenCalledTimes(2);
    expect(mocks.onMessage).toHaveBeenNthCalledWith(1, "ws-1", expect.any(Function));
    expect(mocks.onMessage).toHaveBeenNthCalledWith(2, "ws-2", expect.any(Function));
  });

  it("invalidates sessions and finalized messages on done and cancelled messages", () => {
    const { wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue(undefined);
    renderHook(() => useWsCacheInvalidation(["ws-1"]), { wrapper });

    emit("ws-1", { type: "done", sessionId: "sess-1" });
    emit("ws-1", { type: "cancelled", sessionId: "sess-1" });

    expect(invalidateSpy).toHaveBeenNthCalledWith(1, { queryKey: ["sessions", "ws-1"] });
    expect(invalidateSpy).toHaveBeenNthCalledWith(2, { queryKey: sessionMessagesKey("ws-1", "sess-1") });
    expect(invalidateSpy).toHaveBeenNthCalledWith(3, { queryKey: ["sessions", "ws-1"] });
    expect(invalidateSpy).toHaveBeenNthCalledWith(4, { queryKey: sessionMessagesKey("ws-1", "sess-1") });
  });

  it("invalidates files and diff-stat caches on diff_stats messages", () => {
    const { wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue(undefined);
    renderHook(() => useWsCacheInvalidation(["ws-1"]), { wrapper });

    emit("ws-1", { type: "diff_stats" });

    expect(invalidateSpy).toHaveBeenNthCalledWith(1, { queryKey: ["files", "ws-1"] });
    expect(invalidateSpy).toHaveBeenNthCalledWith(2, { queryKey: ["diff-stat", "ws-1"] });
  });

  it("invalidates workspace cache on status messages", () => {
    const { wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue(undefined);
    renderHook(() => useWsCacheInvalidation(["ws-1"]), { wrapper });

    emit("ws-1", { type: "status" });

    expect(invalidateSpy).toHaveBeenCalledTimes(1);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["workspace", "ws-1"] });
  });

  it("invalidates sessions on streaming status messages tied to a session", () => {
    const { wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue(undefined);
    renderHook(() => useWsCacheInvalidation(["ws-1"]), { wrapper });

    emit("ws-1", { type: "status", sessionId: "sess-1", streaming: true });

    expect(invalidateSpy).toHaveBeenNthCalledWith(1, { queryKey: ["workspace", "ws-1"] });
    expect(invalidateSpy).toHaveBeenNthCalledWith(2, { queryKey: ["sessions", "ws-1"] });
  });

  it("ignores unsupported message types", () => {
    const { wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue(undefined);
    renderHook(() => useWsCacheInvalidation(["ws-1"]), { wrapper });

    emit("ws-1", { type: "branch_info" });

    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("unsubscribes all WS listeners on unmount", () => {
    const { wrapper } = createWrapper();
    const { unmount } = renderHook(() => useWsCacheInvalidation(["ws-1", "ws-2"]), { wrapper });

    const unsubscribers = listeners.map((entry) => entry.unsubscribe);
    unmount();

    expect(unsubscribers).toHaveLength(2);
    for (const unsubscribe of unsubscribers) {
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    }
  });

  it("re-subscribes when workspace list changes and cleans up previous listeners", () => {
    const { wrapper } = createWrapper();
    const { rerender } = renderHook(({ ids }: { ids: string[] }) => useWsCacheInvalidation(ids), {
      initialProps: { ids: ["ws-1"] },
      wrapper,
    });

    const firstUnsubscribe = listeners[0]?.unsubscribe;
    if (!firstUnsubscribe) throw new Error("missing first subscription");

    rerender({ ids: ["ws-2", "ws-3"] });

    expect(firstUnsubscribe).toHaveBeenCalledTimes(1);
    expect(mocks.onMessage).toHaveBeenCalledTimes(3);
    expect(mocks.onMessage).toHaveBeenNthCalledWith(2, "ws-2", expect.any(Function));
    expect(mocks.onMessage).toHaveBeenNthCalledWith(3, "ws-3", expect.any(Function));
  });
});
