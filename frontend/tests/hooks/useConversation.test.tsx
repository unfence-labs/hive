import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useConversation, _resetSavedSessions } from "@/hooks/useConversation";
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
  const reconnectListeners = new Map<string, Set<() => void>>();
  const replayMessages = new Map<string, WsOutgoing[]>();
  const bufferedFlags = new Map<string, boolean>();
  const cachedHistories = new Map<string, WsOutgoing>();

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
      reconnectListeners.clear();
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
    updateCachedHistory: vi.fn((workspaceId: string, historyMsg: WsOutgoing) => {
      cachedHistories.set(workspaceId, historyMsg);
    }),
    hasCachedHistory: vi.fn((workspaceId: string) => cachedHistories.has(workspaceId)),
    clearCachedData: vi.fn((workspaceId: string) => {
      cachedHistories.delete(workspaceId);
      replayMessages.delete(workspaceId);
      bufferedFlags.delete(workspaceId);
    }),
  };

  const __wsMock = {
    emit: (workspaceId: string, msg: WsOutgoing) => {
      for (const handler of messageHandlers.get(workspaceId) ?? []) handler(msg);
    },
    reconnect: (workspaceId: string) => {
      for (const listener of reconnectListeners.get(workspaceId) ?? []) listener();
    },
    reset: () => {
      statuses.clear();
      messageHandlers.clear();
      statusListeners.clear();
      reconnectListeners.clear();
      replayMessages.clear();
      bufferedFlags.clear();
      cachedHistories.clear();
      wsTransport.connect.mockClear();
      wsTransport.disconnect.mockClear();
      wsTransport.syncWorkspaces.mockClear();
      wsTransport.disconnectAll.mockClear();
      wsTransport.send.mockClear();
      wsTransport.onMessage.mockClear();
      wsTransport.onReconnect.mockClear();
      wsTransport.updateCachedHistory.mockClear();
      wsTransport.hasCachedHistory.mockClear();
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
    updateCachedHistoryMock: wsTransport.updateCachedHistory,
    hasCachedHistoryMock: wsTransport.hasCachedHistory,
    setCachedHistory: (workspaceId: string, historyMsg: WsOutgoing) => {
      cachedHistories.set(workspaceId, historyMsg);
    },
  };

  return { wsTransport, __wsMock };
});

const getWsMock = async () =>
  (await import("@/lib/ws-transport")) as unknown as {
    __wsMock: {
      emit: (workspaceId: string, msg: WsOutgoing) => void;
      reconnect: (workspaceId: string) => void;
      reset: () => void;
      setReplay: (workspaceId: string, messages: WsOutgoing[]) => void;
      setBuffered: (workspaceId: string, value: boolean) => void;
      sendMock: ReturnType<typeof vi.fn>;
      connectMock: ReturnType<typeof vi.fn>;
      disconnectMock: ReturnType<typeof vi.fn>;
      updateCachedHistoryMock: ReturnType<typeof vi.fn>;
      hasCachedHistoryMock: ReturnType<typeof vi.fn>;
      setCachedHistory: (workspaceId: string, historyMsg: WsOutgoing) => void;
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
    expect(result.current.streamingStartedAt).toBeNull();
  });

  it("resyncs persisted session history on done to recover missed deltas", async () => {
    const { __wsMock } = await getWsMock();
    const { __apiMock } = await getApiMock();
    __apiMock.getMock.mockResolvedValueOnce([]);
    __apiMock.getMock.mockResolvedValueOnce([
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
    ]);

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
      __wsMock.emit("ws-1", { type: "done", sessionId: "sess-1" });
    });

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(2);
      expect(result.current.messages.at(-1)?.content).toBe("final answer from persistence");
    });
    expect(__apiMock.getMock).toHaveBeenNthCalledWith(2, "/api/workspaces/ws-1/sessions/sess-1/messages");
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
      __wsMock.emit("ws-1", { type: "done", sessionId: "sess-1" });
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
        sessionId: "sess-activity",
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
    __apiMock.getMock.mockResolvedValueOnce([
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
    ]);

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

  it("does not overwrite replayed buffered state when transport reports buffered messages", async () => {
    const { __wsMock } = await getWsMock();
    const { __apiMock } = await getApiMock();

    __wsMock.setReplay("ws-1", [{
      type: "history",
      sessionId: "sess-buffered",
      messages: [
        {
          id: "m-buffered",
          sessionId: "sess-buffered",
          role: "assistant",
          content: "latest from buffered websocket",
          timestamp: "2026-02-12T00:00:00.000Z",
        },
      ],
    }]);
    __wsMock.setBuffered("ws-1", true);

    __apiMock.getMock.mockResolvedValueOnce([
      {
        id: "m-stale",
        sessionId: "sess-buffered",
        role: "assistant",
        content: "stale from disk",
        timestamp: "2026-02-12T00:00:00.000Z",
      },
    ]);

    const { result } = renderHook(() => useConversation("ws-1"));

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(1);
    });
    expect(result.current.messages[0]?.content).toBe("latest from buffered websocket");

    await waitFor(() => {
      expect(__apiMock.getMock).toHaveBeenCalledWith("/api/workspaces/ws-1/session/messages");
    });
    expect(result.current.messages[0]?.content).toBe("latest from buffered websocket");
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

  it("rehydrates AskUserQuestion pending input from history when WS request event was missed", async () => {
    const { __apiMock } = await getApiMock();
    __apiMock.getMock.mockResolvedValueOnce([
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
    ]);

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
    __apiMock.getMock.mockResolvedValueOnce([
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
    ]);

    const { result } = renderHook(() => useConversation("ws-1"));

    await waitFor(() => {
      expect(result.current.pendingToolInputs).toHaveLength(1);
    });
    expect(result.current.pendingToolInputs[0]?.input).toEqual({});
  });

  it("rehydrates ExitPlanMode pending input from history when WS request event was missed", async () => {
    const { __apiMock } = await getApiMock();
    __apiMock.getMock.mockResolvedValueOnce([
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
    ]);

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

  it("clears stale pending tool inputs when history has no pending prompts", async () => {
    const { __wsMock } = await getWsMock();
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

    act(() => {
      __wsMock.emit("ws-1", { type: "status", status: "idle", sessionId: "sess-1", streaming: false });
      __wsMock.emit("ws-1", {
        type: "history",
        sessionId: "sess-1",
        messages: [
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
        ],
      });
    });

    expect(result.current.pendingToolInputs).toEqual([]);
  });

  it("keeps active pending tool inputs when a history event arrives during streaming", async () => {
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

    act(() => {
      __wsMock.emit("ws-1", {
        type: "history",
        sessionId: "sess-1",
        messages: [
          {
            id: "a1",
            sessionId: "sess-1",
            role: "assistant",
            content: "",
            timestamp: "2026-02-12T00:00:01.000Z",
            toolCalls: [
              {
                id: "tool-history",
                name: "AskUserQuestion",
                input: JSON.stringify({ questions: [{ question: "stale history" }] }),
              },
            ],
          },
        ],
      });
    });

    expect(result.current.pendingToolInputs).toEqual([
      expect.objectContaining({
        requestId: "req-live",
        toolUseId: "tool-live",
      }),
    ]);
  });

  it("switches sessions and loads specific session history", async () => {
    const { __apiMock } = await getApiMock();
    const { __wsMock } = await getWsMock();
    __apiMock.getMock.mockResolvedValueOnce([]);

    const { result } = renderHook(() => useConversation("ws-1"));

    await act(async () => {
      await result.current.switchSession("sess-2");
    });

    act(() => {
      __wsMock.emit("ws-1", {
        type: "history",
        sessionId: "sess-2",
        messages: [
          {
            id: "m-1",
            sessionId: "sess-2",
            role: "assistant",
            content: "loaded from target session",
            timestamp: "2026-02-12T00:00:01.000Z",
          },
        ],
      });
    });

    expect(__apiMock.getMock).toHaveBeenCalledTimes(1);
    expect(result.current.messages).toEqual([
      expect.objectContaining({ id: "m-1", content: "loaded from target session" }),
    ]);
    expect(result.current.sessionId).toBe("sess-2");
    expect(result.current.isStreaming).toBe(false);
  });

  it("keeps target session visible and sets an error when switch_session send fails", async () => {
    const { __wsMock } = await getWsMock();
    __wsMock.sendMock.mockReturnValueOnce(false);
    const { result } = renderHook(() => useConversation("ws-1"));

    act(() => {
      __wsMock.emit("ws-1", {
        type: "history",
        sessionId: "sess-old",
        messages: [
          {
            id: "m-old",
            sessionId: "sess-old",
            role: "assistant",
            content: "old",
            timestamp: "2026-02-12T00:00:00.000Z",
          },
        ],
      });
    });
    expect(result.current.messages).toHaveLength(1);

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
    const { __wsMock } = await getWsMock();
    __apiMock.getMock.mockResolvedValueOnce([]);

    const { result } = renderHook(() => useConversation("ws-1"));

    act(() => {
      void result.current.switchSession("sess-old");
    });

    await act(async () => {
      await result.current.switchSession("sess-new");
    });

    act(() => {
      __wsMock.emit("ws-1", {
        type: "history",
        sessionId: "sess-old",
        messages: [
          {
            id: "m-old",
            sessionId: "sess-old",
            role: "assistant",
            content: "stale payload",
            timestamp: "2026-02-12T00:00:03.000Z",
          },
        ],
      });
      __wsMock.emit("ws-1", {
        type: "history",
        sessionId: "sess-new",
        messages: [
          {
            id: "m-new",
            sessionId: "sess-new",
            role: "assistant",
            content: "new session payload",
            timestamp: "2026-02-12T00:00:02.000Z",
          },
        ],
      });
    });

    await waitFor(() => {
      expect(result.current.sessionId).toBe("sess-new");
    });
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
      __wsMock.emit("ws-1", { type: "done", sessionId: "sess-1" });
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
      __wsMock.emit("ws-1", { type: "done", sessionId: "sess-1", durationMs: 4500 });
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
    __apiMock.getMock.mockResolvedValue([]);
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
    __apiMock.getMock.mockResolvedValue([]);
    rerender({ wsId: "ws-2" });
    __wsMock.setReplay("ws-1", []);
    rerender({ wsId: "ws-1" });

    await waitFor(() => {
      expect(__apiMock.getMock).toHaveBeenCalledWith(
        "/api/workspaces/ws-1/sessions/sess-B/messages",
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

    // Pre-switch + post-switch text are both present
    expect(result.current.sessionId).toBe("sess-1");
    expect(result.current.currentStreamingText).toBe("Hello World");
    expect(result.current.isStreaming).toBe(true);
  });

  it("replaces accumulated stream content when a stream snapshot is replayed", async () => {
    const { __wsMock } = await getWsMock();
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
          content: "hello",
          timestamp: "2026-02-12T00:00:00.000Z",
        },
      });
      __wsMock.emit("ws-1", { type: "text_delta", sessionId: "sess-1", text: "Before " });
    });

    rerender({ wsId: "ws-2" });
    __wsMock.setReplay("ws-1", [
      { type: "status", status: "busy", sessionId: "sess-1", streaming: true },
      {
        type: "stream_snapshot",
        sessionId: "sess-1",
        text: "Before after",
        thinking: "Canonical thinking",
        toolCalls: [{
          id: "tool-1",
          name: "Read",
          input: "{}",
          output: "file contents",
        }],
        agentActivities: [{
          id: "plan-1",
          kind: "plan_update",
          steps: [{ text: "Inspect", status: "completed" }],
        }],
        agentPlanMode: true,
        streamingStartedAt: 1_700_000_002_000,
      },
    ]);

    rerender({ wsId: "ws-1" });

    expect(result.current.sessionId).toBe("sess-1");
    expect(result.current.currentStreamingText).toBe("Before after");
    expect(result.current.currentThinking).toBe("Canonical thinking");
    expect(result.current.activeToolCalls).toEqual([
      expect.objectContaining({ id: "tool-1", output: "file contents" }),
    ]);
    expect(result.current.activeAgentActivities).toEqual([
      expect.objectContaining({ id: "plan-1" }),
    ]);
    expect(result.current.agentPlanMode).toBe(true);
    expect(result.current.streamingStartedAt).toBe(1_700_000_002_000);
    expect(result.current.isStreaming).toBe(true);
  });

  it("keeps active stream visible after reconnect until final history arrives", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useConversation("ws-1"));

    act(() => {
      __wsMock.emit("ws-1", {
        type: "status",
        status: "busy",
        sessionId: "sess-1",
        streaming: true,
        streamingStartedAt: 1_700_000_003_000,
      });
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
      __wsMock.emit("ws-1", { type: "thinking", sessionId: "sess-1", text: "Thinking" });
      __wsMock.emit("ws-1", { type: "text_delta", sessionId: "sess-1", text: "Partial" });
      __wsMock.emit("ws-1", {
        type: "tool_use",
        sessionId: "sess-1",
        id: "tool-1",
        name: "Read",
        input: "{}",
      });
      __wsMock.emit("ws-1", {
        type: "agent_activity",
        sessionId: "sess-1",
        activity: {
          id: "cmd-1",
          kind: "command_execution",
          command: "npm test",
          status: "inProgress",
        },
      });
    });

    expect(result.current.workspaceStatus).toBe("busy");
    expect(result.current.isStreaming).toBe(true);
    expect(result.current.streamingStartedAt).toBe(1_700_000_003_000);
    expect(result.current.currentStreamingText).toBe("Partial");
    expect(result.current.currentThinking).toBe("Thinking");
    expect(result.current.activeToolCalls).toEqual([expect.objectContaining({ id: "tool-1" })]);
    expect(result.current.activeAgentActivities).toEqual([expect.objectContaining({ id: "cmd-1" })]);

    act(() => {
      __wsMock.reconnect("ws-1");
      __wsMock.emit("ws-1", {
        type: "status",
        status: "idle",
        sessionId: "sess-1",
        streaming: false,
        lockedProvider: "codex",
      });
    });

    expect(result.current.workspaceStatus).toBe("busy");
    expect(result.current.isStreaming).toBe(true);
    expect(result.current.streamingStartedAt).toBe(1_700_000_003_000);
    expect(result.current.currentStreamingText).toBe("Partial");
    expect(result.current.currentThinking).toBe("Thinking");
    expect(result.current.activeToolCalls).toEqual([expect.objectContaining({ id: "tool-1" })]);
    expect(result.current.activeAgentActivities).toEqual([expect.objectContaining({ id: "cmd-1" })]);
    expect(result.current.lockedProvider).toBeUndefined();

    act(() => {
      __wsMock.emit("ws-1", {
        type: "history",
        sessionId: "sess-1",
        messages: [
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
            content: "Final answer",
            timestamp: "2026-02-12T00:00:01.000Z",
          },
        ],
      });
    });

    expect(result.current.workspaceStatus).toBe("idle");
    expect(result.current.lockedProvider).toBe("codex");
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.streamingStartedAt).toBeNull();
    expect(result.current.currentStreamingText).toBe("");
    expect(result.current.currentThinking).toBe("");
    expect(result.current.activeToolCalls).toEqual([]);
    expect(result.current.activeAgentActivities).toEqual([]);
    expect(result.current.messages.map((message) => message.content)).toEqual(["start", "Final answer"]);
  });

  it("lets status finish reconnect resync when no visible stream is active", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useConversation("ws-1"));

    act(() => {
      __wsMock.emit("ws-1", {
        type: "status",
        status: "idle",
        sessionId: "sess-1",
        streaming: false,
      });
    });

    expect(result.current.workspaceStatus).toBe("idle");
    expect(result.current.isStreaming).toBe(false);

    act(() => {
      __wsMock.reconnect("ws-1");
      __wsMock.emit("ws-1", {
        type: "status",
        status: "idle",
        sessionId: "sess-1",
        streaming: false,
        lockedProvider: "codex",
      });
      __wsMock.emit("ws-1", {
        type: "status",
        status: "busy",
        sessionId: "sess-1",
        streaming: true,
        streamingStartedAt: 1_700_000_005_000,
      });
    });

    expect(result.current.workspaceStatus).toBe("busy");
    expect(result.current.lockedProvider).toBe("codex");
    expect(result.current.isStreaming).toBe(true);
    expect(result.current.streamingStartedAt).toBe(1_700_000_005_000);
  });

  it("keeps stream visible when history arrives before stream_snapshot during resync", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useConversation("ws-1"));

    act(() => {
      __wsMock.emit("ws-1", {
        type: "status",
        status: "busy",
        sessionId: "sess-1",
        streaming: true,
        streamingStartedAt: 1_700_000_004_000,
      });
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
      __wsMock.emit("ws-1", { type: "text_delta", sessionId: "sess-1", text: "Before " });
    });

    act(() => {
      __wsMock.reconnect("ws-1");
      __wsMock.emit("ws-1", {
        type: "status",
        status: "busy",
        sessionId: "sess-1",
        streaming: true,
        streamingStartedAt: 1_700_000_004_000,
      });
      __wsMock.emit("ws-1", {
        type: "history",
        sessionId: "sess-1",
        messages: [
          {
            id: "u1",
            sessionId: "sess-1",
            role: "user",
            content: "start",
            timestamp: "2026-02-12T00:00:00.000Z",
          },
        ],
      });
    });

    expect(result.current.workspaceStatus).toBe("busy");
    expect(result.current.isStreaming).toBe(true);
    expect(result.current.streamingStartedAt).toBe(1_700_000_004_000);
    expect(result.current.currentStreamingText).toBe("Before ");
    expect(result.current.messages.map((message) => message.content)).toEqual(["start"]);

    act(() => {
      __wsMock.emit("ws-1", {
        type: "stream_snapshot",
        sessionId: "sess-1",
        text: "Before after",
        thinking: "",
        toolCalls: [{
          id: "tool-1",
          name: "Read",
          input: "{}",
          output: "file contents",
        }],
        agentActivities: [],
        agentPlanMode: false,
        streamingStartedAt: 1_700_000_004_000,
      });
    });

    expect(result.current.isStreaming).toBe(true);
    expect(result.current.currentStreamingText).toBe("Before after");
    expect(result.current.activeToolCalls).toEqual([
      expect.objectContaining({ id: "tool-1", output: "file contents" }),
    ]);
  });

  it("finalizes preserved stream when done arrives during reconnect resync", async () => {
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
      __wsMock.emit("ws-1", { type: "text_delta", sessionId: "sess-1", text: "Preserved" });
      __wsMock.reconnect("ws-1");
      __wsMock.emit("ws-1", { type: "done", sessionId: "sess-1", durationMs: 123 });
    });

    expect(result.current.isStreaming).toBe(false);
    expect(result.current.currentStreamingText).toBe("");
    expect(result.current.messages.at(-1)).toEqual(
      expect.objectContaining({
        role: "assistant",
        content: "Preserved",
        durationMs: 123,
      }),
    );
  });

  it("does not flip the active idle session busy when a background session snapshot arrives", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useConversation("ws-1"));

    // Active session is idle.
    act(() => {
      __wsMock.emit("ws-1", {
        type: "status",
        status: "idle",
        sessionId: "sess-1",
        streaming: false,
      });
    });

    expect(result.current.sessionId).toBe("sess-1");
    expect(result.current.workspaceStatus).toBe("idle");

    // A different (background) session replays a streaming snapshot during bootstrap.
    act(() => {
      __wsMock.emit("ws-1", {
        type: "stream_snapshot",
        sessionId: "sess-2",
        text: "background work",
        thinking: "",
        toolCalls: [],
        agentActivities: [],
        agentPlanMode: false,
        streamingStartedAt: 1_700_000_006_000,
      });
    });

    // Active session must stay idle so queued-message auto-dequeue is not blocked.
    expect(result.current.workspaceStatus).toBe("idle");
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.currentStreamingText).toBe("");
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

    expect(result.current.currentStreamingText).toBe("Before ");

    // Switch to ws-2 while streaming is in progress
    rerender({ wsId: "ws-2" });

    // Switch back — buffer replays remaining deltas + done
    __wsMock.setReplay("ws-1", [
      { type: "status", status: "busy", sessionId: "sess-1", streaming: true },
      { type: "text_delta", sessionId: "sess-1", text: "after" },
      { type: "done", sessionId: "sess-1", durationMs: 1234 },
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
      __wsMock.emit("ws-1", { type: "done", sessionId: "sess-1", durationMs: 100 });
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

  it("preserves streamingStartedAt on same-session history while streaming", async () => {
    const { __wsMock } = await getWsMock();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_001_666);
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
      __wsMock.emit("ws-1", {
        type: "history",
        sessionId: "sess-1",
        messages: [
          {
            id: "u1",
            sessionId: "sess-1",
            role: "user",
            content: "hello",
            timestamp: "2026-02-12T00:00:00.000Z",
          },
        ],
      });
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
    __apiMock.getMock.mockResolvedValueOnce([]);
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
    __apiMock.getMock.mockResolvedValueOnce([]);
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

  describe("transport cache freshness", () => {
    it("updates transport cache when messages change after done event", async () => {
      const { __wsMock } = await getWsMock();

      const { result } = renderHook(() => useConversation("ws-1"));

      await act(async () => {
        __wsMock.emit("ws-1", { type: "status", status: "busy", sessionId: "sess-1", streaming: true });
        __wsMock.emit("ws-1", {
          type: "user_message",
          message: { id: "u1", sessionId: "sess-1", role: "user", content: "hello", timestamp: "2026-02-20T00:00:00.000Z" },
        });
        __wsMock.emit("ws-1", { type: "text_delta", sessionId: "sess-1", text: "hi back" });
        __wsMock.emit("ws-1", { type: "done", sessionId: "sess-1", durationMs: 100 });
      });

      // After done, messages should have both user + assistant messages.
      // The cache-update effect should have pushed them to the transport.
      expect(result.current.messages).toHaveLength(2);
      expect(__wsMock.updateCachedHistoryMock).toHaveBeenCalled();
      const lastCall = __wsMock.updateCachedHistoryMock.mock.calls.at(-1)!;
      expect(lastCall[0]).toBe("ws-1");
      expect(lastCall[1].type).toBe("history");
      expect(lastCall[1].sessionId).toBe("sess-1");
      expect(lastCall[1].messages).toHaveLength(2);
    });

    it("does not update cache with empty messages during workspace switch", async () => {
      const { __wsMock } = await getWsMock();

      const { result, rerender } = renderHook(
        ({ wsId }) => useConversation(wsId),
        { initialProps: { wsId: "ws-1" } },
      );

      // Populate messages for ws-1
      await act(async () => {
        __wsMock.emit("ws-1", { type: "status", status: "idle", sessionId: "sess-1", streaming: false });
        __wsMock.emit("ws-1", {
          type: "history",
          sessionId: "sess-1",
          messages: [{ id: "m1", sessionId: "sess-1", role: "user", content: "hi", timestamp: "2026-02-20T00:00:00.000Z" }],
        });
      });

      expect(result.current.messages).toHaveLength(1);
      __wsMock.updateCachedHistoryMock.mockClear();

      // Switch to ws-2 — messages clear, cache should NOT be overwritten with empty
      rerender({ wsId: "ws-2" });

      // Check that no call was made with empty messages for ws-1
      for (const call of __wsMock.updateCachedHistoryMock.mock.calls) {
        expect(call[1].messages.length).toBeGreaterThan(0);
      }
    });

    it("skips cache write on first effect cycle after workspace switch to prevent cross-workspace pollution", async () => {
      const { __wsMock } = await getWsMock();

      const { result, rerender } = renderHook(
        ({ wsId }) => useConversation(wsId),
        { initialProps: { wsId: "ws-1" } },
      );

      // Populate ws-1 with messages
      await act(async () => {
        __wsMock.emit("ws-1", { type: "status", status: "idle", sessionId: "sess-1", streaming: false });
        __wsMock.emit("ws-1", {
          type: "history",
          sessionId: "sess-1",
          messages: [{ id: "m1", sessionId: "sess-1", role: "user", content: "ws-1 msg", timestamp: "2026-02-20T00:00:00.000Z" }],
        });
      });

      expect(result.current.messages).toHaveLength(1);
      __wsMock.updateCachedHistoryMock.mockClear();

      // Switch to ws-2 — React 18 batching may transiently leave state.messages
      // holding ws-1's messages while workspaceId is already ws-2. The guard
      // (prevCacheWorkspaceRef) should prevent writing ws-1's messages into ws-2's cache.
      rerender({ wsId: "ws-2" });

      const ws2CacheCalls = __wsMock.updateCachedHistoryMock.mock.calls.filter(
        ([wsId]: [string]) => wsId === "ws-2",
      );
      expect(ws2CacheCalls).toHaveLength(0);
    });

    it("skips REST fetch when transport has cached history", async () => {
      const { __wsMock } = await getWsMock();
      const { __apiMock } = await getApiMock();
      __apiMock.getMock.mockResolvedValue([]);

      // Pre-populate the cache so hasCachedHistory returns true
      __wsMock.setCachedHistory("ws-1", {
        type: "history",
        sessionId: "sess-1",
        messages: [{ id: "m1", sessionId: "sess-1", role: "user", content: "cached", timestamp: "2026-02-20T00:00:00.000Z" }],
      });

      renderHook(() => useConversation("ws-1"));

      // REST should NOT have been called since cache exists
      expect(__apiMock.getMock).not.toHaveBeenCalled();
    });

    it("fires REST fetch on first visit when no cached history exists", async () => {
      const { __apiMock } = await getApiMock();
      __apiMock.getMock.mockReturnValue(new Promise<ChatMessage[]>(() => {}));

      renderHook(() => useConversation("ws-1"));

      // REST should fire since there's no cached history
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
          sessionId: "sess-1",
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
          sessionId: "sess-1",
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
        __wsMock.emit("ws-1", { type: "done", sessionId: "sess-1" });
      });

      const assistant = result.current.messages.at(-1);
      expect(assistant?.role).toBe("assistant");
      expect(assistant?.inputTokens).toBeUndefined();
      expect(assistant?.outputTokens).toBeUndefined();
    });
  });
});
