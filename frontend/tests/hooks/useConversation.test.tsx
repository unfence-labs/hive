import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useConversation } from "@/hooks/useConversation";
import type { WsOutgoing } from "@/types";

vi.mock("@/lib/ws-transport", () => {
  let status: "connecting" | "connected" | "disconnected" = "disconnected";
  const messageHandlers = new Set<(msg: WsOutgoing) => void>();
  const statusListeners = new Set<() => void>();

  const notifyStatus = () => {
    for (const listener of statusListeners) listener();
  };

  const wsTransport = {
    connect: vi.fn((_workspaceId: string) => {
      status = "connected";
      notifyStatus();
    }),
    disconnect: vi.fn(() => {
      status = "disconnected";
      notifyStatus();
    }),
    send: vi.fn(() => true),
    onMessage: vi.fn((handler: (msg: WsOutgoing) => void) => {
      messageHandlers.add(handler);
      return () => {
        messageHandlers.delete(handler);
      };
    }),
    subscribe: (listener: () => void) => {
      statusListeners.add(listener);
      return () => {
        statusListeners.delete(listener);
      };
    },
    getStatus: () => status,
  };

  const __wsMock = {
    emit: (msg: WsOutgoing) => {
      for (const handler of messageHandlers) handler(msg);
    },
    reset: () => {
      status = "disconnected";
      messageHandlers.clear();
      statusListeners.clear();
      wsTransport.connect.mockClear();
      wsTransport.disconnect.mockClear();
      wsTransport.send.mockClear();
      wsTransport.onMessage.mockClear();
    },
    sendMock: wsTransport.send,
    connectMock: wsTransport.connect,
    disconnectMock: wsTransport.disconnect,
  };

  return { wsTransport, __wsMock };
});

const getWsMock = async () =>
  (await import("@/lib/ws-transport")) as unknown as {
    __wsMock: {
      emit: (msg: WsOutgoing) => void;
      reset: () => void;
      sendMock: ReturnType<typeof vi.fn>;
      connectMock: ReturnType<typeof vi.fn>;
      disconnectMock: ReturnType<typeof vi.fn>;
    };
  };

describe("useConversation", () => {
  beforeEach(async () => {
    const { __wsMock } = await getWsMock();
    __wsMock.reset();
  });

  it("connects on mount and disconnects on unmount", async () => {
    const { __wsMock } = await getWsMock();
    const { unmount } = renderHook(() => useConversation("ws-1"));

    expect(__wsMock.connectMock).toHaveBeenCalledWith("ws-1");

    unmount();

    expect(__wsMock.disconnectMock).toHaveBeenCalledTimes(1);
  });

  it("sends user messages and updates local state after transport accepts the send", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useConversation("ws-1"));

    act(() => {
      result.current.sendMessage("hello");
    });

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]?.role).toBe("user");
    expect(result.current.messages[0]?.content).toBe("hello");
    expect(result.current.isStreaming).toBe(true);
    expect(__wsMock.sendMock).toHaveBeenCalledWith({
      type: "user_message",
      content: "hello",
    });
  });

  it("does not add user message when transport send fails", async () => {
    const { __wsMock } = await getWsMock();
    __wsMock.sendMock.mockReturnValueOnce(false);
    const { result } = renderHook(() => useConversation("ws-1"));

    act(() => {
      const sent = result.current.sendMessage("hello");
      expect(sent).toBe(false);
    });

    expect(result.current.messages).toHaveLength(0);
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.error).toContain("Message not sent");
  });

  it("builds assistant message from stream deltas and done event", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useConversation("ws-1"));

    act(() => {
      result.current.sendMessage("start");
    });

    act(() => {
      __wsMock.emit({ type: "text_delta", text: "Hi " });
      __wsMock.emit({ type: "text_delta", text: "there" });
      __wsMock.emit({ type: "done", sessionId: "sess-1" });
    });

    expect(result.current.isStreaming).toBe(false);
    expect(result.current.messages.at(-1)?.role).toBe("assistant");
    expect(result.current.messages.at(-1)?.content).toBe("Hi there");
    expect(result.current.sessionId).toBe("sess-1");
  });

  it("marks assistant output as cancelled when cancelled event is received", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useConversation("ws-1"));

    act(() => {
      result.current.sendMessage("start");
    });

    act(() => {
      __wsMock.emit({ type: "text_delta", text: "partial" });
      __wsMock.emit({ type: "cancelled" });
    });

    expect(result.current.isStreaming).toBe(false);
    expect(result.current.messages.at(-1)?.cancelled).toBe(true);
    expect(result.current.messages.at(-1)?.content).toBe("partial");
  });

  it("clears local chat state", () => {
    const { result } = renderHook(() => useConversation("ws-1"));

    act(() => {
      result.current.sendMessage("hello");
      result.current.clearChat();
    });

    expect(result.current.messages).toEqual([]);
    expect(result.current.sessionId).toBeUndefined();
    expect(result.current.isStreaming).toBe(false);
  });

  it("formats AskUserQuestion answers and sends a response", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useConversation("ws-1"));

    act(() => {
      result.current.answerQuestion("tool-1", [
        { questionIndex: 0, selectedOptions: [1, 2] },
        { questionIndex: 1, selectedOptions: [], customText: "custom" },
      ]);
    });

    expect(__wsMock.sendMock).toHaveBeenLastCalledWith({
      type: "user_message",
      content:
        "[Response to question]\nQ1: Selected option(s) 2, 3\nQ2: \"custom\"",
    });
  });

  it("sends approval shortcut message", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useConversation("ws-1"));

    act(() => {
      result.current.approvePlan();
    });

    expect(__wsMock.sendMock).toHaveBeenLastCalledWith({
      type: "user_message",
      content: "I approve the plan. Please proceed with implementation.",
    });
  });
});
