import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useConversation, _resetSavedSessions } from "@/hooks/useConversation";
import type { ChatMessage, SessionMessagesResponse, WsOutgoing } from "@/types";

/** Convenience: wrap a bare message array in the `{messages, hasMore}` REST shape. */
function historyResponse(messages: ChatMessage[], hasMore = false): SessionMessagesResponse {
  return { messages, hasMore };
}

vi.mock("@/hooks/useApi", () => {
  const getMock = vi.fn(
    () =>
      new Promise<SessionMessagesResponse>(() => {
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
            new Promise<SessionMessagesResponse>(() => {
              // Keep pending by default to avoid unintentional state updates in tests.
            }),
        );
      },
    },
  };
});

vi.mock("@/lib/ws-transport", () => {
  type ConnectionStatus = "connecting" | "connected" | "disconnected";
  interface SessionWindow { messages: ChatMessage[]; hasMore: boolean }
  const statuses = new Map<string, ConnectionStatus>();
  const messageHandlers = new Map<string, Set<(msg: WsOutgoing) => void>>();
  const statusListeners = new Map<string, Set<() => void>>();
  const reconnectListeners = new Map<string, Set<() => void>>();
  const replayMessages = new Map<string, WsOutgoing[]>();
  const bufferedFlags = new Map<string, boolean>();
  const windows = new Map<string, Map<string, SessionWindow>>();

  const getSet = <T,>(source: Map<string, Set<T>>, workspaceId: string) => {
    const existing = source.get(workspaceId);
    if (existing) return existing;
    const created = new Set<T>();
    source.set(workspaceId, created);
    return created;
  };

  const windowMap = (workspaceId: string) => {
    const existing = windows.get(workspaceId);
    if (existing) return existing;
    const created = new Map<string, SessionWindow>();
    windows.set(workspaceId, created);
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
        hadBufferedMessages: bufferedFlags.get(workspaceId) ?? false,
      };
    }),
    onReconnect: vi.fn((workspaceId: string, callback: () => void) => {
      getSet(reconnectListeners, workspaceId).add(callback);
      return () => { getSet(reconnectListeners, workspaceId).delete(callback); };
    }),
    subscribe: (workspaceId: string, listener: () => void) => {
      getSet(statusListeners, workspaceId).add(listener);
      return () => {
        getSet(statusListeners, workspaceId).delete(listener);
      };
    },
    getStatus: (workspaceId: string) => statuses.get(workspaceId) ?? "disconnected",
    setSessionWindow: vi.fn((workspaceId: string, sessionId: string, window: SessionWindow) => {
      windowMap(workspaceId).set(sessionId, window);
    }),
    getSessionWindow: vi.fn((workspaceId: string, sessionId: string) =>
      windowMap(workspaceId).get(sessionId),
    ),
    clearCachedData: vi.fn((workspaceId: string) => {
      windows.delete(workspaceId);
      replayMessages.delete(workspaceId);
      bufferedFlags.delete(workspaceId);
    }),
  };

  const __wsMock = {
    emit: (workspaceId: string, msg: WsOutgoing) => {
      for (const handler of messageHandlers.get(workspaceId) ?? []) handler(msg);
    },
    triggerReconnect: (workspaceId: string) => {
      for (const cb of reconnectListeners.get(workspaceId) ?? []) cb();
    },
    reset: () => {
      statuses.clear();
      messageHandlers.clear();
      statusListeners.clear();
      reconnectListeners.clear();
      replayMessages.clear();
      bufferedFlags.clear();
      windows.clear();
      wsTransport.connect.mockClear();
      wsTransport.disconnect.mockClear();
      wsTransport.syncWorkspaces.mockClear();
      wsTransport.disconnectAll.mockClear();
      // Reset (not just clear) so a per-test mockImplementation/mockReturnValueOnce
      // override can't leak into the next test, then restore the default.
      wsTransport.send.mockReset();
      wsTransport.send.mockImplementation((_workspaceId: string, _message: unknown) => true);
      wsTransport.onMessage.mockClear();
      wsTransport.setSessionWindow.mockClear();
      wsTransport.getSessionWindow.mockClear();
      wsTransport.clearCachedData.mockClear();
    },
    setReplay: (workspaceId: string, messages: WsOutgoing[]) => {
      replayMessages.set(workspaceId, messages);
    },
    setBuffered: (workspaceId: string, value: boolean) => {
      bufferedFlags.set(workspaceId, value);
    },
    sendMock: wsTransport.send,
    connectMock: wsTransport.connect,
    disconnectMock: wsTransport.disconnect,
    setSessionWindowMock: wsTransport.setSessionWindow,
    getSessionWindowMock: wsTransport.getSessionWindow,
    setSessionWindow: (workspaceId: string, sessionId: string, window: SessionWindow) => {
      windowMap(workspaceId).set(sessionId, window);
    },
  };

  return { wsTransport, __wsMock };
});

interface SessionWindowShape { messages: ChatMessage[]; hasMore: boolean }

const getWsMock = async () =>
  (await import("@/lib/ws-transport")) as unknown as {
    __wsMock: {
      emit: (workspaceId: string, msg: WsOutgoing) => void;
      triggerReconnect: (workspaceId: string) => void;
      reset: () => void;
      setReplay: (workspaceId: string, messages: WsOutgoing[]) => void;
      setBuffered: (workspaceId: string, value: boolean) => void;
      sendMock: ReturnType<typeof vi.fn>;
      connectMock: ReturnType<typeof vi.fn>;
      disconnectMock: ReturnType<typeof vi.fn>;
      setSessionWindowMock: ReturnType<typeof vi.fn>;
      getSessionWindowMock: ReturnType<typeof vi.fn>;
      setSessionWindow: (workspaceId: string, sessionId: string, window: SessionWindowShape) => void;
    };
  };

const getApiMock = async () =>
  (await import("@/hooks/useApi")) as unknown as {
    __apiMock: {
      getMock: ReturnType<typeof vi.fn>;
      reset: () => void;
    };
  };

/**
 * Streaming deltas (text_delta/thinking) are coalesced on a ~50ms tick. Tests
 * that emit deltas and then assert the streaming view directly must flush that
 * tick. Emitting any non-delta event also flushes pending deltas synchronously,
 * so tests that follow deltas with done/tool_use don't need this.
 */
async function flushStreamDeltas() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
}

describe("useConversation", () => {
  beforeEach(async () => {
    const { __wsMock } = await getWsMock();
    const { __apiMock } = await getApiMock();
    __wsMock.reset();
    __apiMock.reset();
    _resetSavedSessions();
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
      result.current.sendMessage("hello", undefined, { planMode: true, thinkingLevel: "low" });
    });

    expect(__wsMock.sendMock).toHaveBeenCalledWith("ws-1", {
      type: "user_message",
      content: "hello",
      options: { planMode: true, thinkingLevel: "low" },
    });
  });

  it("can target an explicit session id when sending a message", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useConversation("ws-1"));

    act(() => {
      result.current.sendMessage("run in target", undefined, undefined, "sess-target");
    });

    expect(__wsMock.sendMock).toHaveBeenCalledWith("ws-1", {
      type: "user_message",
      content: "run in target",
      sessionId: "sess-target",
    });
  });

  it("appends user message when backend emits user_message event", async () => {
    const { __wsMock } = await getWsMock();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_001_111);
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
    expect(result.current.streamingStartedAt).toBe(1_700_000_001_111);
    nowSpy.mockRestore();
  });

  it("does not change active session when user_message arrives for another session", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useConversation("ws-1"));

    act(() => {
      __wsMock.emit("ws-1", {
        type: "user_message",
        message: {
          id: "u1",
          sessionId: "sess-1",
          role: "user",
          content: "active",
          timestamp: "2026-02-12T00:00:00.000Z",
        },
      });
      __wsMock.emit("ws-1", {
        type: "user_message",
        message: {
          id: "u2",
          sessionId: "sess-2",
          role: "user",
          content: "background",
          timestamp: "2026-02-12T00:00:01.000Z",
        },
      });
    });

    expect(result.current.sessionId).toBe("sess-1");
    expect(result.current.messages).toEqual([
      expect.objectContaining({ id: "u1", sessionId: "sess-1", content: "active" }),
    ]);
  });

  it("does not add user message when transport send fails", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useConversation("ws-1"));
    // The mount-time focus pull also calls send(); fail only the user_message so
    // the assertion targets the message send regardless of call ordering.
    __wsMock.sendMock.mockImplementation(
      (_ws: string, msg: { type: string }) => msg.type !== "user_message",
    );

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
      __wsMock.emit("ws-1", { type: "done", sessionId: "sess-1", messageId: "msg-sess-1" });
    });

    expect(result.current.isStreaming).toBe(false);
    expect(result.current.messages[0]?.role).toBe("user");
    expect(result.current.messages.at(-1)?.role).toBe("assistant");
    expect(result.current.messages.at(-1)?.content).toBe("Hi there");
    expect(result.current.sessionId).toBe("sess-1");
    expect(result.current.streamingStartedAt).toBeNull();
  });

  it("resyncs persisted session history on done to recover missed deltas", async () => {
    const { __wsMock } = await getWsMock();
    const { __apiMock } = await getApiMock();
    __apiMock.getMock.mockResolvedValueOnce(historyResponse([]));
    __apiMock.getMock.mockResolvedValueOnce(historyResponse([
      {
        id: "u1",
        sessionId: "sess-1",
        role: "user",
        content: "start",
        timestamp: "2026-02-12T00:00:00.000Z",
      },
      {
        id: "a1",
        sessionId: "sess-1",
        role: "assistant",
        content: "final answer from persistence",
        timestamp: "2026-02-12T00:00:01.000Z",
      },
    ]));

    const { result } = renderHook(() => useConversation("ws-1"));

    act(() => {
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
      // No text_delta received (simulates session unfocused while streaming).
      __wsMock.emit("ws-1", { type: "done", sessionId: "sess-1", messageId: "msg-sess-1" });
    });

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(2);
      expect(result.current.messages.at(-1)?.content).toBe("final answer from persistence");
    });
    expect(__apiMock.getMock).toHaveBeenNthCalledWith(2, "/api/workspaces/ws-1/sessions/sess-1/messages?limit=200");
  });

  it("preserves parentToolUseId from tool_use events in active and persisted tool calls", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useConversation("ws-1"));

    act(() => {
      __wsMock.emit("ws-1", {
        type: "user_message",
        message: {
          id: "u1",
          sessionId: "sess-1",
          role: "user",
          content: "run nested task",
          timestamp: "2026-02-12T00:00:00.000Z",
        },
      });
      __wsMock.emit("ws-1", {
        type: "tool_use",
        id: "task-1",
        name: "Task",
        input: JSON.stringify({ prompt: "root" }),
      });
      __wsMock.emit("ws-1", {
        type: "tool_use",
        id: "read-1",
        name: "Read",
        input: JSON.stringify({ file_path: "/tmp/a.ts" }),
        parentToolUseId: "task-1",
      });
    });

    expect(result.current.activeToolCalls).toEqual([
      expect.objectContaining({ id: "task-1", parentToolUseId: undefined }),
      expect.objectContaining({ id: "read-1", parentToolUseId: "task-1" }),
    ]);

    act(() => {
      __wsMock.emit("ws-1", { type: "done", sessionId: "sess-1", messageId: "msg-sess-1" });
    });

    const assistant = result.current.messages.at(-1);
    expect(assistant?.toolCalls).toEqual([
      expect.objectContaining({ id: "task-1", parentToolUseId: undefined }),
      expect.objectContaining({ id: "read-1", parentToolUseId: "task-1" }),
    ]);
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
    expect(result.current.streamingStartedAt).toBeNull();
  });

  it("clears local chat state", async () => {
    const { __wsMock } = await getWsMock();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_001_222);
    const { result } = renderHook(() => useConversation("ws-1"));

    act(() => {
      __wsMock.emit("ws-1", {
        type: "user_message",
        message: {
          id: "u-clear",
          sessionId: "sess-clear",
          role: "user",
          content: "hello",
          timestamp: "2026-02-12T00:00:00.000Z",
        },
      });
    });
    expect(result.current.streamingStartedAt).toBe(1_700_000_001_222);

    act(() => {
      result.current.clearChat();
    });

    expect(result.current.messages).toEqual([]);
    expect(result.current.sessionId).toBeUndefined();
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.streamingStartedAt).toBeNull();
    nowSpy.mockRestore();
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

  it("uses pending requestId when answering AskUserQuestion and clears pending state", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useConversation("ws-1"));

    act(() => {
      __wsMock.emit("ws-1", { type: "status", status: "busy", sessionId: "sess-1", streaming: true });
      __wsMock.emit("ws-1", {
        type: "tool_input_required",
        sessionId: "sess-1",
        requestId: "req-123",
        toolName: "AskUserQuestion",
        toolUseId: "tool-1",
        input: { questions: [{ question: "Q1", options: [{ label: "A" }] }] },
      });
    });
    expect(result.current.pendingToolInputs).toHaveLength(1);

    act(() => {
      result.current.answerQuestion("tool-1", [{ questionIndex: 0, selectedOptions: [0] }]);
    });

    expect(__wsMock.sendMock).toHaveBeenLastCalledWith("ws-1", {
      type: "tool_input_response",
      requestId: "req-123",
      toolName: "AskUserQuestion",
      result: {
        type: "answer",
        answers: [{ questionIndex: 0, selectedOptions: [0] }],
      },
      sessionId: "sess-1",
    });
    expect(result.current.pendingToolInputs).toEqual([]);
  });

  it("batchAnswerQuestions sends one response per tool with original questions and clears pending", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useConversation("ws-1"));
    // Drop the mount-time focus pull so the two responses are calls 1 and 2.
    __wsMock.sendMock.mockClear();

    act(() => {
      __wsMock.emit("ws-1", { type: "status", status: "busy", sessionId: "sess-1", streaming: true });
      __wsMock.emit("ws-1", {
        type: "tool_input_required",
        sessionId: "sess-1",
        requestId: "req-1",
        toolName: "AskUserQuestion",
        toolUseId: "tool-1",
        input: {
          questions: [
            { question: "Pick color", options: [{ label: "Red" }, { label: "Blue" }] },
          ],
        },
      });
      __wsMock.emit("ws-1", {
        type: "tool_input_required",
        sessionId: "sess-1",
        requestId: "req-2",
        toolName: "AskUserQuestion",
        toolUseId: "tool-2",
        input: {
          questions: [
            { question: "Add note", options: [] },
          ],
        },
      });
    });

    act(() => {
      result.current.batchAnswerQuestions([
        { toolUseId: "tool-1", answers: [{ questionIndex: 0, selectedOptions: [1] }] },
        { toolUseId: "tool-2", answers: [{ questionIndex: 0, selectedOptions: [], customText: "detail" }] },
      ]);
    });

    expect(__wsMock.sendMock).toHaveBeenNthCalledWith(1, "ws-1", {
      type: "tool_input_response",
      requestId: "req-1",
      toolName: "AskUserQuestion",
      result: {
        type: "answer",
        answers: [{ questionIndex: 0, selectedOptions: [1] }],
        questions: [{ question: "Pick color", options: [{ label: "Red" }, { label: "Blue" }] }],
      },
      sessionId: "sess-1",
    });
    expect(__wsMock.sendMock).toHaveBeenNthCalledWith(2, "ws-1", {
      type: "tool_input_response",
      requestId: "req-2",
      toolName: "AskUserQuestion",
      result: {
        type: "answer",
        answers: [{ questionIndex: 0, selectedOptions: [], customText: "detail" }],
        questions: [{ question: "Add note", options: [] }],
      },
      sessionId: "sess-1",
    });
    expect(result.current.pendingToolInputs).toEqual([]);
  });

  it("clears pending tool inputs on tool_input_resolved (dismissed on another client)", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useConversation("ws-1"));
    // Ignore the mount-time focus pull; this asserts no response is sent.
    __wsMock.sendMock.mockClear();

    act(() => {
      __wsMock.emit("ws-1", { type: "status", status: "idle", sessionId: "sess-1" });
      __wsMock.emit("ws-1", {
        type: "tool_input_required",
        sessionId: "sess-1",
        requestId: "req-1",
        toolName: "AskUserQuestion",
        toolUseId: "tool-1",
        input: { questions: [{ question: "Q1", options: [{ label: "A" }] }] },
      });
    });
    expect(result.current.pendingToolInputs).toHaveLength(1);

    act(() => {
      __wsMock.emit("ws-1", { type: "tool_input_resolved", sessionId: "sess-1" });
    });

    expect(result.current.pendingToolInputs).toEqual([]);
    expect(__wsMock.sendMock).not.toHaveBeenCalled();
  });

  it("clears pending tool inputs when the session resumes streaming (answered on another client)", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useConversation("ws-1"));
    // Ignore the mount-time focus pull; this asserts no response is sent.
    __wsMock.sendMock.mockClear();

    act(() => {
      __wsMock.emit("ws-1", { type: "status", status: "idle", sessionId: "sess-1" });
      __wsMock.emit("ws-1", {
        type: "tool_input_required",
        sessionId: "sess-1",
        requestId: "req-1",
        toolName: "AskUserQuestion",
        toolUseId: "tool-1",
        input: { questions: [{ question: "Q1", options: [{ label: "A" }] }] },
      });
    });
    expect(result.current.pendingToolInputs).toHaveLength(1);

    act(() => {
      __wsMock.emit("ws-1", { type: "status", status: "busy", sessionId: "sess-1", streaming: true });
    });

    expect(result.current.pendingToolInputs).toEqual([]);
    expect(__wsMock.sendMock).not.toHaveBeenCalled();
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

  it("tracks agentPlanMode from plan_mode_changed events for the active session", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useConversation("ws-1"));

    act(() => {
      __wsMock.emit("ws-1", {
        type: "status",
        status: "busy",
        sessionId: "sess-active",
        streaming: true,
      });
      __wsMock.emit("ws-1", {
        type: "plan_mode_changed",
        sessionId: "sess-active",
        active: true,
      });
    });

    expect(result.current.agentPlanMode).toBe(true);

    act(() => {
      __wsMock.emit("ws-1", {
        type: "plan_mode_changed",
        sessionId: "sess-active",
        active: false,
      });
    });

    expect(result.current.agentPlanMode).toBe(false);
  });

  it("does not change active agentPlanMode when plan_mode_changed is for another session", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useConversation("ws-1"));

    act(() => {
      __wsMock.emit("ws-1", {
        type: "status",
        status: "busy",
        sessionId: "sess-active",
        streaming: true,
      });
      __wsMock.emit("ws-1", {
        type: "plan_mode_changed",
        sessionId: "sess-active",
        active: true,
      });
      __wsMock.emit("ws-1", {
        type: "plan_mode_changed",
        sessionId: "sess-other",
        active: false,
      });
    });

    expect(result.current.agentPlanMode).toBe(true);
  });

  it("tracks live agent activities and persists them into the assistant message on done", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useConversation("ws-1"));

    act(() => {
      __wsMock.emit("ws-1", {
        type: "user_message",
        message: {
          id: "u1",
          sessionId: "sess-activity",
          role: "user",
          content: "run tests",
          timestamp: "2026-02-12T00:00:00.000Z",
        },
      });
      __wsMock.emit("ws-1", {
        type: "agent_activity",
        sessionId: "sess-activity",
        activity: {
          id: "cmd-1",
          kind: "command_execution",
          command: "npm test",
          status: "inProgress",
          output: "running\n",
        },
      });
      __wsMock.emit("ws-1", {
        type: "agent_activity",
        sessionId: "sess-activity",
        activity: {
          id: "cmd-1",
          kind: "command_execution",
          command: "npm test",
          status: "completed",
          output: "running\nok\n",
          exitCode: 0,
        },
      });
    });

    expect(result.current.activeAgentActivities).toEqual([
      {
        id: "cmd-1",
        kind: "command_execution",
        command: "npm test",
        status: "completed",
        output: "running\nok\n",
        exitCode: 0,
      },
    ]);

    act(() => {
      __wsMock.emit("ws-1", {
        type: "done",
        sessionId: "sess-activity", messageId: "msg-sess-activity",
      });
    });

    expect(result.current.messages.at(-1)).toMatchObject({
      role: "assistant",
      agentActivities: [
        {
          id: "cmd-1",
          kind: "command_execution",
          output: "running\nok\n",
        },
      ],
    });
    expect(result.current.activeAgentActivities).toEqual([]);
  });

  it("keeps persisted agent activities from history", async () => {
    const { __apiMock } = await getApiMock();
    __apiMock.getMock.mockResolvedValueOnce(historyResponse([
      {
        id: "a1",
        sessionId: "sess-history-activity",
        role: "assistant",
        content: "",
        timestamp: "2026-02-12T00:00:00.000Z",
        agentActivities: [
          {
            id: "plan-1",
            kind: "plan_update",
            steps: [{ text: "Inspect", status: "completed" }],
          },
        ],
      },
    ]));

    const { result } = renderHook(() => useConversation("ws-1"));

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(1);
    });
    expect(result.current.messages[0]?.agentActivities).toEqual([
      {
        id: "plan-1",
        kind: "plan_update",
        steps: [{ text: "Inspect", status: "completed" }],
      },
    ]);
  });

  it("clears local agentPlanMode after approvePlan", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useConversation("ws-1"));

    act(() => {
      __wsMock.emit("ws-1", {
        type: "status",
        status: "busy",
        sessionId: "sess-approve",
        streaming: true,
      });
      __wsMock.emit("ws-1", {
        type: "plan_mode_changed",
        sessionId: "sess-approve",
        active: true,
      });
      __wsMock.emit("ws-1", {
        type: "tool_input_required",
        sessionId: "sess-approve",
        requestId: "req-approve",
        toolName: "ExitPlanMode",
        toolUseId: "tool-approve",
        input: {},
      });
    });

    expect(result.current.agentPlanMode).toBe(true);

    act(() => {
      result.current.approvePlan();
    });

    expect(result.current.agentPlanMode).toBe(false);
    expect(__wsMock.sendMock).toHaveBeenLastCalledWith("ws-1", {
      type: "tool_input_response",
      requestId: "req-approve",
      toolName: "ExitPlanMode",
      result: { type: "approve" },
      sessionId: "sess-approve",
    });
  });

  it("includes current sessionId in tool input responses when available", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useConversation("ws-1"));

    act(() => {
      __wsMock.emit("ws-1", {
        type: "status",
        status: "busy",
        sessionId: "sess-42",
        streaming: false,
      });
      __wsMock.emit("ws-1", {
        type: "tool_input_required",
        requestId: "req-42",
        toolName: "ExitPlanMode",
        toolUseId: "tool-42",
        input: {},
      });
    });

    act(() => {
      result.current.approvePlan();
    });

    expect(__wsMock.sendMock).toHaveBeenLastCalledWith("ws-1", {
      type: "tool_input_response",
      requestId: "req-42",
      toolName: "ExitPlanMode",
      result: { type: "approve" },
      sessionId: "sess-42",
    });
  });

  it("hydrates persisted history from REST on mount (single source of truth)", async () => {
    const { __apiMock } = await getApiMock();

    __apiMock.getMock.mockResolvedValueOnce(historyResponse([
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
    ]));

    const { result } = renderHook(() => useConversation("ws-1"));

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(2);
    });
    expect(result.current.messages[0]?.role).toBe("user");
    expect(result.current.messages[0]?.content).toBe("hello");
    expect(result.current.messages[1]?.role).toBe("assistant");
    expect(result.current.messages[1]?.content).toBe("world");
  });

  it("loads history from the active-session REST endpoint on first visit", async () => {
    const { __apiMock } = await getApiMock();

    __apiMock.getMock.mockResolvedValueOnce(historyResponse([
      {
        id: "m-disk",
        sessionId: "sess-fresh",
        role: "assistant",
        content: "from disk",
        timestamp: "2026-02-12T00:00:00.000Z",
      },
    ]));

    const { result } = renderHook(() => useConversation("ws-1"));

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(1);
    });
    expect(result.current.messages[0]?.content).toBe("from disk");

    await waitFor(() => {
      expect(__apiMock.getMock).toHaveBeenCalledWith("/api/workspaces/ws-1/session/messages?limit=200");
    });
    expect(result.current.messages[0]?.content).toBe("from disk");
  });

  it("does not overwrite backend user message with a late history request", async () => {
    const { __wsMock } = await getWsMock();
    const { __apiMock } = await getApiMock();
    let resolveHistory: ((res: SessionMessagesResponse) => void) | undefined;
    __apiMock.getMock.mockReturnValueOnce(
      new Promise<SessionMessagesResponse>((resolve) => {
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
      resolveHistory?.(historyResponse([]));
    });

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(1);
    });
    expect(result.current.messages[0]?.content).toBe("hello");
  });

  it("hydrates sessionId from initial history payload", async () => {
    const { __apiMock } = await getApiMock();
    __apiMock.getMock.mockResolvedValueOnce(historyResponse([
      {
        id: "u1",
        sessionId: "sess-hydrated",
        role: "user",
        content: "hello",
        timestamp: "2026-02-12T00:00:00.000Z",
      },
    ]));

    const { result } = renderHook(() => useConversation("ws-1"));

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(1);
    });
    expect(result.current.sessionId).toBe("sess-hydrated");
  });

  it("rehydrates AskUserQuestion pending input from history when WS request event was missed", async () => {
    const { __apiMock } = await getApiMock();
    __apiMock.getMock.mockResolvedValueOnce(historyResponse([
      {
        id: "u1",
        sessionId: "sess-q",
        role: "user",
        content: "ask me",
        timestamp: "2026-02-12T00:00:00.000Z",
      },
      {
        id: "a1",
        sessionId: "sess-q",
        role: "assistant",
        content: "",
        timestamp: "2026-02-12T00:00:01.000Z",
        toolCalls: [
          {
            id: "tool-q1",
            name: "AskUserQuestion",
            input: JSON.stringify({
              questions: [
                {
                  question: "Choisis un mode",
                  multiSelect: false,
                  options: [{ label: "A", description: "Option A" }],
                },
              ],
            }),
          },
        ],
      },
    ]));

    const { result } = renderHook(() => useConversation("ws-1"));

    await waitFor(() => {
      expect(result.current.pendingToolInputs).toHaveLength(1);
    });
    expect(result.current.pendingToolInputs[0]).toEqual(
      expect.objectContaining({
        requestId: "history-tool-q1",
        toolName: "AskUserQuestion",
        toolUseId: "tool-q1",
      }),
    );
  });

  it("falls back to empty object when history tool input is not valid JSON", async () => {
    const { __apiMock } = await getApiMock();
    __apiMock.getMock.mockResolvedValueOnce(historyResponse([
      {
        id: "u1",
        sessionId: "sess-q",
        role: "user",
        content: "ask me",
        timestamp: "2026-02-12T00:00:00.000Z",
      },
      {
        id: "a1",
        sessionId: "sess-q",
        role: "assistant",
        content: "",
        timestamp: "2026-02-12T00:00:01.000Z",
        toolCalls: [
          {
            id: "tool-q1",
            name: "AskUserQuestion",
            input: "{not-json",
          },
        ],
      },
    ]));

    const { result } = renderHook(() => useConversation("ws-1"));

    await waitFor(() => {
      expect(result.current.pendingToolInputs).toHaveLength(1);
    });
    expect(result.current.pendingToolInputs[0]?.input).toEqual({});
  });

  it("rehydrates ExitPlanMode pending input from history when WS request event was missed", async () => {
    const { __apiMock } = await getApiMock();
    __apiMock.getMock.mockResolvedValueOnce(historyResponse([
      {
        id: "u1",
        sessionId: "sess-plan",
        role: "user",
        content: "plan stp",
        timestamp: "2026-02-12T00:00:00.000Z",
      },
      {
        id: "a1",
        sessionId: "sess-plan",
        role: "assistant",
        content: "Voici un plan",
        timestamp: "2026-02-12T00:00:01.000Z",
        toolCalls: [
          {
            id: "tool-plan-1",
            name: "ExitPlanMode",
            input: JSON.stringify({ plan: "Step 1\nStep 2" }),
          },
        ],
      },
    ]));

    const { result } = renderHook(() => useConversation("ws-1"));

    await waitFor(() => {
      expect(result.current.pendingToolInputs).toHaveLength(1);
    });
    expect(result.current.pendingToolInputs[0]).toEqual(
      expect.objectContaining({
        requestId: "history-tool-plan-1",
        toolName: "ExitPlanMode",
        toolUseId: "tool-plan-1",
      }),
    );
  });

  it("clears stale pending tool inputs when the REST resync has no pending prompts", async () => {
    const { __wsMock } = await getWsMock();
    const { __apiMock } = await getApiMock();
    const { result } = renderHook(() => useConversation("ws-1"));

    act(() => {
      __wsMock.emit("ws-1", { type: "status", status: "busy", sessionId: "sess-1", streaming: true });
      __wsMock.emit("ws-1", {
        type: "tool_input_required",
        sessionId: "sess-1",
        requestId: "req-stale",
        toolName: "AskUserQuestion",
        toolUseId: "tool-stale",
        input: {},
      });
    });
    expect(result.current.pendingToolInputs).toHaveLength(1);

    // done triggers a REST resync; the loaded history has no pending prompts.
    __apiMock.getMock.mockResolvedValueOnce(historyResponse([
      {
        id: "u1",
        sessionId: "sess-1",
        role: "user",
        content: "done",
        timestamp: "2026-02-12T00:00:00.000Z",
      },
      {
        id: "a1",
        sessionId: "sess-1",
        role: "assistant",
        content: "completed",
        timestamp: "2026-02-12T00:00:01.000Z",
      },
    ]));

    await act(async () => {
      __wsMock.emit("ws-1", { type: "done", sessionId: "sess-1", messageId: "a1" });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.pendingToolInputs).toEqual([]);
    });
  });

  it("keeps live pending tool inputs across a stream_snapshot replay", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useConversation("ws-1"));

    act(() => {
      __wsMock.emit("ws-1", { type: "status", status: "busy", sessionId: "sess-1", streaming: true });
      __wsMock.emit("ws-1", {
        type: "tool_input_required",
        sessionId: "sess-1",
        requestId: "req-live",
        toolName: "AskUserQuestion",
        toolUseId: "tool-live",
        input: { questions: [{ question: "Live?" }] },
      });
    });
    expect(result.current.pendingToolInputs).toEqual([
      expect.objectContaining({
        requestId: "req-live",
        toolUseId: "tool-live",
      }),
    ]);

    // A consolidated catch-up snapshot replaces stream accumulators but must not
    // drop the in-flight pending question.
    act(() => {
      __wsMock.emit("ws-1", {
        type: "stream_snapshot",
        sessionId: "sess-1",
        text: "thinking about it",
        thinking: "",
        toolCalls: [],
        agentActivities: [],
        planMode: false,
        streamingStartedAt: 1_700_000_000_000,
      });
    });

    expect(result.current.currentStreamingText).toBe("thinking about it");
    expect(result.current.pendingToolInputs).toEqual([
      expect.objectContaining({
        requestId: "req-live",
        toolUseId: "tool-live",
      }),
    ]);
  });

  it("switches sessions and loads specific session history from REST", async () => {
    const { __apiMock } = await getApiMock();
    __apiMock.getMock.mockResolvedValue(historyResponse([
      {
        id: "m-1",
        sessionId: "sess-2",
        role: "assistant",
        content: "loaded from target session",
        timestamp: "2026-02-12T00:00:01.000Z",
      },
    ]));

    const { result } = renderHook(() => useConversation("ws-1"));

    await act(async () => {
      await result.current.switchSession("sess-2");
    });

    await waitFor(() => {
      expect(result.current.messages).toEqual([
        expect.objectContaining({ id: "m-1", content: "loaded from target session" }),
      ]);
    });
    expect(__apiMock.getMock).toHaveBeenCalledWith("/api/workspaces/ws-1/sessions/sess-2/messages?limit=200");
    expect(result.current.sessionId).toBe("sess-2");
    expect(result.current.isStreaming).toBe(false);
  });

  it("keeps target session visible and sets an error when switch_session send fails", async () => {
    const { __wsMock } = await getWsMock();
    // REST stays pending (default mock) so messages remain empty regardless.
    const { result } = renderHook(() => useConversation("ws-1"));
    // The mount-time focus pull also sends switch_session; fail only the explicit
    // switch to sess-fail so the assertion targets that call.
    __wsMock.sendMock.mockImplementation(
      (_ws: string, msg: { type: string; sessionId?: string }) =>
        !(msg.type === "switch_session" && msg.sessionId === "sess-fail"),
    );

    await act(async () => {
      await result.current.switchSession("sess-fail");
    });

    expect(__wsMock.sendMock).toHaveBeenCalledWith("ws-1", {
      type: "switch_session",
      sessionId: "sess-fail",
    });
    expect(result.current.messages).toEqual([]);
    expect(result.current.sessionId).toBe("sess-fail");
    expect(result.current.workspaceStatus).toBe("busy");
    expect(result.current.error).toBe("Session switch failed: disconnected from server.");
  });

  it("keeps selected session id when switched session has no messages", async () => {
    const { __apiMock } = await getApiMock();
    __apiMock.getMock.mockResolvedValueOnce(historyResponse([]));
    __apiMock.getMock.mockResolvedValueOnce(historyResponse([]));

    const { result } = renderHook(() => useConversation("ws-1"));

    await act(async () => {
      await result.current.switchSession("sess-empty");
    });

    expect(result.current.messages).toEqual([]);
    expect(result.current.sessionId).toBe("sess-empty");
  });

  it("ignores a stale session history response when switching rapidly", async () => {
    const { __apiMock } = await getApiMock();

    // Each switch fires a REST resync. Make sess-old's resolve late, sess-new's
    // resolve immediately; the stale sess-old payload must not clobber sess-new.
    let resolveOld: ((res: SessionMessagesResponse) => void) | undefined;
    __apiMock.getMock.mockImplementation((url: string) => {
      if (url.includes("sessions/sess-old/")) {
        return new Promise<SessionMessagesResponse>((resolve) => { resolveOld = resolve; });
      }
      if (url.includes("sessions/sess-new/")) {
        return Promise.resolve(historyResponse([
          {
            id: "m-new",
            sessionId: "sess-new",
            role: "assistant",
            content: "new session payload",
            timestamp: "2026-02-12T00:00:02.000Z",
          },
        ]));
      }
      return new Promise<SessionMessagesResponse>(() => {});
    });

    const { result } = renderHook(() => useConversation("ws-1"));

    act(() => {
      void result.current.switchSession("sess-old");
    });

    await act(async () => {
      await result.current.switchSession("sess-new");
    });

    // sess-new's response should have landed.
    await waitFor(() => {
      expect(result.current.messages).toEqual([
        expect.objectContaining({ id: "m-new", content: "new session payload" }),
      ]);
    });

    // The stale sess-old response arrives after we've moved to sess-new.
    await act(async () => {
      resolveOld?.(historyResponse([
        {
          id: "m-old",
          sessionId: "sess-old",
          role: "assistant",
          content: "stale payload",
          timestamp: "2026-02-12T00:00:03.000Z",
        },
      ]));
      await Promise.resolve();
    });

    // The stale payload must NOT clobber sess-new.
    expect(result.current.sessionId).toBe("sess-new");
    expect(result.current.messages).toEqual([
      expect.objectContaining({ id: "m-new", content: "new session payload" }),
    ]);
  });

  it("ignores unrecognized WS message types without corrupting state", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useConversation("ws-1"));

    act(() => {
      __wsMock.emit("ws-1", { type: "status", status: "busy", sessionId: "sess-x", streaming: true });
    });

    expect(result.current.workspaceStatus).toBe("busy");

    act(() => {
      __wsMock.emit("ws-1", {
        type: "branch_info",
        info: { name: "feat/new", lastSyncedAt: "2026-02-13T00:00:00.000Z" },
      } as any);
    });

    expect(result.current.workspaceStatus).toBe("busy");
    expect(result.current.isStreaming).toBe(true);
    expect(result.current.messages).toHaveLength(0);
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

  // ── Image attachment tests ──────────────────────────────────────────

  it("forwards images through transport in sendMessage", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useConversation("ws-1"));

    const images = [
      { name: "screenshot.png", mediaType: "image/png", dataUrl: "data:image/png;base64,abc" },
    ];

    act(() => {
      result.current.sendMessage("Look at this", images);
    });

    expect(__wsMock.sendMock).toHaveBeenCalledWith("ws-1", {
      type: "user_message",
      content: "Look at this",
      images,
    });
  });

  it("omits images field when images array is empty", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useConversation("ws-1"));

    act(() => {
      result.current.sendMessage("No images", []);
    });

    expect(__wsMock.sendMock).toHaveBeenCalledWith("ws-1", {
      type: "user_message",
      content: "No images",
    });
  });

  it("preserves images field from backend user_message event", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useConversation("ws-1"));

    const images = [
      { name: "test.png", mediaType: "image/png", dataUrl: "data:image/png;base64,xyz" },
    ];

    act(() => {
      __wsMock.emit("ws-1", {
        type: "user_message",
        message: {
          id: "u-img",
          sessionId: "sess-1",
          role: "user",
          content: "With image",
          images,
          timestamp: "2026-02-12T00:00:00.000Z",
        },
      });
    });

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]?.images).toEqual(images);
  });

  it("de-duplicates user_message events with images", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useConversation("ws-1"));

    const msg = {
      type: "user_message" as const,
      message: {
        id: "u-dup",
        sessionId: "sess-1",
        role: "user" as const,
        content: "Dup",
        images: [{ name: "x.png", mediaType: "image/png", dataUrl: "data:image/png;base64,a" }],
        timestamp: "2026-02-12T00:00:00.000Z",
      },
    };

    act(() => {
      __wsMock.emit("ws-1", msg);
      __wsMock.emit("ws-1", msg);
    });

    expect(result.current.messages).toHaveLength(1);
  });

  // ── Additional coverage tests ───────────────────────────────────────

  it("accumulates thinking content from multiple thinking events", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useConversation("ws-1"));

    act(() => {
      __wsMock.emit("ws-1", {
        type: "user_message",
        message: {
          id: "u1",
          sessionId: "sess-1",
          role: "user",
          content: "think",
          timestamp: "2026-02-12T00:00:00.000Z",
        },
      });
    });

    act(() => {
      __wsMock.emit("ws-1", { type: "thinking", text: "First " });
      __wsMock.emit("ws-1", { type: "thinking", text: "second" });
    });
    await flushStreamDeltas();

    expect(result.current.currentThinking).toBe("First second");
  });

  it("persists thinking content in finalized assistant message on done", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useConversation("ws-1"));

    act(() => {
      __wsMock.emit("ws-1", {
        type: "user_message",
        message: {
          id: "u1",
          sessionId: "sess-1",
          role: "user",
          content: "think",
          timestamp: "2026-02-12T00:00:00.000Z",
        },
      });
    });

    act(() => {
      __wsMock.emit("ws-1", { type: "thinking", text: "Deep thought" });
      __wsMock.emit("ws-1", { type: "text_delta", text: "Answer" });
      __wsMock.emit("ws-1", { type: "done", sessionId: "sess-1", messageId: "msg-sess-1" });
    });

    const assistant = result.current.messages.at(-1);
    expect(assistant?.thinkingContent).toBe("Deep thought");
    expect(assistant?.content).toBe("Answer");
  });

  it("updates tool call output via tool_result event", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useConversation("ws-1"));

    act(() => {
      __wsMock.emit("ws-1", {
        type: "user_message",
        message: {
          id: "u1",
          sessionId: "sess-1",
          role: "user",
          content: "read file",
          timestamp: "2026-02-12T00:00:00.000Z",
        },
      });
      __wsMock.emit("ws-1", {
        type: "tool_use",
        id: "tool-1",
        name: "Read",
        input: '{ "file_path": "/foo" }',
      });
    });

    expect(result.current.activeToolCalls[0]?.output).toBeUndefined();

    act(() => {
      __wsMock.emit("ws-1", { type: "tool_result", toolUseId: "tool-1", output: "file contents" });
    });

    expect(result.current.activeToolCalls[0]?.output).toBe("file contents");
  });

  it("creates an explicit cancelled message when no content was produced", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useConversation("ws-1"));

    act(() => {
      __wsMock.emit("ws-1", {
        type: "user_message",
        message: {
          id: "u1",
          sessionId: "sess-1",
          role: "user",
          content: "cancel immediately",
          timestamp: "2026-02-12T00:00:00.000Z",
        },
      });
    });

    act(() => {
      __wsMock.emit("ws-1", { type: "cancelled" });
    });

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0]?.role).toBe("user");
    expect(result.current.messages[1]).toEqual(expect.objectContaining({
      role: "assistant",
      cancelled: true,
      content: "Generation interrupted before any output.",
    }));
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.streamingStartedAt).toBeNull();
  });

  it("ignores stale cancelled events when no stream is active", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useConversation("ws-1"));

    act(() => {
      __wsMock.emit("ws-1", { type: "cancelled" });
    });

    expect(result.current.messages).toEqual([]);
    expect(result.current.isStreaming).toBe(false);
  });

  it("preserves durationMs from done event in finalized assistant message", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useConversation("ws-1"));

    act(() => {
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
      __wsMock.emit("ws-1", { type: "text_delta", text: "Hello" });
      __wsMock.emit("ws-1", { type: "done", sessionId: "sess-1", messageId: "msg-sess-1", durationMs: 4500 });
    });

    const assistant = result.current.messages.at(-1);
    expect(assistant?.durationMs).toBe(4500);
  });

  it("sends reject tool input response", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useConversation("ws-1"));

    act(() => {
      __wsMock.emit("ws-1", { type: "status", status: "busy", sessionId: "sess-1", streaming: true });
      __wsMock.emit("ws-1", {
        type: "tool_input_required",
        sessionId: "sess-1",
        requestId: "req-rej",
        toolName: "AskUserQuestion",
        toolUseId: "tool-rej",
        input: {},
      });
    });

    act(() => {
      result.current.rejectToolInput("I disagree");
    });

    expect(__wsMock.sendMock).toHaveBeenLastCalledWith("ws-1", {
      type: "tool_input_response",
      requestId: "req-rej",
      toolName: "AskUserQuestion",
      result: { type: "reject", message: "I disagree" },
      sessionId: "sess-1",
    });
    expect(result.current.pendingToolInputs).toEqual([]);
  });

  it("does nothing when rejectToolInput is called with no pending inputs", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useConversation("ws-1"));
    // Ignore the mount-time focus pull; this asserts the action sends nothing.
    __wsMock.sendMock.mockClear();

    act(() => {
      result.current.rejectToolInput("no pending");
    });

    // No tool_input_response should be sent
    expect(__wsMock.sendMock).not.toHaveBeenCalled();
  });

  it("sends dismiss plan response using pending ExitPlanMode request id", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useConversation("ws-1"));

    act(() => {
      __wsMock.emit("ws-1", { type: "status", status: "busy", sessionId: "sess-1", streaming: true });
      __wsMock.emit("ws-1", {
        type: "tool_input_required",
        sessionId: "sess-1",
        requestId: "req-dismiss",
        toolName: "ExitPlanMode",
        toolUseId: "tool-dismiss",
        input: {},
      });
    });

    act(() => {
      result.current.dismissPlan("Plan handed off to a new session.");
    });

    expect(__wsMock.sendMock).toHaveBeenLastCalledWith("ws-1", {
      type: "tool_input_response",
      requestId: "req-dismiss",
      toolName: "ExitPlanMode",
      result: { type: "dismiss", message: "Plan handed off to a new session." },
      sessionId: "sess-1",
    });
  });

  it("sends dismiss plan response even without pending inputs (fallback interactive state)", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useConversation("ws-1"));

    act(() => {
      __wsMock.emit("ws-1", {
        type: "status",
        status: "busy",
        sessionId: "sess-fallback",
        streaming: false,
      });
    });

    act(() => {
      result.current.dismissPlan("Plan handed off to a new session.");
    });

    expect(__wsMock.sendMock).toHaveBeenLastCalledWith("ws-1", {
      type: "tool_input_response",
      requestId: "",
      toolName: "ExitPlanMode",
      result: { type: "dismiss", message: "Plan handed off to a new session." },
      sessionId: "sess-fallback",
    });
  });

  it("sendMessage returns false and sets error when no workspace", () => {
    const { result } = renderHook(() => useConversation(undefined));

    act(() => {
      const sent = result.current.sendMessage("hello");
      expect(sent).toBe(false);
    });

    expect(result.current.error).toContain("no workspace");
  });

  it("stopStreaming sends stop message through transport", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useConversation("ws-1"));

    act(() => {
      result.current.stopStreaming();
    });

    expect(__wsMock.sendMock).toHaveBeenCalledWith("ws-1", { type: "stop" });
  });

  it("keeps stop routing on the active session when background user_message events arrive", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useConversation("ws-1"));

    act(() => {
      __wsMock.emit("ws-1", {
        type: "status",
        status: "busy",
        sessionId: "sess-active",
        streaming: true,
      });
      __wsMock.emit("ws-1", {
        type: "user_message",
        message: {
          id: "u-bg",
          sessionId: "sess-bg",
          role: "user",
          content: "background session",
          timestamp: "2026-02-12T00:00:05.000Z",
        },
      });
    });

    expect(result.current.sessionId).toBe("sess-active");

    act(() => {
      result.current.stopStreaming();
    });

    expect(__wsMock.sendMock).toHaveBeenLastCalledWith("ws-1", {
      type: "stop",
      sessionId: "sess-active",
    });
  });

  it("clears visible state on workspace change", async () => {
    const { __wsMock } = await getWsMock();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_001_333);
    const { result, rerender } = renderHook(
      ({ wsId }) => useConversation(wsId),
      { initialProps: { wsId: "ws-1" } },
    );

    act(() => {
      __wsMock.emit("ws-1", {
        type: "user_message",
        message: {
          id: "u1",
          sessionId: "sess-1",
          role: "user",
          content: "old workspace",
          timestamp: "2026-02-12T00:00:00.000Z",
        },
      });
    });

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.streamingStartedAt).toBe(1_700_000_001_333);

    rerender({ wsId: "ws-2" });

    expect(result.current.messages).toEqual([]);
    expect(result.current.sessionId).toBeUndefined();
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.streamingStartedAt).toBeNull();
    nowSpy.mockRestore();
  });

  it("increments switchCounter on workspace switch", async () => {
    const { result, rerender } = renderHook(
      ({ wsId }) => useConversation(wsId),
      { initialProps: { wsId: "ws-1" } },
    );

    const initial = result.current.switchCounter;

    rerender({ wsId: "ws-2" });
    expect(result.current.switchCounter).toBe(initial + 1);

    rerender({ wsId: "ws-1" });
    expect(result.current.switchCounter).toBe(initial + 2);
  });

  it("restores last viewed session when switching back to a workspace", async () => {
    const { __wsMock } = await getWsMock();
    const { result, rerender } = renderHook(
      ({ wsId }) => useConversation(wsId),
      { initialProps: { wsId: "ws-1" } },
    );

    // Establish session sess-A on ws-1 via a status event
    act(() => {
      __wsMock.emit("ws-1", {
        type: "status",
        status: "idle",
        sessionId: "sess-A",
        streaming: false,
      });
    });
    expect(result.current.sessionId).toBe("sess-A");

    // Switch to ws-2 — cleanup saves ws-1 → sess-A
    rerender({ wsId: "ws-2" });
    __wsMock.sendMock.mockClear();

    // Switch back to ws-1 — should send switch_session for the saved session
    __wsMock.setReplay("ws-1", []);
    rerender({ wsId: "ws-1" });

    expect(__wsMock.sendMock).toHaveBeenCalledWith("ws-1", {
      type: "switch_session",
      sessionId: "sess-A",
    });
    expect(result.current.sessionId).toBe("sess-A");
  });

  it("uses session-specific REST endpoint when restoring saved session", async () => {
    const { __wsMock } = await getWsMock();
    const { __apiMock } = await getApiMock();
    __apiMock.getMock.mockResolvedValue(historyResponse([]));
    const { result, rerender } = renderHook(
      ({ wsId }) => useConversation(wsId),
      { initialProps: { wsId: "ws-1" } },
    );

    // Establish session on ws-1
    act(() => {
      __wsMock.emit("ws-1", {
        type: "status",
        status: "idle",
        sessionId: "sess-B",
        streaming: false,
      });
    });

    // Switch away and back
    __apiMock.getMock.mockClear();
    __apiMock.getMock.mockResolvedValue(historyResponse([]));
    rerender({ wsId: "ws-2" });
    __wsMock.setReplay("ws-1", []);
    rerender({ wsId: "ws-1" });

    await waitFor(() => {
      expect(__apiMock.getMock).toHaveBeenCalledWith(
        "/api/workspaces/ws-1/sessions/sess-B/messages?limit=200",
      );
    });
  });

  it("preserves streaming data across workspace switch", async () => {
    const { __wsMock } = await getWsMock();
    const { result, rerender } = renderHook(
      ({ wsId }) => useConversation(wsId),
      { initialProps: { wsId: "ws-1" } },
    );

    // Start streaming on ws-1
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
      __wsMock.emit("ws-1", { type: "text_delta", sessionId: "sess-1", text: "Hello " });
    });
    await flushStreamDeltas();

    expect(result.current.currentStreamingText).toBe("Hello ");
    expect(result.current.isStreaming).toBe(true);

    // Switch to ws-2 — visible state clears
    rerender({ wsId: "ws-2" });

    expect(result.current.messages).toEqual([]);
    expect(result.current.currentStreamingText).toBe("");
    expect(result.current.isStreaming).toBe(false);

    // Switch back to ws-1 — transport replays status, then we get more deltas
    __wsMock.setReplay("ws-1", [
      { type: "status", status: "busy", sessionId: "sess-1", streaming: true },
    ]);
    rerender({ wsId: "ws-1" });

    // Simulate deltas that were buffered while on ws-2
    act(() => {
      __wsMock.emit("ws-1", { type: "text_delta", sessionId: "sess-1", text: "World" });
    });
    await flushStreamDeltas();

    // Pre-switch + post-switch text are both present
    expect(result.current.sessionId).toBe("sess-1");
    expect(result.current.currentStreamingText).toBe("Hello World");
    expect(result.current.isStreaming).toBe(true);
  });

  it("full reset clears sessionStreams when workspaceId becomes undefined", async () => {
    const { __wsMock } = await getWsMock();
    const { result, rerender } = renderHook(
      ({ wsId }) => useConversation(wsId),
      { initialProps: { wsId: "ws-1" as string | undefined } },
    );

    act(() => {
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
      __wsMock.emit("ws-1", { type: "text_delta", sessionId: "sess-1", text: "data" });
    });
    await flushStreamDeltas();

    expect(result.current.currentStreamingText).toBe("data");

    // Deselect workspace entirely — full reset
    rerender({ wsId: undefined });

    expect(result.current.messages).toEqual([]);
    expect(result.current.currentStreamingText).toBe("");
    expect(result.current.isStreaming).toBe(false);

    // Switch back — no preserved data (was a full reset, not workspace switch)
    __wsMock.setReplay("ws-1", []);
    rerender({ wsId: "ws-1" });

    expect(result.current.currentStreamingText).toBe("");
    expect(result.current.isStreaming).toBe(false);
  });

  it("finalizes assistant message when done arrives via buffer after workspace switch", async () => {
    const { __wsMock } = await getWsMock();
    const { result, rerender } = renderHook(
      ({ wsId }) => useConversation(wsId),
      { initialProps: { wsId: "ws-1" } },
    );

    // Start streaming on ws-1
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
      __wsMock.emit("ws-1", { type: "text_delta", sessionId: "sess-1", text: "Before " });
    });
    await flushStreamDeltas();

    expect(result.current.currentStreamingText).toBe("Before ");

    // Switch to ws-2 while streaming is in progress
    rerender({ wsId: "ws-2" });

    // Switch back — buffer replays remaining deltas + done
    __wsMock.setReplay("ws-1", [
      { type: "status", status: "busy", sessionId: "sess-1", streaming: true },
      { type: "text_delta", sessionId: "sess-1", text: "after" },
      { type: "done", sessionId: "sess-1", messageId: "msg-sess-1", durationMs: 1234 },
    ]);
    rerender({ wsId: "ws-1" });

    // The done event should have finalized an assistant message with full content
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.currentStreamingText).toBe("");
    const assistantMsg = result.current.messages.find((m) => m.role === "assistant");
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg!.content).toBe("Before after");
    expect(assistantMsg!.durationMs).toBe(1234);
  });

  it("ignores late live stream fragments after done", async () => {
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
      __wsMock.emit("ws-1", { type: "text_delta", sessionId: "sess-1", text: "Done" });
      __wsMock.emit("ws-1", { type: "done", sessionId: "sess-1", messageId: "msg-sess-1", durationMs: 100 });
    });

    expect(result.current.isStreaming).toBe(false);
    expect(result.current.streamingStartedAt).toBeNull();
    expect(result.current.currentStreamingText).toBe("");
    expect(result.current.messages.at(-1)?.content).toBe("Done");

    act(() => {
      __wsMock.emit("ws-1", { type: "text_delta", sessionId: "sess-1", text: " late text" });
      __wsMock.emit("ws-1", { type: "thinking", sessionId: "sess-1", text: "late thinking" });
      __wsMock.emit("ws-1", {
        type: "tool_use",
        sessionId: "sess-1",
        id: "late-tool",
        name: "Read",
        input: "{}",
      });
      __wsMock.emit("ws-1", {
        type: "agent_activity",
        sessionId: "sess-1",
        activity: {
          id: "late-command",
          kind: "command_execution",
          command: "npm test",
          status: "completed",
        },
      });
      __wsMock.emit("ws-1", {
        type: "tool_input_required",
        sessionId: "sess-1",
        requestId: "late-input",
        toolName: "AskUserQuestion",
        toolUseId: "late-tool",
        input: {},
      });
      __wsMock.emit("ws-1", { type: "plan_mode_changed", sessionId: "sess-1", active: true });
    });

    expect(result.current.isStreaming).toBe(false);
    expect(result.current.streamingStartedAt).toBeNull();
    expect(result.current.currentStreamingText).toBe("");
    expect(result.current.currentThinking).toBe("");
    expect(result.current.activeToolCalls).toEqual([]);
    expect(result.current.activeAgentActivities).toEqual([]);
    expect(result.current.pendingToolInputs).toEqual([]);
    expect(result.current.agentPlanMode).toBeUndefined();
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages.at(-1)?.content).toBe("Done");
  });

  it("status event updates workspace status, streaming flag, and streamingStartedAt", async () => {
    const { __wsMock } = await getWsMock();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_001_444);
    const { result } = renderHook(() => useConversation("ws-1"));

    act(() => {
      __wsMock.emit("ws-1", {
        type: "status",
        status: "busy",
        streaming: true,
        sessionId: "sess-x",
        streamingStartedAt: 1_700_000_009_999,
      });
    });

    expect(result.current.workspaceStatus).toBe("busy");
    expect(result.current.isStreaming).toBe(true);
    expect(result.current.sessionId).toBe("sess-x");
    expect(result.current.streamingStartedAt).toBe(1_700_000_009_999);

    act(() => {
      // A newer backend timestamp should replace the existing value.
      __wsMock.emit("ws-1", {
        type: "status",
        status: "busy",
        streaming: true,
        sessionId: "sess-x",
        streamingStartedAt: 1_700_000_010_000,
      });
    });

    expect(result.current.streamingStartedAt).toBe(1_700_000_010_000);

    act(() => {
      // Fallback to Date.now when backend does not provide a timestamp.
      __wsMock.emit("ws-1", { type: "status", status: "busy", streaming: true, sessionId: "sess-y" });
    });

    // sess-y status creates a background stream slot, but the active session stays sess-x.
    expect(result.current.sessionId).toBe("sess-x");
    expect(result.current.streamingStartedAt).toBe(1_700_000_010_000);

    act(() => {
      __wsMock.emit("ws-1", { type: "status", status: "idle", streaming: false });
    });

    expect(result.current.workspaceStatus).toBe("idle");
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.sessionId).toBe("sess-x");
    expect(result.current.streamingStartedAt).toBeNull();
    nowSpy.mockRestore();
  });

  it("uses Date.now as fallback streamingStartedAt for busy status without backend timestamp", async () => {
    const { __wsMock } = await getWsMock();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_001_555);
    const { result } = renderHook(() => useConversation("ws-1"));

    act(() => {
      __wsMock.emit("ws-1", { type: "status", status: "busy", streaming: true, sessionId: "sess-fallback" });
    });

    expect(result.current.isStreaming).toBe(true);
    expect(result.current.streamingStartedAt).toBe(1_700_000_001_555);
    nowSpy.mockRestore();
  });

  it("normalizes status streamingStartedAt in seconds to milliseconds", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useConversation("ws-1"));

    act(() => {
      __wsMock.emit("ws-1", {
        type: "status",
        status: "busy",
        streaming: true,
        sessionId: "sess-seconds",
        streamingStartedAt: 1_700_000_002,
      });
    });

    expect(result.current.streamingStartedAt).toBe(1_700_000_002_000);
  });

  it("preserves streamingStartedAt when a same-session REST history lands while streaming", async () => {
    const { __wsMock } = await getWsMock();
    const { __apiMock } = await getApiMock();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_001_666);

    // The initial mount fetch resolves only after a stream is in progress.
    let resolveMount: ((res: SessionMessagesResponse) => void) | undefined;
    __apiMock.getMock.mockReturnValueOnce(
      new Promise<SessionMessagesResponse>((resolve) => { resolveMount = resolve; }),
    );

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
      __wsMock.emit("ws-1", { type: "text_delta", text: "partial" });
    });
    expect(result.current.streamingStartedAt).toBe(1_700_000_001_666);

    await act(async () => {
      resolveMount?.(historyResponse([
        {
          id: "u1",
          sessionId: "sess-1",
          role: "user",
          content: "hello",
          timestamp: "2026-02-12T00:00:00.000Z",
        },
      ]));
      await Promise.resolve();
    });

    expect(result.current.isStreaming).toBe(true);
    expect(result.current.streamingStartedAt).toBe(1_700_000_001_666);
    nowSpy.mockRestore();
  });

  it("error event sets error message and stops streaming", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useConversation("ws-1"));

    act(() => {
      __wsMock.emit("ws-1", { type: "error", message: "Connection lost" });
    });

    expect(result.current.error).toBe("Connection lost");
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.streamingStartedAt).toBeNull();
  });

  // ── Stale error filtering on buffer replay ─────────────────────────

  it("filters session-less errors replayed from buffer on mount", async () => {
    const { __wsMock } = await getWsMock();

    // Simulate a stale error that was buffered while the user was on another workspace.
    __wsMock.setReplay("ws-1", [
      { type: "error", message: "stale connection error" },
    ]);
    __wsMock.setBuffered("ws-1", true);

    const { result } = renderHook(() => useConversation("ws-1"));

    // The session-less error from the synchronous buffer replay should be silently dropped.
    expect(result.current.error).toBeUndefined();
  });

  it("dispatches session-scoped errors during buffer replay", async () => {
    const { __wsMock } = await getWsMock();

    // Session-scoped errors are NOT filtered — they carry a sessionId so they're
    // targeted, not stale broadcast noise.
    __wsMock.setReplay("ws-1", [
      { type: "status", status: "busy", sessionId: "sess-1", streaming: true },
      { type: "error", sessionId: "sess-1", message: "session error from buffer" },
    ]);
    __wsMock.setBuffered("ws-1", true);

    const { result } = renderHook(() => useConversation("ws-1"));

    expect(result.current.error).toBe("session error from buffer");
  });

  it("dispatches session-less errors arriving live after buffer replay", async () => {
    const { __wsMock } = await getWsMock();

    // Pre-populate buffer with a stale error (dropped) to confirm the flag resets.
    __wsMock.setReplay("ws-1", [
      { type: "error", message: "stale error" },
    ]);
    __wsMock.setBuffered("ws-1", true);

    const { result } = renderHook(() => useConversation("ws-1"));
    expect(result.current.error).toBeUndefined();

    // A live session-less error arriving after replay should pass through normally.
    act(() => {
      __wsMock.emit("ws-1", { type: "error", message: "live error" });
    });

    expect(result.current.error).toBe("live error");
  });

  it("ignores session-scoped error for a background session", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useConversation("ws-1"));

    act(() => {
      __wsMock.emit("ws-1", { type: "status", status: "busy", sessionId: "sess-active", streaming: true });
      __wsMock.emit("ws-1", { type: "error", sessionId: "sess-bg", message: "Background error" });
    });

    expect(result.current.sessionId).toBe("sess-active");
    expect(result.current.error).toBeUndefined();
    expect(result.current.isStreaming).toBe(true);
  });

  // ── lockedProvider tests ──────────────────────────────────────────

  it("extracts lockedProvider from status event", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useConversation("ws-1"));

    expect(result.current.lockedProvider).toBeUndefined();

    act(() => {
      __wsMock.emit("ws-1", {
        type: "status",
        status: "busy",
        sessionId: "sess-1",
        streaming: true,
        lockedProvider: "codex",
      });
    });

    expect(result.current.lockedProvider).toBe("codex");
  });

  it("does not clear lockedProvider when status event omits it", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useConversation("ws-1"));

    act(() => {
      __wsMock.emit("ws-1", {
        type: "status",
        status: "busy",
        sessionId: "sess-1",
        streaming: true,
        lockedProvider: "claude",
      });
    });

    expect(result.current.lockedProvider).toBe("claude");

    // Idle status without lockedProvider should not clear it
    act(() => {
      __wsMock.emit("ws-1", {
        type: "status",
        status: "idle",
        sessionId: "sess-1",
        streaming: false,
      });
    });

    expect(result.current.lockedProvider).toBe("claude");
  });

  it("clears lockedProvider on session switch", async () => {
    const { __wsMock } = await getWsMock();
    const { __apiMock } = await getApiMock();
    __apiMock.getMock.mockResolvedValueOnce(historyResponse([]));
    const { result } = renderHook(() => useConversation("ws-1"));

    act(() => {
      __wsMock.emit("ws-1", {
        type: "status",
        status: "busy",
        sessionId: "sess-1",
        streaming: true,
        lockedProvider: "codex",
      });
    });

    expect(result.current.lockedProvider).toBe("codex");

    await act(async () => {
      await result.current.switchSession("sess-2");
    });

    expect(result.current.lockedProvider).toBeUndefined();
  });

  it("picks up lockedProvider from bootstrap status on session switch", async () => {
    const { __wsMock } = await getWsMock();
    const { __apiMock } = await getApiMock();
    __apiMock.getMock.mockResolvedValueOnce(historyResponse([]));
    const { result } = renderHook(() => useConversation("ws-1"));

    await act(async () => {
      await result.current.switchSession("sess-2");
    });

    // Simulates the bootstrap status event from sendSessionBootstrap
    act(() => {
      __wsMock.emit("ws-1", {
        type: "status",
        status: "idle",
        sessionId: "sess-2",
        streaming: false,
        lockedProvider: "claude",
      });
    });

    expect(result.current.lockedProvider).toBe("claude");
  });

  describe("session window cache (stale-while-revalidate)", () => {
    it("writes the per-session window to the transport when messages change after done", async () => {
      const { __wsMock } = await getWsMock();

      const { result } = renderHook(() => useConversation("ws-1"));

      await act(async () => {
        __wsMock.emit("ws-1", { type: "status", status: "busy", sessionId: "sess-1", streaming: true });
        __wsMock.emit("ws-1", {
          type: "user_message",
          message: { id: "u1", sessionId: "sess-1", role: "user", content: "hello", timestamp: "2026-02-20T00:00:00.000Z" },
        });
        __wsMock.emit("ws-1", { type: "text_delta", sessionId: "sess-1", text: "hi back" });
        __wsMock.emit("ws-1", { type: "done", sessionId: "sess-1", messageId: "msg-sess-1", durationMs: 100 });
      });

      expect(result.current.messages).toHaveLength(2);
      expect(__wsMock.setSessionWindowMock).toHaveBeenCalled();
      const lastCall = __wsMock.setSessionWindowMock.mock.calls.at(-1)!;
      expect(lastCall[0]).toBe("ws-1");
      expect(lastCall[1]).toBe("sess-1");
      expect(lastCall[2].messages).toHaveLength(2);
      expect(lastCall[2]).toHaveProperty("hasMore");
    });

    it("does not write the window with empty messages during workspace switch", async () => {
      const { __apiMock } = await getApiMock();
      __apiMock.getMock.mockResolvedValue(historyResponse([
        { id: "m1", sessionId: "sess-1", role: "user", content: "hi", timestamp: "2026-02-20T00:00:00.000Z" },
      ]));
      const { __wsMock } = await getWsMock();

      const { result, rerender } = renderHook(
        ({ wsId }) => useConversation(wsId),
        { initialProps: { wsId: "ws-1" } },
      );

      await waitFor(() => {
        expect(result.current.messages).toHaveLength(1);
      });
      __wsMock.setSessionWindowMock.mockClear();

      // Switch to ws-2 — messages clear, window must NOT be overwritten with empty.
      rerender({ wsId: "ws-2" });

      for (const call of __wsMock.setSessionWindowMock.mock.calls) {
        expect(call[2].messages.length).toBeGreaterThan(0);
      }
    });

    it("skips window write on first effect cycle after workspace switch to prevent cross-workspace pollution", async () => {
      const { __apiMock } = await getApiMock();
      __apiMock.getMock.mockResolvedValue(historyResponse([
        { id: "m1", sessionId: "sess-1", role: "user", content: "ws-1 msg", timestamp: "2026-02-20T00:00:00.000Z" },
      ]));
      const { __wsMock } = await getWsMock();

      const { result, rerender } = renderHook(
        ({ wsId }) => useConversation(wsId),
        { initialProps: { wsId: "ws-1" } },
      );

      await waitFor(() => {
        expect(result.current.messages).toHaveLength(1);
      });
      __wsMock.setSessionWindowMock.mockClear();

      // The guard (prevCacheWorkspaceRef) prevents writing ws-1's messages into ws-2's cache.
      rerender({ wsId: "ws-2" });

      const ws2CacheCalls = __wsMock.setSessionWindowMock.mock.calls.filter(
        ([wsId]: [string]) => wsId === "ws-2",
      );
      expect(ws2CacheCalls).toHaveLength(0);
    });

    it("renders the cached window immediately and still revalidates via REST on switch-back", async () => {
      const { __wsMock } = await getWsMock();
      const { __apiMock } = await getApiMock();

      // Seed a window for ws-1 / sess-cached and pre-set the saved session.
      __wsMock.setSessionWindow("ws-1", "sess-cached", {
        messages: [{ id: "m1", sessionId: "sess-cached", role: "user", content: "cached", timestamp: "2026-02-20T00:00:00.000Z" }],
        hasMore: false,
      });

      // A fresher REST window revalidates the cached view.
      __apiMock.getMock.mockResolvedValue(historyResponse([
        { id: "m1", sessionId: "sess-cached", role: "user", content: "cached", timestamp: "2026-02-20T00:00:00.000Z" },
        { id: "a1", sessionId: "sess-cached", role: "assistant", content: "revalidated", timestamp: "2026-02-20T00:00:01.000Z" },
      ]));

      const { result, rerender } = renderHook(
        ({ wsId }) => useConversation(wsId),
        { initialProps: { wsId: "ws-other" as string | undefined } },
      );

      // Establish that ws-1's saved session is sess-cached, then visit ws-1.
      act(() => {
        rerender({ wsId: "ws-1" });
      });
      // Without a saved session yet, prime it via status then re-enter.
      act(() => {
        __wsMock.emit("ws-1", { type: "status", status: "idle", sessionId: "sess-cached", streaming: false });
      });

      // REST still fires (single source of truth) — stale-while-revalidate.
      await waitFor(() => {
        expect(__apiMock.getMock).toHaveBeenCalled();
      });
      expect(result.current.sessionId).toBe("sess-cached");
    });

    it("always fires a REST fetch on first visit", async () => {
      const { __apiMock } = await getApiMock();
      __apiMock.getMock.mockReturnValue(new Promise<SessionMessagesResponse>(() => {}));

      renderHook(() => useConversation("ws-1"));

      await waitFor(() => {
        expect(__apiMock.getMock).toHaveBeenCalledWith(
          expect.stringContaining("/api/workspaces/ws-1/"),
        );
      });
    });
  });

  describe("token usage in done event", () => {
    it("stores inputTokens/outputTokens from done event in assistant message", async () => {
      const { __wsMock } = await getWsMock();
      const { result } = renderHook(() => useConversation("ws-1"));

      act(() => {
        __wsMock.emit("ws-1", { type: "status", status: "busy", sessionId: "sess-1", streaming: true });
        __wsMock.emit("ws-1", {
          type: "user_message",
          message: {
            id: "u1",
            sessionId: "sess-1",
            role: "user",
            content: "hello",
            timestamp: "2026-02-20T00:00:00.000Z",
          },
        });
      });

      act(() => {
        __wsMock.emit("ws-1", { type: "text_delta", text: "Hello back" });
        __wsMock.emit("ws-1", {
          type: "done",
          sessionId: "sess-1", messageId: "msg-sess-1",
          durationMs: 2000,
          inputTokens: 45_000,
          outputTokens: 1_200,
        });
      });

      const assistant = result.current.messages.at(-1);
      expect(assistant?.role).toBe("assistant");
      expect(assistant?.inputTokens).toBe(45_000);
      expect(assistant?.outputTokens).toBe(1_200);
      expect(assistant?.durationMs).toBe(2000);
    });

    it("stores context usage fields from done event in assistant message", async () => {
      const { __wsMock } = await getWsMock();
      const { result } = renderHook(() => useConversation("ws-1"));

      act(() => {
        __wsMock.emit("ws-1", { type: "status", status: "busy", sessionId: "sess-1", streaming: true });
        __wsMock.emit("ws-1", { type: "text_delta", text: "Codex reply" });
        __wsMock.emit("ws-1", {
          type: "done",
          sessionId: "sess-1", messageId: "msg-sess-1",
          inputTokens: 41_000,
          outputTokens: 900,
          contextUsedTokens: 42_000,
          contextWindowTokens: 400_000,
        });
      });

      const assistant = result.current.messages.at(-1);
      expect(assistant?.role).toBe("assistant");
      expect(assistant?.inputTokens).toBe(41_000);
      expect(assistant?.outputTokens).toBe(900);
      expect(assistant?.contextUsedTokens).toBe(42_000);
      expect(assistant?.contextWindowTokens).toBe(400_000);
    });

    it("stores undefined tokens when done event has no token data", async () => {
      const { __wsMock } = await getWsMock();
      const { result } = renderHook(() => useConversation("ws-1"));

      act(() => {
        __wsMock.emit("ws-1", { type: "status", status: "busy", sessionId: "sess-1", streaming: true });
        __wsMock.emit("ws-1", {
          type: "user_message",
          message: {
            id: "u1",
            sessionId: "sess-1",
            role: "user",
            content: "hello",
            timestamp: "2026-02-20T00:00:00.000Z",
          },
        });
      });

      act(() => {
        __wsMock.emit("ws-1", { type: "text_delta", text: "Reply" });
        __wsMock.emit("ws-1", { type: "done", sessionId: "sess-1", messageId: "msg-sess-1" });
      });

      const assistant = result.current.messages.at(-1);
      expect(assistant?.role).toBe("assistant");
      expect(assistant?.inputTokens).toBeUndefined();
      expect(assistant?.outputTokens).toBeUndefined();
    });
  });

  describe("stream_snapshot (consolidated catch-up, replace semantics)", () => {
    const snapshot = (overrides: Partial<Extract<WsOutgoing, { type: "stream_snapshot" }>> = {}) => ({
      type: "stream_snapshot" as const,
      sessionId: "sess-1",
      text: "partial answer",
      thinking: "let me think",
      toolCalls: [
        { id: "t1", name: "Read", input: JSON.stringify({ file_path: "/a.ts" }), output: "contents" },
      ],
      agentActivities: [],
      planMode: false,
      streamingStartedAt: 1_700_000_000_000,
      ...overrides,
    });

    it("replaces the session stream slot from a snapshot and is idempotent", async () => {
      const { __wsMock } = await getWsMock();
      const { result } = renderHook(() => useConversation("ws-1"));

      act(() => {
        __wsMock.emit("ws-1", { type: "status", status: "busy", sessionId: "sess-1", streaming: true });
        __wsMock.emit("ws-1", snapshot());
      });

      const first = {
        text: result.current.currentStreamingText,
        thinking: result.current.currentThinking,
        toolCalls: result.current.activeToolCalls,
        isStreaming: result.current.isStreaming,
      };
      expect(first).toEqual({
        text: "partial answer",
        thinking: "let me think",
        toolCalls: [expect.objectContaining({ id: "t1", output: "contents" })],
        isStreaming: true,
      });

      // Applying the SAME snapshot again must not duplicate or alter state.
      act(() => {
        __wsMock.emit("ws-1", snapshot());
      });

      expect(result.current.currentStreamingText).toBe("partial answer");
      expect(result.current.currentThinking).toBe("let me think");
      expect(result.current.activeToolCalls).toHaveLength(1);
      expect(result.current.activeToolCalls).toEqual([
        expect.objectContaining({ id: "t1" }),
      ]);
    });

    it("creates the stream slot when a snapshot arrives without a prior status", async () => {
      const { __wsMock } = await getWsMock();
      const { result } = renderHook(() => useConversation("ws-1"));

      act(() => {
        // First-visit case: snapshot arrives with no pre-existing slot.
        __wsMock.emit("ws-1", { type: "status", status: "busy", sessionId: "sess-1", streaming: false });
        __wsMock.emit("ws-1", snapshot({ thinking: "", toolCalls: [], agentActivities: [] }));
      });

      expect(result.current.sessionId).toBe("sess-1");
      expect(result.current.currentStreamingText).toBe("partial answer");
      expect(result.current.isStreaming).toBe(true);
    });

    it("a later snapshot replaces (not appends) prior live deltas", async () => {
      const { __wsMock } = await getWsMock();
      const { result } = renderHook(() => useConversation("ws-1"));

      act(() => {
        __wsMock.emit("ws-1", { type: "status", status: "busy", sessionId: "sess-1", streaming: true });
        __wsMock.emit("ws-1", { type: "text_delta", sessionId: "sess-1", text: "stale " });
        __wsMock.emit("ws-1", {
          type: "tool_use", sessionId: "sess-1", id: "told", name: "Bash", input: "{}",
        });
      });
      await flushStreamDeltas();
      expect(result.current.currentStreamingText).toBe("stale ");

      act(() => {
        __wsMock.emit("ws-1", snapshot({ text: "fresh full text", toolCalls: [] }));
      });

      // Replace semantics: the stale delta text and tool are gone, not merged.
      expect(result.current.currentStreamingText).toBe("fresh full text");
      expect(result.current.activeToolCalls).toEqual([]);
    });

    it("computes unified output scalars for snapshot tools that carry output", async () => {
      const { __wsMock } = await getWsMock();
      const { result } = renderHook(() => useConversation("ws-1"));

      // A mid-stream-join snapshot whose tool carries a full output must render
      // via the same computed scalars as the live tool_result path — not the raw
      // full body — so there is one render path for live and history.
      act(() => {
        __wsMock.emit("ws-1", { type: "status", status: "busy", sessionId: "sess-1", streaming: true });
        __wsMock.emit("ws-1", snapshot({
          toolCalls: [
            { id: "g1", name: "Grep", input: "{}", output: "line1\nline2\nline3" },
          ],
        }));
      });

      const tool = result.current.activeToolCalls[0];
      expect(tool).toMatchObject({
        id: "g1",
        output: "line1\nline2\nline3",
        outputPreview: "line1\nline2\nline3",
        outputLineCount: 3,
        outputByteLength: 17,
        outputTruncated: false,
      });
    });

    it("computes zero scalars for a snapshot tool that completed with empty output", async () => {
      const { __wsMock } = await getWsMock();
      const { result } = renderHook(() => useConversation("ws-1"));

      // A completed tool whose output is "" must get the SAME zero scalars the
      // live tool_result path computes (outputPreview "", counts 0, untruncated)
      // — not be mistaken for a still-running tool and left without scalars.
      act(() => {
        __wsMock.emit("ws-1", { type: "status", status: "busy", sessionId: "sess-1", streaming: true });
        __wsMock.emit("ws-1", snapshot({
          toolCalls: [{ id: "e1", name: "Bash", input: "{}", output: "" }],
        }));
      });

      const tool = result.current.activeToolCalls[0];
      expect(tool).toMatchObject({
        id: "e1",
        output: "",
        outputPreview: "",
        outputLineCount: 0,
        outputByteLength: 0,
        outputTruncated: false,
      });
      // The scalars must be present (computed), not undefined.
      expect(tool?.outputPreview).not.toBeUndefined();
      expect(tool?.outputLineCount).not.toBeUndefined();
      expect(tool?.outputByteLength).not.toBeUndefined();
      expect(tool?.outputTruncated).not.toBeUndefined();
    });

    it("leaves snapshot tools without output untouched (no scalars synthesized)", async () => {
      const { __wsMock } = await getWsMock();
      const { result } = renderHook(() => useConversation("ws-1"));

      act(() => {
        __wsMock.emit("ws-1", { type: "status", status: "busy", sessionId: "sess-1", streaming: true });
        __wsMock.emit("ws-1", snapshot({
          toolCalls: [{ id: "pending", name: "Bash", input: "{}" }],
        }));
      });

      const tool = result.current.activeToolCalls[0];
      expect(tool).toMatchObject({ id: "pending", name: "Bash" });
      expect(tool?.output).toBeUndefined();
      expect(tool?.outputPreview).toBeUndefined();
      expect(tool?.outputLineCount).toBeUndefined();
    });
  });

  describe("focus pull on mount (in-flight catch-up)", () => {
    it("sends a bare switch_session (no sessionId) when there is no saved session", async () => {
      const { __wsMock } = await getWsMock();
      // No saved session for ws-1 (beforeEach resets saved sessions). The mount
      // effect must still pull focus so an already-streaming workspace delivers
      // its consolidated stream_snapshot on first navigation.
      renderHook(() => useConversation("ws-1"));

      const switchCalls = __wsMock.sendMock.mock.calls.filter(
        ([, msg]) => (msg as { type?: string }).type === "switch_session",
      );
      expect(switchCalls).toHaveLength(1);
      expect(switchCalls[0]?.[0]).toBe("ws-1");
      expect((switchCalls[0]?.[1] as { sessionId?: string }).sessionId).toBeUndefined();
    });

    it("sends switch_session with the saved session id when one exists", async () => {
      const { __wsMock } = await getWsMock();
      const { rerender } = renderHook(
        ({ wsId }) => useConversation(wsId),
        { initialProps: { wsId: "ws-1" } },
      );

      // Establish a session, then leave so cleanup saves ws-1 → sess-saved.
      act(() => {
        __wsMock.emit("ws-1", { type: "status", status: "idle", sessionId: "sess-saved", streaming: false });
      });
      rerender({ wsId: "ws-2" });
      __wsMock.sendMock.mockClear();

      // Returning to ws-1 must focus the saved session explicitly.
      rerender({ wsId: "ws-1" });

      const switchCalls = __wsMock.sendMock.mock.calls.filter(
        ([, msg]) => (msg as { type?: string }).type === "switch_session",
      );
      expect(switchCalls).toContainEqual([
        "ws-1",
        { type: "switch_session", sessionId: "sess-saved" },
      ]);
    });

    it("re-pulls focus on reconnect with a bare switch_session when no session is active", async () => {
      const { __wsMock } = await getWsMock();
      renderHook(() => useConversation("ws-1"));
      // Drop the mount-time pull so we isolate the reconnect-triggered send.
      __wsMock.sendMock.mockClear();

      act(() => {
        __wsMock.triggerReconnect("ws-1");
      });

      const switchCalls = __wsMock.sendMock.mock.calls.filter(
        ([, msg]) => (msg as { type?: string }).type === "switch_session",
      );
      expect(switchCalls).toHaveLength(1);
      expect((switchCalls[0]?.[1] as { sessionId?: string }).sessionId).toBeUndefined();
    });

    it("re-pulls focus on reconnect with the active session id when one is set", async () => {
      const { __wsMock } = await getWsMock();
      const { result } = renderHook(() => useConversation("ws-1"));

      act(() => {
        __wsMock.emit("ws-1", { type: "status", status: "busy", sessionId: "sess-active", streaming: true });
      });
      expect(result.current.sessionId).toBe("sess-active");
      __wsMock.sendMock.mockClear();

      act(() => {
        __wsMock.triggerReconnect("ws-1");
      });

      expect(__wsMock.sendMock).toHaveBeenCalledWith("ws-1", {
        type: "switch_session",
        sessionId: "sess-active",
      });
    });

    it("refetches REST history on reconnect to recover a turn that completed while disconnected", async () => {
      const { __wsMock } = await getWsMock();
      const { __apiMock } = await getApiMock();
      const { result } = renderHook(() => useConversation("ws-1"));

      act(() => {
        __wsMock.emit("ws-1", { type: "status", status: "busy", sessionId: "sess-active", streaming: true });
      });
      expect(result.current.sessionId).toBe("sess-active");
      // Drop the mount-time pull so the assertion targets only the
      // reconnect-triggered REST refetch.
      __apiMock.getMock.mockClear();

      // The turn that finished during the disconnect is only available via REST;
      // the live snapshot path can't deliver it because the session is no longer
      // streaming once we reconnect.
      __apiMock.getMock.mockResolvedValueOnce(historyResponse([
        {
          id: "u1",
          sessionId: "sess-active",
          role: "user",
          content: "before disconnect",
          timestamp: "2026-02-12T00:00:00.000Z",
        },
        {
          id: "a1",
          sessionId: "sess-active",
          role: "assistant",
          content: "completed while socket was down",
          timestamp: "2026-02-12T00:00:01.000Z",
        },
      ]));

      await act(async () => {
        __wsMock.triggerReconnect("ws-1");
        await Promise.resolve();
      });

      expect(__apiMock.getMock).toHaveBeenCalledWith(
        "/api/workspaces/ws-1/sessions/sess-active/messages?limit=200",
      );
      await waitFor(() => {
        expect(result.current.messages).toEqual([
          expect.objectContaining({ id: "u1", content: "before disconnect" }),
          expect.objectContaining({ id: "a1", content: "completed while socket was down" }),
        ]);
      });
    });

    it("does not refetch REST history on reconnect when no session is active", async () => {
      const { __wsMock } = await getWsMock();
      const { __apiMock } = await getApiMock();
      renderHook(() => useConversation("ws-1"));
      // Drop the mount-time pull so the assertion isolates the reconnect path.
      __apiMock.getMock.mockClear();

      act(() => {
        __wsMock.triggerReconnect("ws-1");
      });

      // No session id → nothing to refetch (the bare switch_session resolves it).
      expect(__apiMock.getMock).not.toHaveBeenCalled();
    });
  });

  describe("finalization dedup by server message id", () => {
    it("appends the optimistic assistant message with the server id, then dedups on REST fetch", async () => {
      const { __wsMock } = await getWsMock();
      const { __apiMock } = await getApiMock();

      // The done-resync returns history that INCLUDES the just-finalized turn.
      __apiMock.getMock.mockResolvedValue(historyResponse([
        { id: "u1", sessionId: "sess-1", role: "user", content: "hi", timestamp: "2026-02-20T00:00:00.000Z" },
        { id: "server-msg-1", sessionId: "sess-1", role: "assistant", content: "Answer", timestamp: "2026-02-20T00:00:01.000Z" },
      ]));

      const { result } = renderHook(() => useConversation("ws-1"));

      act(() => {
        __wsMock.emit("ws-1", {
          type: "user_message",
          message: { id: "u1", sessionId: "sess-1", role: "user", content: "hi", timestamp: "2026-02-20T00:00:00.000Z" },
        });
        __wsMock.emit("ws-1", { type: "text_delta", text: "Answer" });
      });

      await act(async () => {
        __wsMock.emit("ws-1", { type: "done", sessionId: "sess-1", messageId: "server-msg-1" });
        await Promise.resolve();
      });

      // Optimistic append used the server id; the REST resync must NOT duplicate it.
      await waitFor(() => {
        const assistants = result.current.messages.filter((m) => m.id === "server-msg-1");
        expect(assistants).toHaveLength(1);
      });
      expect(result.current.messages.filter((m) => m.role === "assistant")).toHaveLength(1);
    });

    it("does not append an empty assistant bubble when done omits messageId", async () => {
      const { __wsMock } = await getWsMock();
      const { result } = renderHook(() => useConversation("ws-1"));

      act(() => {
        __wsMock.emit("ws-1", {
          type: "user_message",
          message: { id: "u1", sessionId: "sess-1", role: "user", content: "noop", timestamp: "2026-02-20T00:00:00.000Z" },
        });
        // Empty turn: the backend persists nothing and omits messageId, so its
        // absence is the single signal that no bubble should be appended.
        __wsMock.emit("ws-1", { type: "done", sessionId: "sess-1" });
      });

      // Only the user message remains; no empty assistant bubble.
      expect(result.current.messages).toHaveLength(1);
      expect(result.current.messages[0]?.role).toBe("user");
    });

    it("appends one deduped assistant bubble when done carries messageId", async () => {
      const { __wsMock } = await getWsMock();
      const { result } = renderHook(() => useConversation("ws-1"));

      act(() => {
        __wsMock.emit("ws-1", {
          type: "user_message",
          message: { id: "u1", sessionId: "sess-1", role: "user", content: "hi", timestamp: "2026-02-20T00:00:00.000Z" },
        });
        __wsMock.emit("ws-1", { type: "text_delta", sessionId: "sess-1", text: "hello back" });
        __wsMock.emit("ws-1", { type: "done", sessionId: "sess-1", messageId: "asst-1" });
      });

      const assistants = result.current.messages.filter((m) => m.role === "assistant");
      expect(assistants).toHaveLength(1);
      expect(assistants[0]).toMatchObject({ id: "asst-1", content: "hello back" });

      // A re-delivered done (e.g. after reconnect) must not double the bubble.
      act(() => {
        __wsMock.emit("ws-1", { type: "done", sessionId: "sess-1", messageId: "asst-1" });
      });
      expect(result.current.messages.filter((m) => m.role === "assistant")).toHaveLength(1);
    });
  });

  describe("live tool_result computes unified scalars once", () => {
    it("stores outputPreview/outputLineCount/outputByteLength/outputTruncated on the tool", async () => {
      const { __wsMock } = await getWsMock();
      const { result } = renderHook(() => useConversation("ws-1"));

      act(() => {
        __wsMock.emit("ws-1", {
          type: "user_message",
          message: { id: "u1", sessionId: "sess-1", role: "user", content: "grep", timestamp: "2026-02-20T00:00:00.000Z" },
        });
        __wsMock.emit("ws-1", { type: "tool_use", id: "g1", name: "Grep", input: "{}" });
      });

      act(() => {
        __wsMock.emit("ws-1", { type: "tool_result", toolUseId: "g1", output: "line1\nline2\nline3" });
      });

      const tool = result.current.activeToolCalls[0];
      expect(tool).toMatchObject({
        id: "g1",
        output: "line1\nline2\nline3",
        outputPreview: "line1\nline2\nline3",
        outputLineCount: 3,
        outputByteLength: 17,
        outputTruncated: false,
      });
    });

    it("computes a line count of 0 for empty output", async () => {
      const { __wsMock } = await getWsMock();
      const { result } = renderHook(() => useConversation("ws-1"));

      act(() => {
        __wsMock.emit("ws-1", {
          type: "user_message",
          message: { id: "u1", sessionId: "sess-1", role: "user", content: "x", timestamp: "2026-02-20T00:00:00.000Z" },
        });
        __wsMock.emit("ws-1", { type: "tool_use", id: "g1", name: "Bash", input: "{}" });
        __wsMock.emit("ws-1", { type: "tool_result", toolUseId: "g1", output: "" });
      });

      expect(result.current.activeToolCalls[0]).toMatchObject({
        outputPreview: "",
        outputLineCount: 0,
        outputTruncated: false,
      });
    });
  });

  describe("loadEarlier + hasMore", () => {
    it("prepends an older window and updates hasMore", async () => {
      const { __apiMock } = await getApiMock();
      // Initial window: one recent message, more exist before it.
      __apiMock.getMock.mockResolvedValueOnce(historyResponse([
        { id: "m2", sessionId: "sess-1", role: "assistant", content: "recent", timestamp: "2026-02-20T00:00:02.000Z" },
      ], true));

      const { result } = renderHook(() => useConversation("ws-1"));

      await waitFor(() => {
        expect(result.current.messages).toHaveLength(1);
      });
      expect(result.current.hasMore).toBe(true);

      // loadEarlier fetches the window before messages[0].
      __apiMock.getMock.mockResolvedValueOnce(historyResponse([
        { id: "m1", sessionId: "sess-1", role: "user", content: "older", timestamp: "2026-02-20T00:00:01.000Z" },
      ], false));

      await act(async () => {
        await result.current.loadEarlier();
      });

      expect(result.current.messages.map((m) => m.id)).toEqual(["m1", "m2"]);
      expect(result.current.hasMore).toBe(false);
      expect(__apiMock.getMock).toHaveBeenLastCalledWith(
        "/api/workspaces/ws-1/sessions/sess-1/messages?limit=200&before=m2",
      );
    });

    it("loadEarlier is a no-op when hasMore is false", async () => {
      const { __apiMock } = await getApiMock();
      __apiMock.getMock.mockResolvedValueOnce(historyResponse([
        { id: "m1", sessionId: "sess-1", role: "user", content: "only", timestamp: "2026-02-20T00:00:00.000Z" },
      ], false));

      const { result } = renderHook(() => useConversation("ws-1"));

      await waitFor(() => {
        expect(result.current.messages).toHaveLength(1);
      });
      expect(result.current.hasMore).toBe(false);
      __apiMock.getMock.mockClear();

      await act(async () => {
        await result.current.loadEarlier();
      });

      expect(__apiMock.getMock).not.toHaveBeenCalled();
      expect(result.current.messages).toHaveLength(1);
    });

    it("dedups overlapping ids when prepending an older window", async () => {
      const { __apiMock } = await getApiMock();
      __apiMock.getMock.mockResolvedValueOnce(historyResponse([
        { id: "m2", sessionId: "sess-1", role: "user", content: "b", timestamp: "2026-02-20T00:00:02.000Z" },
        { id: "m3", sessionId: "sess-1", role: "assistant", content: "c", timestamp: "2026-02-20T00:00:03.000Z" },
      ], true));

      const { result } = renderHook(() => useConversation("ws-1"));
      await waitFor(() => {
        expect(result.current.messages).toHaveLength(2);
      });

      // The older window overlaps on m2 (same id) and adds m1.
      __apiMock.getMock.mockResolvedValueOnce(historyResponse([
        { id: "m1", sessionId: "sess-1", role: "user", content: "a", timestamp: "2026-02-20T00:00:01.000Z" },
        { id: "m2", sessionId: "sess-1", role: "user", content: "b", timestamp: "2026-02-20T00:00:02.000Z" },
      ], false));

      await act(async () => {
        await result.current.loadEarlier();
      });

      expect(result.current.messages.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
    });
  });
});
