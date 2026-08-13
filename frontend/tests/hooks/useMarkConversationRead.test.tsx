import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMarkConversationRead } from "@/hooks/useMarkConversationRead";
import type { ChatMessage, UnreadSessionState } from "@/types";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
}));

vi.mock("@/lib/ws-transport", () => ({
  wsTransport: { send: mocks.send },
}));

const assistantMessage = (id: string): ChatMessage => ({
  id,
  sessionId: "sess-1",
  role: "assistant",
  content: `Response ${id}`,
  timestamp: "2026-02-12T00:00:00.000Z",
});

const unread: UnreadSessionState = {
  sessionId: "sess-1",
  assistantMessageCount: 3,
  readAssistantMessageCount: 1,
};

describe("useMarkConversationRead", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("marks through the number of rendered assistant messages when the conversation is visible", () => {
    renderHook(() => useMarkConversationRead({
      workspaceId: "ws-1",
      sessionId: "sess-1",
      messages: [
        { ...assistantMessage("a1"), role: "user" },
        assistantMessage("a2"),
        assistantMessage("a3"),
      ],
      unread,
      isConversationVisible: true,
      isHistoryLoading: false,
    }));

    expect(mocks.send).toHaveBeenCalledWith("ws-1", {
      type: "mark_read",
      sessionId: "sess-1",
      throughCount: 2,
    });
  });

  it("waits for history to finish and for rendered messages to advance past the read count", () => {
    const { rerender } = renderHook(
      ({ messages, isHistoryLoading }: { messages: ChatMessage[]; isHistoryLoading: boolean }) =>
        useMarkConversationRead({
          workspaceId: "ws-1",
          sessionId: "sess-1",
          messages,
          unread,
          isConversationVisible: true,
          isHistoryLoading,
        }),
      {
        initialProps: {
          messages: [assistantMessage("a1")],
          isHistoryLoading: true,
        },
      },
    );

    expect(mocks.send).not.toHaveBeenCalled();

    rerender({ messages: [assistantMessage("a1")], isHistoryLoading: false });
    expect(mocks.send).not.toHaveBeenCalled();

    rerender({
      messages: [assistantMessage("a1"), assistantMessage("a2")],
      isHistoryLoading: false,
    });
    expect(mocks.send).toHaveBeenCalledWith("ws-1", {
      type: "mark_read",
      sessionId: "sess-1",
      throughCount: 2,
    });
  });

  it("does not mark a conversation hidden behind a file tab", () => {
    renderHook(() => useMarkConversationRead({
      workspaceId: "ws-1",
      sessionId: "sess-1",
      messages: [assistantMessage("a1"), assistantMessage("a2")],
      unread,
      isConversationVisible: false,
      isHistoryLoading: false,
    }));

    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("waits until the document is both visible and focused", () => {
    vi.mocked(document.hasFocus).mockReturnValue(false);
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");

    renderHook(() => useMarkConversationRead({
      workspaceId: "ws-1",
      sessionId: "sess-1",
      messages: [assistantMessage("a1"), assistantMessage("a2")],
      unread,
      isConversationVisible: true,
      isHistoryLoading: false,
    }));

    expect(mocks.send).not.toHaveBeenCalled();

    act(() => {
      visibility.mockReturnValue("visible");
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(mocks.send).not.toHaveBeenCalled();

    act(() => {
      vi.mocked(document.hasFocus).mockReturnValue(true);
      window.dispatchEvent(new Event("focus"));
    });

    expect(mocks.send).toHaveBeenCalledWith("ws-1", {
      type: "mark_read",
      sessionId: "sess-1",
      throughCount: 2,
    });
  });
});
