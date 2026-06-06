import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useBrainChatRefresh } from "@/hooks/useBrainChatRefresh";
import { createWrapper } from "../test-utils";

interface Message {
  type: string;
  name?: string;
}

interface Listener {
  wsId: string;
  handler: (msg: Message) => void;
  unsubscribe: ReturnType<typeof vi.fn>;
}

const mocks = vi.hoisted(() => ({ onMessage: vi.fn() }));

vi.mock("@/lib/ws-transport", () => ({
  wsTransport: { onMessage: mocks.onMessage },
}));

const listeners: Listener[] = [];

function emit(msg: Message) {
  const listener = listeners.find((entry) => entry.wsId === "brain");
  if (!listener) throw new Error("No brain listener");
  listener.handler(msg);
}

describe("useBrainChatRefresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listeners.length = 0;
    mocks.onMessage.mockImplementation((wsId: string, handler: (msg: Message) => void) => {
      const unsubscribe = vi.fn();
      listeners.push({ wsId, handler, unsubscribe });
      return { unsubscribe, hadBufferedMessages: false };
    });
  });

  it("subscribes to the brain workspace channel", () => {
    const { wrapper } = createWrapper();
    renderHook(() => useBrainChatRefresh(null), { wrapper });
    expect(mocks.onMessage).toHaveBeenCalledWith("brain", expect.any(Function));
  });

  it("invalidates Brain file/status caches when a turn completes", () => {
    const { wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue(undefined);
    renderHook(() => useBrainChatRefresh(null), { wrapper });

    emit({ type: "done" });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["brain", "files"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["brain", "status"] });
  });

  it("invalidates the open file content on a write/edit tool call", () => {
    const { wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue(undefined);
    renderHook(() => useBrainChatRefresh("notes/topic.md"), { wrapper });

    emit({ type: "tool_use", name: "Write" });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["brain", "file", "notes/topic.md"] });
  });

  it("ignores non-write tool calls", () => {
    const { wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue(undefined);
    renderHook(() => useBrainChatRefresh("notes/topic.md"), { wrapper });

    emit({ type: "tool_use", name: "Read" });

    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("unsubscribes on unmount", () => {
    const { wrapper } = createWrapper();
    const { unmount } = renderHook(() => useBrainChatRefresh(null), { wrapper });
    const unsubscribe = listeners[0]?.unsubscribe;
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
