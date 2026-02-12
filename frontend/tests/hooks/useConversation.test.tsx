import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useConversation } from "@/hooks/useConversation";
import type { ChatMessage, WsOutgoing } from "@/types";

vi.mock("@/hooks/useApi", () => {
  const getMock = vi.fn(
    () =>
      new Promise<ChatMessage[]>(() => {
        // Keep pending by default to avoid unintentional state updates in tests.
      }),
  );

  return {
    api: {
      get: getMock,
    },
    __apiMock: {
      getMock,
      reset: () => {
        getMock.mockReset();
        getMock.mockImplementation(
          () =>
            new Promise<ChatMessage[]>(() => {
              // Keep pending by default to avoid unintentional state updates in tests.
            }),
        );
      },
    },
  };
});

vi.mock("@/lib/ws-transport", () => {
  type ConnectionStatus = "connecting" | "connected" | "disconnected";
  const statuses = new Map<string, ConnectionStatus>();
  const messageHandlers = new Map<string, Set<(msg: WsOutgoing) => void>>();
  const statusListeners = new Map<string, Set<() => void>>();
  const replayMessages = new Map<string, WsOutgoing[]>();

  const getSet = <T,>(source: Map<string, Set<T>>, workspaceId: string) => {
    const existing = source.get(workspaceId);
    if (existing) return existing;
    const created = new Set<T>();
    source.set(workspaceId, created);
    return created;
  };

  const notifyStatus = (workspaceId: string) => {
    for (const listener of statusListeners.get(workspaceId) ?? []) listener();
  };

  const wsTransport = {
    connect: vi.fn((workspaceId: string) => {
      statuses.set(workspaceId, "connected");
      notifyStatus(workspaceId);
    }),
    disconnect: vi.fn((workspaceId: string) => {
      statuses.set(workspaceId, "disconnected");
      notifyStatus(workspaceId);
    }),
    syncWorkspaces: vi.fn(),
    disconnectAll: vi.fn(() => {
      statuses.clear();
      messageHandlers.clear();
      statusListeners.clear();
    }),
    send: vi.fn((_workspaceId: string, _message: unknown) => true),
    onMessage: vi.fn((workspaceId: string, handler: (msg: WsOutgoing) => void) => {
      getSet(messageHandlers, workspaceId).add(handler);
      for (const msg of replayMessages.get(workspaceId) ?? []) {
        handler(msg);
      }
      return {
        unsubscribe: () => { getSet(messageHandlers, workspaceId).delete(handler); },
        hadBufferedMessages: false,
      };
    }),
    subscribe: (workspaceId: string, listener: () => void) => {
      getSet(statusListeners, workspaceId).add(listener);
      return () => {
        getSet(statusListeners, workspaceId).delete(listener);
      };
    },
    getStatus: (workspaceId: string) => statuses.get(workspaceId) ?? "disconnected",
  };

  const __wsMock = {
    emit: (workspaceId: string, msg: WsOutgoing) => {
      for (const handler of messageHandlers.get(workspaceId) ?? []) handler(msg);
    },
    reset: () => {
      statuses.clear();
      messageHandlers.clear();
      statusListeners.clear();
      replayMessages.clear();
      wsTransport.connect.mockClear();
      wsTransport.disconnect.mockClear();
      wsTransport.syncWorkspaces.mockClear();
      wsTransport.disconnectAll.mockClear();
      wsTransport.send.mockClear();
      wsTransport.onMessage.mockClear();
    },
    setReplay: (workspaceId: string, messages: WsOutgoing[]) => {
      replayMessages.set(workspaceId, messages);
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
      emit: (workspaceId: string, msg: WsOutgoing) => void;
      reset: () => void;
      setReplay: (workspaceId: string, messages: WsOutgoing[]) => void;
      sendMock: ReturnType<typeof vi.fn>;
      connectMock: ReturnType<typeof vi.fn>;
      disconnectMock: ReturnType<typeof vi.fn>;
    };
  };

const getApiMock = async () =>
  (await import("@/hooks/useApi")) as unknown as {
    __apiMock: {
      getMock: ReturnType<typeof vi.fn>;
      reset: () => void;
    };
  };

describe("useConversation", () => {
  beforeEach(async () => {
    const { __wsMock } = await getWsMock();
    const { __apiMock } = await getApiMock();
    __wsMock.reset();
    __apiMock.reset();
  });

  it("connects on mount and keeps connection alive on unmount", async () => {
    const { __wsMock } = await getWsMock();
    const { unmount } = renderHook(() => useConversation("ws-1"));

    expect(__wsMock.connectMock).toHaveBeenCalledWith("ws-1");

    unmount();

    expect(__wsMock.disconnectMock).not.toHaveBeenCalled();
  });

  it("sends user messages through transport without optimistic local append", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useConversation("ws-1"));

    act(() => {
      result.current.sendMessage("hello");
    });

    expect(result.current.messages).toHaveLength(0);
    expect(__wsMock.sendMock).toHaveBeenCalledWith("ws-1", {
      type: "user_message",
      content: "hello",
    });
  });

  it("forwards per-message options through transport", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useConversation("ws-1"));

    act(() => {
      result.current.sendMessage("hello", { planMode: true, thinkingEnabled: false });
    });

    expect(__wsMock.sendMock).toHaveBeenCalledWith("ws-1", {
      type: "user_message",
      content: "hello",
      options: { planMode: true, thinkingEnabled: false },
    });
  });

  it("appends user message when backend emits user_message event", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useConversation("ws-1"));

    act(() => {
      __wsMock.emit("ws-1", {
        type: "user_message",
        message: {
          id: "u1",
          sessionId: "sess-1",
          role: "user",
          content: "hello",
          timestamp: "2026-02-12T00:00:00.000Z",
        },
      });
    });

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]?.role).toBe("user");
    expect(result.current.messages[0]?.content).toBe("hello");
    expect(result.current.isStreaming).toBe(true);
    expect(result.current.sessionId).toBe("sess-1");
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
      __wsMock.emit("ws-1", {
        type: "user_message",
        message: {
          id: "u1",
          sessionId: "sess-1",
          role: "user",
          content: "start",
          timestamp: "2026-02-12T00:00:00.000Z",
        },
      });
    });

    act(() => {
      __wsMock.emit("ws-1", { type: "text_delta", text: "Hi " });
      __wsMock.emit("ws-1", { type: "text_delta", text: "there" });
      __wsMock.emit("ws-1", { type: "done", sessionId: "sess-1" });
    });

    expect(result.current.isStreaming).toBe(false);
    expect(result.current.messages[0]?.role).toBe("user");
    expect(result.current.messages.at(-1)?.role).toBe("assistant");
    expect(result.current.messages.at(-1)?.content).toBe("Hi there");
    expect(result.current.sessionId).toBe("sess-1");
  });

  it("marks assistant output as cancelled when cancelled event is received", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useConversation("ws-1"));

    act(() => {
      result.current.sendMessage("start");
      __wsMock.emit("ws-1", {
        type: "user_message",
        message: {
          id: "u1",
          sessionId: "sess-1",
          role: "user",
          content: "start",
          timestamp: "2026-02-12T00:00:00.000Z",
        },
      });
    });

    act(() => {
      __wsMock.emit("ws-1", { type: "text_delta", text: "partial" });
      __wsMock.emit("ws-1", { type: "cancelled" });
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

    expect(__wsMock.sendMock).toHaveBeenLastCalledWith("ws-1", {
      type: "tool_input_response",
      requestId: "tool-1",
      toolName: "AskUserQuestion",
      result: {
        type: "answer",
        answers: [
          { questionIndex: 0, selectedOptions: [1, 2] },
          { questionIndex: 1, selectedOptions: [], customText: "custom" },
        ],
      },
    });
  });

  it("sends approval shortcut message", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useConversation("ws-1"));

    act(() => {
      result.current.approvePlan();
    });

    expect(__wsMock.sendMock).toHaveBeenLastCalledWith("ws-1", {
      type: "tool_input_response",
      requestId: "",
      toolName: "ExitPlanMode",
      result: { type: "approve" },
    });
  });

  it("hydrates persisted history after mount even when websocket replays stale history", async () => {
    const { __wsMock } = await getWsMock();
    const { __apiMock } = await getApiMock();

    __wsMock.setReplay("ws-1", [{
      type: "history",
      messages: [
        {
          id: "a1",
          sessionId: "sess-1",
          role: "assistant",
          content: "stale-only-assistant",
          timestamp: "2026-02-12T00:00:00.000Z",
        },
      ],
    }]);

    __apiMock.getMock.mockResolvedValueOnce([
      {
        id: "u1",
        sessionId: "sess-1",
        role: "user",
        content: "hello",
        timestamp: "2026-02-12T00:00:00.000Z",
      },
      {
        id: "a1",
        sessionId: "sess-1",
        role: "assistant",
        content: "world",
        timestamp: "2026-02-12T00:00:01.000Z",
      },
    ]);

    const { result } = renderHook(() => useConversation("ws-1"));

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(2);
    });
    expect(result.current.messages[0]?.role).toBe("user");
    expect(result.current.messages[0]?.content).toBe("hello");
    expect(result.current.messages[1]?.role).toBe("assistant");
    expect(result.current.messages[1]?.content).toBe("world");
  });

  it("does not overwrite backend user message with a late history request", async () => {
    const { __wsMock } = await getWsMock();
    const { __apiMock } = await getApiMock();
    let resolveHistory: ((messages: ChatMessage[]) => void) | undefined;
    __apiMock.getMock.mockReturnValueOnce(
      new Promise<ChatMessage[]>((resolve) => {
        resolveHistory = resolve;
      }),
    );

    const { result } = renderHook(() => useConversation("ws-1"));

    act(() => {
      result.current.sendMessage("hello");
      __wsMock.emit("ws-1", {
        type: "user_message",
        message: {
          id: "u1",
          sessionId: "sess-1",
          role: "user",
          content: "hello",
          timestamp: "2026-02-12T00:00:00.000Z",
        },
      });
    });
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]?.role).toBe("user");

    act(() => {
      resolveHistory?.([]);
    });

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(1);
    });
    expect(result.current.messages[0]?.content).toBe("hello");
  });

  it("hydrates sessionId from initial history payload", async () => {
    const { __apiMock } = await getApiMock();
    __apiMock.getMock.mockResolvedValueOnce([
      {
        id: "u1",
        sessionId: "sess-hydrated",
        role: "user",
        content: "hello",
        timestamp: "2026-02-12T00:00:00.000Z",
      },
    ]);

    const { result } = renderHook(() => useConversation("ws-1"));

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(1);
    });
    expect(result.current.sessionId).toBe("sess-hydrated");
  });

  it("switches sessions and loads specific session history", async () => {
    const { __apiMock } = await getApiMock();
    __apiMock.getMock.mockResolvedValueOnce([]);
    __apiMock.getMock.mockResolvedValueOnce([
      {
        id: "m-1",
        sessionId: "sess-2",
        role: "assistant",
        content: "loaded from target session",
        timestamp: "2026-02-12T00:00:01.000Z",
      },
    ]);

    const { result } = renderHook(() => useConversation("ws-1"));

    await act(async () => {
      await result.current.switchSession("sess-2");
    });

    expect(__apiMock.getMock).toHaveBeenNthCalledWith(2, "/api/workspaces/ws-1/sessions/sess-2/messages");
    expect(result.current.messages).toEqual([
      expect.objectContaining({ id: "m-1", content: "loaded from target session" }),
    ]);
    expect(result.current.sessionId).toBe("sess-2");
    expect(result.current.isStreaming).toBe(false);
  });

  it("keeps selected session id when switched session has no messages", async () => {
    const { __apiMock } = await getApiMock();
    __apiMock.getMock.mockResolvedValueOnce([]);
    __apiMock.getMock.mockResolvedValueOnce([]);

    const { result } = renderHook(() => useConversation("ws-1"));

    await act(async () => {
      await result.current.switchSession("sess-empty");
    });

    expect(result.current.messages).toEqual([]);
    expect(result.current.sessionId).toBe("sess-empty");
  });

  it("ignores stale session history response when switching rapidly", async () => {
    const { __apiMock } = await getApiMock();
    let resolveFirstSwitch: ((messages: ChatMessage[]) => void) | undefined;

    __apiMock.getMock
      .mockResolvedValueOnce([])
      .mockImplementationOnce(
        () =>
          new Promise<ChatMessage[]>((resolve) => {
            resolveFirstSwitch = resolve;
          }),
      )
      .mockResolvedValueOnce([
        {
          id: "m-new",
          sessionId: "sess-new",
          role: "assistant",
          content: "new session payload",
          timestamp: "2026-02-12T00:00:02.000Z",
        },
      ]);

    const { result } = renderHook(() => useConversation("ws-1"));

    act(() => {
      void result.current.switchSession("sess-old");
    });

    await act(async () => {
      await result.current.switchSession("sess-new");
    });

    act(() => {
      resolveFirstSwitch?.([
        {
          id: "m-old",
          sessionId: "sess-old",
          role: "assistant",
          content: "stale payload",
          timestamp: "2026-02-12T00:00:03.000Z",
        },
      ]);
    });

    await waitFor(() => {
      expect(result.current.sessionId).toBe("sess-new");
    });
    expect(result.current.messages).toEqual([
      expect.objectContaining({ id: "m-new", content: "new session payload" }),
    ]);
  });

  it("does nothing when switchSession is called without workspace id", async () => {
    const { __apiMock } = await getApiMock();
    const { result } = renderHook(() => useConversation(undefined));

    await act(async () => {
      await result.current.switchSession("sess-1");
    });

    expect(__apiMock.getMock).not.toHaveBeenCalled();
    expect(result.current.sessionId).toBeUndefined();
  });
});
