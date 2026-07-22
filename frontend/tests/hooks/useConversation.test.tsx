import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useConversation, _resetSavedSessions, setSavedSession } from "@/hooks/useConversation";
import { sessionMessagesKey, getCachedSessionMessages } from "@/hooks/useSessionMessages";
import { _resetOptimisticSends } from "@/lib/optimistic-sends";
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
  const bufferedFlags = new Map<string, boolean>();

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
    send: vi.fn(() => true),
    requestStreamSnapshots: vi.fn(),
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
    onReconnect: vi.fn(() => {
      return () => {};
    }),
    subscribe: (workspaceId: string, listener: () => void) => {
      getSet(statusListeners, workspaceId).add(listener);
      return () => {
        getSet(statusListeners, workspaceId).delete(listener);
      };
    },
    getStatus: (workspaceId: string) => statuses.get(workspaceId) ?? "disconnected",
    clearCachedData: vi.fn((workspaceId: string) => {
      replayMessages.delete(workspaceId);
      bufferedFlags.delete(workspaceId);
    }),
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
      bufferedFlags.clear();
      wsTransport.connect.mockClear();
      wsTransport.disconnect.mockClear();
      wsTransport.syncWorkspaces.mockClear();
      wsTransport.disconnectAll.mockClear();
      wsTransport.send.mockClear();
      wsTransport.requestStreamSnapshots.mockClear();
      wsTransport.onMessage.mockClear();
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
    requestStreamSnapshotsMock: wsTransport.requestStreamSnapshots,
  };

  return { wsTransport, __wsMock };
});

const getWsMock = async () =>
  (await import("@/lib/ws-transport")) as unknown as {
    __wsMock: {
      emit: (workspaceId: string, msg: WsOutgoing) => void;
      reset: () => void;
      setReplay: (workspaceId: string, messages: WsOutgoing[]) => void;
      setBuffered: (workspaceId: string, value: boolean) => void;
      sendMock: ReturnType<typeof vi.fn>;
      connectMock: ReturnType<typeof vi.fn>;
      disconnectMock: ReturnType<typeof vi.fn>;
      requestStreamSnapshotsMock: ReturnType<typeof vi.fn>;
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
 * Render useConversation inside a fresh QueryClientProvider. Finalized messages
 * are owned by React Query now, so the hook calls useQueryClient(); without a
 * provider it throws. Returns the renderHook result plus the queryClient so
 * tests can pre-seed / inspect the session-messages cache directly.
 */
function renderConversation(
  initialWsId?: string,
): ReturnType<typeof renderHook<ReturnType<typeof useConversation>, { wsId?: string }>> & {
  queryClient: QueryClient;
} {
  const queryClient = new QueryClient({
    // Mirror the production default staleTime (query-client.ts) so the session
    // messages query — which now inherits it instead of forcing its own — keeps
    // its "fresh cache renders without refetch" behavior under test.
    defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: 5 * 60 * 1000 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const result = renderHook(({ wsId }: { wsId?: string }) => useConversation(wsId), {
    wrapper,
    initialProps: { wsId: initialWsId },
  });
  return { ...result, queryClient };
}

/**
 * Drive a session active by emitting an (idle) status event. The REST messages
 * query is `enabled` only once sessionId is set, so tests that load finalized
 * history over REST must first activate the session this way.
 */
async function activateSession(workspaceId: string, sessionId: string): Promise<void> {
  const { __wsMock } = await getWsMock();
  act(() => {
    __wsMock.emit(workspaceId, { type: "status", status: "idle", sessionId, streaming: false });
  });
}

describe("useConversation", () => {
  beforeEach(async () => {
    const { __wsMock } = await getWsMock();
    const { __apiMock } = await getApiMock();
    __wsMock.reset();
    __apiMock.reset();
    _resetSavedSessions();
    _resetOptimisticSends();
  });

  it("connects on mount and keeps connection alive on unmount", async () => {
    const { __wsMock } = await getWsMock();
    const { unmount } = renderConversation("ws-1");

    expect(__wsMock.connectMock).toHaveBeenCalledWith("ws-1");

    unmount();

    expect(__wsMock.disconnectMock).not.toHaveBeenCalled();
  });

  it("requests a targeted stream-snapshot replay for the mounted workspace so a mid-stream turn is recovered", async () => {
    const { __wsMock } = await getWsMock();
    const { rerender } = renderConversation("ws-1");

    // Frames streamed while this view was unmounted are unrecoverable (the
    // app-level cache hooks consume them), so mounting must ask the backend
    // to replay the streaming snapshot -- scoped to just the opened workspace.
    expect(__wsMock.requestStreamSnapshotsMock).toHaveBeenCalledTimes(1);
    expect(__wsMock.requestStreamSnapshotsMock).toHaveBeenNthCalledWith(1, "ws-1");

    rerender({ wsId: "ws-2" });

    expect(__wsMock.requestStreamSnapshotsMock).toHaveBeenCalledTimes(2);
    expect(__wsMock.requestStreamSnapshotsMock).toHaveBeenNthCalledWith(2, "ws-2");
  });

  it("applies a stream_snapshot arriving after mount to the live stream state", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderConversation("ws-1");

    act(() => {
      __wsMock.emit("ws-1", {
        type: "stream_snapshot",
        sessionId: "sess-1",
        text: "already streamed text",
        thinking: "",
        toolCalls: [
          { id: "t1", name: "Read", input: "{}" },
          { id: "t2", name: "Bash", input: "{}" },
        ],
        agentActivities: [],
        agentPlanMode: false,
      });
    });

    expect(result.current.isStreaming).toBe(true);
    expect(result.current.currentStreamingText).toBe("already streamed text");
    expect(result.current.activeToolCalls).toHaveLength(2);
  });

  it("sends user messages through transport without optimistic append when no session is active", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderConversation("ws-1");

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
    const { result } = renderConversation("ws-1");

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
    const { result } = renderConversation("ws-1");

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
    const { result } = renderConversation("ws-1");

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
    const { result } = renderConversation("ws-1");

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
    const { result } = renderConversation("ws-1");

    act(() => {
      const sent = result.current.sendMessage("hello");
      expect(sent).toBe(false);
    });

    expect(result.current.messages).toHaveLength(0);
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.error).toContain("Message not sent");
  });

  describe("optimistic sends", () => {
    it("appends the user message immediately with a sending state when a session is active", async () => {
      const { __wsMock } = await getWsMock();
      const { result } = renderConversation("ws-1");
      await activateSession("ws-1", "sess-1");

      act(() => {
        expect(result.current.sendMessage("hello")).toBe(true);
      });

      expect(result.current.messages).toHaveLength(1);
      const local = result.current.messages[0]!;
      expect(local.role).toBe("user");
      expect(local.content).toBe("hello");
      expect(local.id.startsWith("local-")).toBe(true);
      expect(result.current.sendStates[local.id]).toBe("sending");
      expect(__wsMock.sendMock).toHaveBeenCalledWith("ws-1", {
        type: "user_message",
        content: "hello",
        sessionId: "sess-1",
      });
    });

    it("swaps the local message for the server echo and clears the send state", async () => {
      const { __wsMock } = await getWsMock();
      const { result } = renderConversation("ws-1");
      await activateSession("ws-1", "sess-1");

      act(() => {
        result.current.sendMessage("hello");
      });
      const localId = result.current.messages[0]!.id;

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
      expect(result.current.messages[0]?.id).toBe("u1");
      expect(result.current.sendStates[localId]).toBeUndefined();
    });

    it("keeps the message in the transcript as failed when the transport send fails", async () => {
      const { __wsMock } = await getWsMock();
      const { result } = renderConversation("ws-1");
      await activateSession("ws-1", "sess-1");
      __wsMock.sendMock.mockReturnValueOnce(false);

      act(() => {
        // The message is handled by the transcript (failed + retry), so the
        // composer/queue must treat the send as consumed.
        expect(result.current.sendMessage("hello")).toBe(true);
      });

      expect(result.current.messages).toHaveLength(1);
      const local = result.current.messages[0]!;
      expect(result.current.sendStates[local.id]).toBe("failed");
      expect(result.current.error).toBeUndefined();
    });

    it("retries a failed send through the transport and resolves on the echo", async () => {
      const { __wsMock } = await getWsMock();
      const { result } = renderConversation("ws-1");
      await activateSession("ws-1", "sess-1");
      __wsMock.sendMock.mockReturnValueOnce(false);

      act(() => {
        result.current.sendMessage("hello", undefined, { planMode: true });
      });
      const localId = result.current.messages[0]!.id;
      expect(result.current.sendStates[localId]).toBe("failed");

      act(() => {
        result.current.retrySend(localId);
      });

      expect(result.current.sendStates[localId]).toBe("sending");
      expect(__wsMock.sendMock).toHaveBeenLastCalledWith("ws-1", {
        type: "user_message",
        content: "hello",
        images: undefined,
        fileMentions: undefined,
        options: { planMode: true },
        sessionId: "sess-1",
      });

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

      expect(result.current.messages).toEqual([expect.objectContaining({ id: "u1" })]);
      expect(result.current.sendStates[localId]).toBeUndefined();
    });

    it("stays failed when the retry send fails again", async () => {
      const { __wsMock } = await getWsMock();
      const { result } = renderConversation("ws-1");
      await activateSession("ws-1", "sess-1");
      __wsMock.sendMock.mockReturnValue(false);

      act(() => {
        result.current.sendMessage("hello");
      });
      const localId = result.current.messages[0]!.id;

      act(() => {
        result.current.retrySend(localId);
      });

      expect(result.current.sendStates[localId]).toBe("failed");
      expect(result.current.messages).toHaveLength(1);
      __wsMock.sendMock.mockReturnValue(true);
    });

    it("discards a failed send, removing it from the transcript", async () => {
      const { __wsMock } = await getWsMock();
      const { result } = renderConversation("ws-1");
      await activateSession("ws-1", "sess-1");
      __wsMock.sendMock.mockReturnValueOnce(false);

      act(() => {
        result.current.sendMessage("hello");
      });
      const localId = result.current.messages[0]!.id;

      act(() => {
        result.current.discardSend(localId);
      });

      expect(result.current.messages).toHaveLength(0);
      expect(result.current.sendStates[localId]).toBeUndefined();
    });

    it("appends a non-matching echo without touching a pending send", async () => {
      const { __wsMock } = await getWsMock();
      const { result } = renderConversation("ws-1");
      await activateSession("ws-1", "sess-1");

      act(() => {
        result.current.sendMessage("mine");
      });
      const localId = result.current.messages[0]!.id;

      // Echo from another client with different content must not resolve ours.
      act(() => {
        __wsMock.emit("ws-1", {
          type: "user_message",
          message: {
            id: "u-other",
            sessionId: "sess-1",
            role: "user",
            content: "someone else's message",
            timestamp: "2026-02-12T00:00:00.000Z",
          },
        });
      });

      expect(result.current.messages).toHaveLength(2);
      expect(result.current.sendStates[localId]).toBe("sending");
    });
  });

  it("builds assistant message from stream deltas and done event", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderConversation("ws-1");

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
    });
    // `done` finalizes from the live stream slot the WS handler reads via stateRef,
    // which only reflects the deltas after a render flush — emit it separately.
    act(() => {
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
    // The authoritative server copy holds the finalized turns the client never
    // saw streamed; the done-driven refetch must surface them.
    __apiMock.getMock.mockResolvedValue([
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

    const { result } = renderConversation("ws-1");

    // user_message activates the session and seeds the (optimistic) user bubble.
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

    // No text_delta received (simulates session unfocused while streaming). On done
    // the WS handler invalidates the session messages, forcing the authoritative
    // refetch that recovers the finalized assistant turn from persistence.
    act(() => {
      __wsMock.emit("ws-1", { type: "done", sessionId: "sess-1" });
    });

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(2);
      expect(result.current.messages.at(-1)?.content).toBe("final answer from persistence");
    });
    expect(__apiMock.getMock).toHaveBeenCalledWith("/api/workspaces/ws-1/sessions/sess-1/messages");
  });

  it("resyncs persisted history when only idle status is observed after a stream", async () => {
    const { __wsMock } = await getWsMock();
    const { __apiMock } = await getApiMock();
    const userMessage: ChatMessage = {
      id: "u1",
      sessionId: "sess-1",
      role: "user",
      content: "start",
      timestamp: "2026-02-12T00:00:00.000Z",
    };
    const assistantMessage: ChatMessage = {
      id: "a1",
      sessionId: "sess-1",
      role: "assistant",
      content: "final answer from persistence",
      timestamp: "2026-02-12T00:00:01.000Z",
      toolCalls: [
        { id: "task-1", name: "Task", input: JSON.stringify({ prompt: "Review" }), output: "done" },
      ],
    };
    __apiMock.getMock
      .mockResolvedValueOnce([userMessage])
      .mockResolvedValueOnce([userMessage, assistantMessage]);

    const { result } = renderConversation("ws-1");

    act(() => {
      __wsMock.emit("ws-1", { type: "user_message", message: userMessage });
    });

    await waitFor(() => {
      expect(result.current.messages).toEqual([expect.objectContaining({ id: "u1" })]);
    });

    act(() => {
      __wsMock.emit("ws-1", {
        type: "tool_use",
        sessionId: "sess-1",
        id: "task-1",
        name: "Task",
        input: JSON.stringify({ prompt: "Review" }),
      });
    });
    expect(result.current.activeToolCalls).toHaveLength(1);

    // Simulates a hidden/zombie client that misses the terminal `done` event and
    // later receives only the idle status from reconnect/bootstrap.
    act(() => {
      __wsMock.emit("ws-1", { type: "status", status: "idle", sessionId: "sess-1", streaming: false });
    });

    await waitFor(() => {
      expect(result.current.messages).toEqual([
        expect.objectContaining({ id: "u1" }),
        expect.objectContaining({ id: "a1", content: "final answer from persistence" }),
      ]);
    });
    expect(result.current.activeToolCalls).toEqual([]);
    expect(result.current.isStreaming).toBe(false);
    expect(__apiMock.getMock).toHaveBeenCalledTimes(2);
  });

  it("retries idle-status history resync when the first REST response is still stale", async () => {
    const { __wsMock } = await getWsMock();
    const { __apiMock } = await getApiMock();
    const userMessage: ChatMessage = {
      id: "u1",
      sessionId: "sess-1",
      role: "user",
      content: "start",
      timestamp: "2026-02-12T00:00:00.000Z",
    };
    const assistantMessage: ChatMessage = {
      id: "a1",
      sessionId: "sess-1",
      role: "assistant",
      content: "final answer from persistence",
      timestamp: "2026-02-12T00:00:01.000Z",
      toolCalls: [
        { id: "task-1", name: "Task", input: JSON.stringify({ prompt: "Review" }), output: "done" },
      ],
    };
    __apiMock.getMock
      .mockResolvedValueOnce([userMessage])
      .mockResolvedValueOnce([userMessage])
      .mockResolvedValueOnce([userMessage, assistantMessage]);

    const { result, queryClient } = renderConversation("ws-1");

    act(() => {
      __wsMock.emit("ws-1", { type: "status", status: "idle", sessionId: "sess-1", streaming: false });
    });

    await waitFor(() => {
      expect(__apiMock.getMock).toHaveBeenCalledTimes(1);
      expect(queryClient.isFetching({ queryKey: sessionMessagesKey("ws-1", "sess-1") })).toBe(0);
    });

    act(() => {
      __wsMock.emit("ws-1", { type: "user_message", message: userMessage });
    });

    await waitFor(() => {
      expect(result.current.messages).toEqual([expect.objectContaining({ id: "u1" })]);
    });

    act(() => {
      __wsMock.emit("ws-1", {
        type: "tool_use",
        sessionId: "sess-1",
        id: "task-1",
        name: "Task",
        input: JSON.stringify({ prompt: "Review" }),
      });
    });
    expect(result.current.activeToolCalls).toHaveLength(1);

    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      act(() => {
        __wsMock.emit("ws-1", { type: "status", status: "idle", sessionId: "sess-1", streaming: false });
      });

      await waitFor(() => {
        expect(__apiMock.getMock).toHaveBeenCalledTimes(2);
        expect(queryClient.isFetching({ queryKey: sessionMessagesKey("ws-1", "sess-1") })).toBe(0);
      });
      expect(result.current.messages).toEqual([expect.objectContaining({ id: "u1" })]);
      expect(result.current.messages.some((message) => message.id === "a1")).toBe(false);
      expect(result.current.activeToolCalls).toEqual([expect.objectContaining({ id: "task-1", name: "Task" })]);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });

      await waitFor(() => {
        expect(result.current.messages).toEqual([
          expect.objectContaining({ id: "u1" }),
          expect.objectContaining({ id: "a1", content: "final answer from persistence" }),
        ]);
        expect(result.current.activeToolCalls).toEqual([]);
      });
    } finally {
      vi.useRealTimers();
    }
    expect(__apiMock.getMock).toHaveBeenCalledTimes(3);
    expect(result.current.activeToolCalls).toEqual([]);
  });

  it("preserves parentToolUseId from tool_use events in active and persisted tool calls", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderConversation("ws-1");

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
    const { result } = renderConversation("ws-1");

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
    });
    // `cancelled` finalizes from the stream slot read via stateRef — separate act
    // so the delta is reflected before finalization.
    act(() => {
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
    const { result } = renderConversation("ws-1");

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
    const { result } = renderConversation("ws-1");

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
    const { result } = renderConversation("ws-1");

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
    const { result } = renderConversation("ws-1");

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
    const { result, queryClient } = renderConversation("ws-1");

    // The session's persisted history ends on an open AskUserQuestion, so the
    // pending question is consistent with REST (reconcile keeps it rather than
    // dropping it as a stale finished slot).
    queryClient.setQueryData(sessionMessagesKey("ws-1", "sess-1"), [
      {
        id: "a1",
        sessionId: "sess-1",
        role: "assistant",
        content: "",
        timestamp: "2026-02-12T00:00:01.000Z",
        toolCalls: [
          { id: "tool-1", name: "AskUserQuestion", input: JSON.stringify({ questions: [{ question: "Q1" }] }) },
        ],
      },
    ]);

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
    const { result, queryClient } = renderConversation("ws-1");

    queryClient.setQueryData(sessionMessagesKey("ws-1", "sess-1"), [
      {
        id: "a1",
        sessionId: "sess-1",
        role: "assistant",
        content: "",
        timestamp: "2026-02-12T00:00:01.000Z",
        toolCalls: [
          { id: "tool-1", name: "AskUserQuestion", input: JSON.stringify({ questions: [{ question: "Q1" }] }) },
        ],
      },
    ]);

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
    const { result } = renderConversation("ws-1");

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
    const { result } = renderConversation("ws-1");

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
    const { result } = renderConversation("ws-1");

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
    const { result } = renderConversation("ws-1");

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

    const { result } = renderConversation("ws-1");
    await activateSession("ws-1", "sess-history-activity");

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
    const { result } = renderConversation("ws-1");

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
    const { result } = renderConversation("ws-1");

    act(() => {
      // A live (streaming) session keeps its in-flight pending input authoritative;
      // reconcile_history leaves it untouched so the live requestId is preserved.
      __wsMock.emit("ws-1", {
        type: "status",
        status: "busy",
        sessionId: "sess-42",
        streaming: true,
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

  it("hydrates persisted history from REST and ignores a stale WS history replay", async () => {
    const { __wsMock } = await getWsMock();
    const { __apiMock } = await getApiMock();

    // A stale WS `history` event must no longer feed the conversation — history is
    // owned by REST. Replaying it should be a no-op.
    __wsMock.setReplay("ws-1", [{
      type: "history",
      sessionId: "sess-1",
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

    __apiMock.getMock.mockResolvedValue([
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

    const { result } = renderConversation("ws-1");
    await activateSession("ws-1", "sess-1");

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(2);
    });
    expect(result.current.messages[0]?.role).toBe("user");
    expect(result.current.messages[0]?.content).toBe("hello");
    expect(result.current.messages[1]?.role).toBe("assistant");
    expect(result.current.messages[1]?.content).toBe("world");
  });

  it("loads finalized history over REST for the active session", async () => {
    const { __apiMock } = await getApiMock();

    __apiMock.getMock.mockResolvedValue([
      {
        id: "m-disk",
        sessionId: "sess-buffered",
        role: "assistant",
        content: "loaded from disk over REST",
        timestamp: "2026-02-12T00:00:00.000Z",
      },
    ]);

    const { result } = renderConversation("ws-1");
    await activateSession("ws-1", "sess-buffered");

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(1);
    });
    expect(result.current.messages[0]?.content).toBe("loaded from disk over REST");

    expect(__apiMock.getMock).toHaveBeenCalledWith(
      "/api/workspaces/ws-1/sessions/sess-buffered/messages",
    );
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

    const { result, queryClient } = renderConversation("ws-1");

    await activateSession("ws-1", "sess-1");
    await waitFor(() => {
      expect(__apiMock.getMock).toHaveBeenCalledWith(
        "/api/workspaces/ws-1/sessions/sess-1/messages",
      );
    });

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
    expect(result.current.messages).toEqual([
      expect.objectContaining({ id: "u1", content: "hello" }),
    ]);
    expect(getCachedSessionMessages(queryClient, "ws-1", "sess-1")).toEqual([
      expect.objectContaining({ id: "u1", content: "hello" }),
    ]);

    await act(async () => {
      resolveHistory?.([]);
    });

    await waitFor(() => {
      expect(getCachedSessionMessages(queryClient, "ws-1", "sess-1")).toEqual([
        expect.objectContaining({ id: "u1", content: "hello" }),
      ]);
    });
  });

  it("targets the restored saved session and loads its REST history", async () => {
    const { __apiMock } = await getApiMock();
    __apiMock.getMock.mockResolvedValue([
      {
        id: "u1",
        sessionId: "sess-hydrated",
        role: "user",
        content: "hello",
        timestamp: "2026-02-12T00:00:00.000Z",
      },
    ]);

    // The session to restore is established by the saved-session memory (set by a
    // prior visit), not by a WS history payload — sessionId drives the REST query.
    setSavedSession("ws-1", "sess-hydrated");
    const { result } = renderConversation("ws-1");

    expect(result.current.sessionId).toBe("sess-hydrated");
    await waitFor(() => {
      expect(result.current.messages).toHaveLength(1);
    });
    expect(result.current.messages[0]?.content).toBe("hello");
    expect(__apiMock.getMock).toHaveBeenCalledWith(
      "/api/workspaces/ws-1/sessions/sess-hydrated/messages",
    );
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

    const { result } = renderConversation("ws-1");
    await activateSession("ws-1", "sess-q");

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

    const { result } = renderConversation("ws-1");
    await activateSession("ws-1", "sess-q");

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

    const { result } = renderConversation("ws-1");
    await activateSession("ws-1", "sess-plan");

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

  it("clears stale pending tool inputs when REST history has no pending prompts", async () => {
    const { __wsMock } = await getWsMock();
    const { __apiMock } = await getApiMock();
    // Authoritative history: the turn finished with no open question.
    __apiMock.getMock.mockResolvedValue([
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
    ]);

    const { result } = renderConversation("ws-1");

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

    // The turn ends and the REST history (no open prompt) reconciles the slot,
    // dropping the stale pending question via the reconcile_history effect.
    act(() => {
      __wsMock.emit("ws-1", { type: "status", status: "idle", sessionId: "sess-1", streaming: false });
    });

    await waitFor(() => {
      expect(result.current.pendingToolInputs).toEqual([]);
    });
  });

  it("keeps active pending tool inputs when a history event arrives during streaming", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderConversation("ws-1");

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

  it("switches sessions and loads specific session history over REST", async () => {
    const { __apiMock } = await getApiMock();
    const { __wsMock } = await getWsMock();
    __apiMock.getMock.mockResolvedValue([
      {
        id: "m-1",
        sessionId: "sess-2",
        role: "assistant",
        content: "loaded from target session",
        timestamp: "2026-02-12T00:00:01.000Z",
      },
    ]);

    const { result } = renderConversation("ws-1");

    act(() => {
      result.current.switchSession("sess-2");
    });

    // switchSession re-keys the REST query, which fetches the target session.
    expect(__wsMock.sendMock).toHaveBeenCalledWith("ws-1", {
      type: "switch_session",
      sessionId: "sess-2",
    });
    await waitFor(() => {
      expect(result.current.messages).toEqual([
        expect.objectContaining({ id: "m-1", content: "loaded from target session" }),
      ]);
    });
    expect(__apiMock.getMock).toHaveBeenCalledWith("/api/workspaces/ws-1/sessions/sess-2/messages");
    expect(result.current.sessionId).toBe("sess-2");
    expect(result.current.isStreaming).toBe(false);
  });

  it("surfaces REST history errors for the active session", async () => {
    const { __apiMock } = await getApiMock();
    __apiMock.getMock.mockRejectedValue(new Error("network down"));

    const { result } = renderConversation("ws-1");

    act(() => {
      result.current.switchSession("sess-2");
    });

    await waitFor(() => {
      expect(result.current.error).toBe("Failed to load conversation history: network down");
    });
    expect(result.current.isHistoryError).toBe(true);
    expect(result.current.messages).toEqual([]);
  });

  it("restores cached messages synchronously when switching to a previously-viewed session", async () => {
    const { __wsMock } = await getWsMock();
    const { result, queryClient } = renderConversation("ws-1");

    // A previously-viewed session is already in the React Query cache, so its
    // messages render instantly on switch-back (no WS round-trip / empty flash).
    queryClient.setQueryData(sessionMessagesKey("ws-1", "sess-2"), [
      {
        id: "cached-1",
        sessionId: "sess-2",
        role: "assistant",
        content: "restored instantly",
        timestamp: "2026-02-12T00:00:01.000Z",
      },
    ]);

    act(() => {
      result.current.switchSession("sess-2");
    });

    expect(result.current.sessionId).toBe("sess-2");
    expect(result.current.messages).toEqual([
      expect.objectContaining({ id: "cached-1", content: "restored instantly" }),
    ]);
    // It still asks the backend to reconcile the live state.
    expect(__wsMock.sendMock).toHaveBeenCalledWith("ws-1", {
      type: "switch_session",
      sessionId: "sess-2",
    });
  });

  it("keeps target session visible and sets an error when switch_session send fails", async () => {
    const { __wsMock } = await getWsMock();
    const { result, queryClient } = renderConversation("ws-1");

    // Seed an existing session's REST messages, then activate it.
    queryClient.setQueryData(sessionMessagesKey("ws-1", "sess-old"), [
      {
        id: "m-old",
        sessionId: "sess-old",
        role: "assistant",
        content: "old",
        timestamp: "2026-02-12T00:00:00.000Z",
      },
    ]);
    act(() => {
      __wsMock.emit("ws-1", { type: "status", status: "busy", sessionId: "sess-old", streaming: false });
    });
    expect(result.current.messages).toHaveLength(1);

    __wsMock.sendMock.mockReturnValueOnce(false);
    act(() => {
      result.current.switchSession("sess-fail");
    });

    expect(__wsMock.sendMock).toHaveBeenCalledWith("ws-1", {
      type: "switch_session",
      sessionId: "sess-fail",
    });
    // The query re-keyed to sess-fail (no cached messages → empty), and the failed
    // send surfaces an error while keeping the target session selected.
    expect(result.current.messages).toEqual([]);
    expect(result.current.sessionId).toBe("sess-fail");
    expect(result.current.workspaceStatus).toBe("busy");
    expect(result.current.error).toBe("Session switch failed: disconnected from server.");
  });

  it("keeps selected session id when switched session has no messages", async () => {
    const { __apiMock } = await getApiMock();
    __apiMock.getMock.mockResolvedValueOnce([]);
    __apiMock.getMock.mockResolvedValueOnce([]);

    const { result } = renderConversation("ws-1");

    await act(async () => {
      await result.current.switchSession("sess-empty");
    });

    expect(result.current.messages).toEqual([]);
    expect(result.current.sessionId).toBe("sess-empty");
  });

  it("shows the latest session when switching rapidly (REST query re-keys to it)", async () => {
    const { __apiMock } = await getApiMock();

    // Each session resolves its own REST history; the active query key follows the
    // latest switch, so a stale earlier session's payload can never overwrite it.
    __apiMock.getMock.mockImplementation((url: string) => {
      if (url.includes("/sessions/sess-new/")) {
        return Promise.resolve([
          { id: "m-new", sessionId: "sess-new", role: "assistant", content: "new session payload", timestamp: "2026-02-12T00:00:02.000Z" },
        ]);
      }
      return Promise.resolve([
        { id: "m-old", sessionId: "sess-old", role: "assistant", content: "stale payload", timestamp: "2026-02-12T00:00:03.000Z" },
      ]);
    });

    const { result } = renderConversation("ws-1");

    act(() => {
      void result.current.switchSession("sess-old");
    });
    act(() => {
      void result.current.switchSession("sess-new");
    });

    await waitFor(() => {
      expect(result.current.sessionId).toBe("sess-new");
      expect(result.current.messages).toEqual([
        expect.objectContaining({ id: "m-new", content: "new session payload" }),
      ]);
    });
  });

  it("ignores unrecognized WS message types without corrupting state", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderConversation("ws-1");

    act(() => {
      __wsMock.emit("ws-1", { type: "status", status: "busy", sessionId: "sess-x", streaming: true });
    });

    expect(result.current.workspaceStatus).toBe("busy");

    act(() => {
      __wsMock.emit("ws-1", {
        type: "branch_info",
        info: { name: "feat/new", lastSyncedAt: "2026-02-13T00:00:00.000Z" },
      } as unknown as WsOutgoing);
    });

    expect(result.current.workspaceStatus).toBe("busy");
    expect(result.current.isStreaming).toBe(true);
    expect(result.current.messages).toHaveLength(0);
  });

  it("does nothing when switchSession is called without workspace id", async () => {
    const { __apiMock } = await getApiMock();
    const { result } = renderConversation(undefined);

    await act(async () => {
      await result.current.switchSession("sess-1");
    });

    expect(__apiMock.getMock).not.toHaveBeenCalled();
    expect(result.current.sessionId).toBeUndefined();
  });

  // ── Image attachment tests ──────────────────────────────────────────

  it("forwards images through transport in sendMessage", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderConversation("ws-1");

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
    const { result } = renderConversation("ws-1");

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
    const { result } = renderConversation("ws-1");

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
    const { result } = renderConversation("ws-1");

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

  it("merges live reasoning segments by block on each thinking event", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderConversation("ws-1");

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
      __wsMock.emit("ws-1", {
        type: "thinking",
        sessionId: "sess-1",
        blockId: "reasoning-1",
        segments: [{ id: "reasoning-1:0", body: "First" }],
      });
      __wsMock.emit("ws-1", {
        type: "thinking",
        sessionId: "sess-1",
        blockId: "reasoning-1",
        segments: [{ id: "reasoning-1:0", body: "First phase" }],
      });
      __wsMock.emit("ws-1", {
        type: "thinking",
        sessionId: "sess-1",
        blockId: "reasoning-2",
        segments: [{ id: "reasoning-2:0", headline: "Second phase" }],
      });
    });

    expect(result.current.currentReasoningSegments).toEqual([
      { id: "reasoning-1:0", body: "First phase" },
      { id: "reasoning-2:0", headline: "Second phase" },
    ]);
  });

  it("persists reasoning segments in the optimistic finalized message on done", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderConversation("ws-1");

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
      __wsMock.emit("ws-1", {
        type: "thinking",
        sessionId: "sess-1",
        blockId: "reasoning-1",
        segments: [{ id: "reasoning-1:0", headline: "Visible thought" }],
      });
      __wsMock.emit("ws-1", { type: "text_delta", sessionId: "sess-1", text: "Answer" });
    });
    act(() => {
      __wsMock.emit("ws-1", { type: "done", sessionId: "sess-1" });
    });

    const assistant = result.current.messages.at(-1);
    expect(assistant?.reasoningSegments).toEqual([
      { id: "reasoning-1:0", headline: "Visible thought" },
    ]);
    expect(assistant?.content).toBe("Answer");
  });

  it("updates tool call output via tool_result event", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderConversation("ws-1");

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
    const { result } = renderConversation("ws-1");

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
    const { result } = renderConversation("ws-1");

    act(() => {
      __wsMock.emit("ws-1", { type: "cancelled" });
    });

    expect(result.current.messages).toEqual([]);
    expect(result.current.isStreaming).toBe(false);
  });

  it("preserves durationMs from done event in finalized assistant message", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderConversation("ws-1");

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
    const { result } = renderConversation("ws-1");

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
    const { result } = renderConversation("ws-1");

    act(() => {
      result.current.rejectToolInput("no pending");
    });

    // No tool_input_response should be sent
    expect(__wsMock.sendMock).not.toHaveBeenCalled();
  });

  it("sends dismiss plan response using pending ExitPlanMode request id", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderConversation("ws-1");

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
    const { result } = renderConversation("ws-1");

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
    const { result } = renderConversation(undefined);

    act(() => {
      const sent = result.current.sendMessage("hello");
      expect(sent).toBe(false);
    });

    expect(result.current.error).toContain("no workspace");
  });

  it("stopStreaming sends stop message through transport", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderConversation("ws-1");

    act(() => {
      result.current.stopStreaming();
    });

    expect(__wsMock.sendMock).toHaveBeenCalledWith("ws-1", { type: "stop" });
  });

  it("keeps stop routing on the active session when background user_message events arrive", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderConversation("ws-1");

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
    const { result, rerender } = renderConversation("ws-1");

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
    const { result, rerender } = renderConversation("ws-1");

    const initial = result.current.switchCounter;

    rerender({ wsId: "ws-2" });
    expect(result.current.switchCounter).toBe(initial + 1);

    rerender({ wsId: "ws-1" });
    expect(result.current.switchCounter).toBe(initial + 2);
  });

  it("keeps switchCounter stable when adopting the first explicit session", () => {
    const { result } = renderConversation("ws-1");
    const initial = result.current.switchCounter;

    act(() => {
      result.current.switchSession("draft-session", { preserveComposer: true });
    });

    expect(result.current.sessionId).toBe("draft-session");
    expect(result.current.switchCounter).toBe(initial);
  });

  it("restores last viewed session when switching back to a workspace", async () => {
    const { __wsMock } = await getWsMock();
    const { result, rerender } = renderConversation("ws-1");

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
    const { result, rerender } = renderConversation("ws-1");

    // Establish session on ws-1
    act(() => {
      __wsMock.emit("ws-1", {
        type: "status",
        status: "idle",
        sessionId: "sess-B",
        streaming: false,
      });
    });

    // Switch away (cleanup saves ws-1 → sess-B) and back.
    rerender({ wsId: "ws-2" });
    __wsMock.setReplay("ws-1", []);
    rerender({ wsId: "ws-1" });

    // The restored saved session re-targets the session-specific REST endpoint.
    await waitFor(() => {
      expect(result.current.sessionId).toBe("sess-B");
    });
    expect(__apiMock.getMock).toHaveBeenCalledWith(
      "/api/workspaces/ws-1/sessions/sess-B/messages",
    );
  });

  it("preserves streaming data across workspace switch", async () => {
    const { __wsMock } = await getWsMock();
    const { result, rerender } = renderConversation("ws-1");

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
    const { result, rerender } = renderConversation("ws-1");

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
        reasoningSegments: [
          { id: "reasoning-1:0", headline: "Canonical visible reasoning" },
        ],
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
    expect(result.current.currentReasoningSegments).toEqual([
      { id: "reasoning-1:0", headline: "Canonical visible reasoning" },
    ]);
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

  it("full reset clears sessionStreams when workspaceId becomes undefined", async () => {
    const { __wsMock } = await getWsMock();
    const { result, rerender } = renderConversation("ws-1");

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
    const { __apiMock } = await getApiMock();
    // The authoritative finalized turn for sess-1 (recovered on the done-driven
    // refetch after the buffered replay completes the turn).
    __apiMock.getMock.mockResolvedValue([
      { id: "u1", sessionId: "sess-1", role: "user", content: "hello", timestamp: "2026-02-12T00:00:00.000Z" },
      { id: "a1", sessionId: "sess-1", role: "assistant", content: "Before after", timestamp: "2026-02-12T00:00:01.000Z", durationMs: 1234 },
    ]);

    const { result, rerender } = renderConversation("ws-1");

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

    // Switch back — buffer replays remaining deltas + done. The done invalidates the
    // session messages, and the authoritative refetch surfaces the finalized turn.
    __wsMock.setReplay("ws-1", [
      { type: "status", status: "busy", sessionId: "sess-1", streaming: true },
      { type: "text_delta", sessionId: "sess-1", text: "after" },
      { type: "done", sessionId: "sess-1", durationMs: 1234 },
    ]);
    rerender({ wsId: "ws-1" });

    // The live stream slot is cleared; the finalized assistant message comes from REST.
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.currentStreamingText).toBe("");
    await waitFor(() => {
      const assistantMsg = result.current.messages.find((m) => m.role === "assistant");
      expect(assistantMsg).toBeDefined();
      expect(assistantMsg!.content).toBe("Before after");
      expect(assistantMsg!.durationMs).toBe(1234);
    });
  });

  it("ignores late live stream fragments after done", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderConversation("ws-1");

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
    });
    // `done` finalizes from the stream slot read via stateRef — emit after flush.
    act(() => {
      __wsMock.emit("ws-1", { type: "done", sessionId: "sess-1", durationMs: 100 });
    });

    expect(result.current.isStreaming).toBe(false);
    expect(result.current.streamingStartedAt).toBeNull();
    expect(result.current.currentStreamingText).toBe("");
    expect(result.current.messages.at(-1)?.content).toBe("Done");

    act(() => {
      __wsMock.emit("ws-1", { type: "text_delta", sessionId: "sess-1", text: " late text" });
      __wsMock.emit("ws-1", { type: "thinking", sessionId: "sess-1", blockId: "late", segments: [{ id: "late:0", body: "late thinking" }] });
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
    expect(result.current.currentReasoningSegments).toEqual([]);
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
    const { result } = renderConversation("ws-1");

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
    const { result } = renderConversation("ws-1");

    act(() => {
      __wsMock.emit("ws-1", { type: "status", status: "busy", streaming: true, sessionId: "sess-fallback" });
    });

    expect(result.current.isStreaming).toBe(true);
    expect(result.current.streamingStartedAt).toBe(1_700_000_001_555);
    nowSpy.mockRestore();
  });

  it("normalizes status streamingStartedAt in seconds to milliseconds", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderConversation("ws-1");

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
    const { result } = renderConversation("ws-1");

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
    const { result } = renderConversation("ws-1");

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

    const { result } = renderConversation("ws-1");

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

    const { result } = renderConversation("ws-1");

    expect(result.current.error).toBe("session error from buffer");
  });

  it("dispatches session-less errors arriving live after buffer replay", async () => {
    const { __wsMock } = await getWsMock();

    // Pre-populate buffer with a stale error (dropped) to confirm the flag resets.
    __wsMock.setReplay("ws-1", [
      { type: "error", message: "stale error" },
    ]);
    __wsMock.setBuffered("ws-1", true);

    const { result } = renderConversation("ws-1");
    expect(result.current.error).toBeUndefined();

    // A live session-less error arriving after replay should pass through normally.
    act(() => {
      __wsMock.emit("ws-1", { type: "error", message: "live error" });
    });

    expect(result.current.error).toBe("live error");
  });

  it("ignores session-scoped error for a background session", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderConversation("ws-1");

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
    const { result } = renderConversation("ws-1");

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
    const { result } = renderConversation("ws-1");

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
    const { result } = renderConversation("ws-1");

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
    const { result } = renderConversation("ws-1");

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

  describe("React Query message cache", () => {
    it("writes the finalized turn into the React Query cache after done", async () => {
      const { __wsMock } = await getWsMock();

      const { result, queryClient } = renderConversation("ws-1");

      act(() => {
        __wsMock.emit("ws-1", { type: "status", status: "busy", sessionId: "sess-1", streaming: true });
        __wsMock.emit("ws-1", {
          type: "user_message",
          message: { id: "u1", sessionId: "sess-1", role: "user", content: "hello", timestamp: "2026-02-20T00:00:00.000Z" },
        });
        __wsMock.emit("ws-1", { type: "text_delta", sessionId: "sess-1", text: "hi back" });
      });
      // `done` finalizes from the stream slot read via stateRef — emit after flush.
      act(() => {
        __wsMock.emit("ws-1", { type: "done", sessionId: "sess-1", durationMs: 100 });
      });

      // After done, both the user + finalized assistant message are in the cache.
      expect(result.current.messages).toHaveLength(2);
      const cached = getCachedSessionMessages(queryClient, "ws-1", "sess-1");
      expect(cached).toHaveLength(2);
      expect(cached?.at(-1)).toMatchObject({ role: "assistant", content: "hi back" });
    });

    it("keeps a session's cached messages when switching workspaces", async () => {
      const { __wsMock } = await getWsMock();

      const { result, rerender, queryClient } = renderConversation("ws-1");

      // Populate the cache for ws-1 / sess-1 via a completed turn.
      act(() => {
        __wsMock.emit("ws-1", { type: "status", status: "busy", sessionId: "sess-1", streaming: true });
        __wsMock.emit("ws-1", {
          type: "user_message",
          message: { id: "m1", sessionId: "sess-1", role: "user", content: "hi", timestamp: "2026-02-20T00:00:00.000Z" },
        });
      });
      act(() => {
        __wsMock.emit("ws-1", { type: "done", sessionId: "sess-1" });
      });
      expect(result.current.messages.length).toBeGreaterThan(0);

      // Switch to ws-2 — the visible state clears but ws-1's cache is untouched.
      rerender({ wsId: "ws-2" });

      const ws1Cached = getCachedSessionMessages(queryClient, "ws-1", "sess-1");
      expect(ws1Cached?.length).toBeGreaterThan(0);
      // No bogus cross-workspace entry was created for ws-2.
      expect(getCachedSessionMessages(queryClient, "ws-2", "sess-1")).toBeUndefined();
    });

    it("does not refetch when the React Query cache is fresh", async () => {
      const { __apiMock } = await getApiMock();
      __apiMock.getMock.mockResolvedValue([]);

      const { result, queryClient } = renderConversation("ws-1");

      // Seed a fresh cache entry for the session, then activate it.
      queryClient.setQueryData(sessionMessagesKey("ws-1", "sess-1"), [
        { id: "m1", sessionId: "sess-1", role: "user", content: "cached", timestamp: "2026-02-20T00:00:00.000Z" },
      ]);
      await activateSession("ws-1", "sess-1");

      // Messages render from the (fresh) cache and no REST fetch is triggered.
      expect(result.current.messages).toHaveLength(1);
      expect(__apiMock.getMock).not.toHaveBeenCalled();
    });

    it("fires a REST fetch for the active session when nothing is cached", async () => {
      const { __apiMock } = await getApiMock();
      __apiMock.getMock.mockReturnValue(new Promise<ChatMessage[]>(() => {}));

      renderConversation("ws-1");
      await activateSession("ws-1", "sess-1");

      await waitFor(() => {
        expect(__apiMock.getMock).toHaveBeenCalledWith(
          "/api/workspaces/ws-1/sessions/sess-1/messages",
        );
      });
    });
  });

  describe("token usage in done event", () => {
    it("stores inputTokens/outputTokens from done event in assistant message", async () => {
      const { __wsMock } = await getWsMock();
      const { result } = renderConversation("ws-1");

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
      const { result } = renderConversation("ws-1");

      act(() => {
        __wsMock.emit("ws-1", { type: "status", status: "busy", sessionId: "sess-1", streaming: true });
        __wsMock.emit("ws-1", { type: "text_delta", text: "Codex reply" });
      });
      // `done` finalizes from the stream slot read via stateRef — emit after flush.
      act(() => {
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
      const { result } = renderConversation("ws-1");

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

  describe("non-destructive reconnect resync", () => {
    it("drops a stale stream slot when authoritative history shows the turn finished", async () => {
      const { __wsMock } = await getWsMock();
      const { __apiMock } = await getApiMock();
      // The authoritative REST history holds the finalized turn the zombie socket
      // missed (it never delivered `done`).
      __apiMock.getMock.mockResolvedValue([
        { id: "u1", sessionId: "sess-1", role: "user", content: "hi", timestamp: "2026-02-12T00:00:00.000Z" },
        { id: "a1", sessionId: "sess-1", role: "assistant", content: "Hello", timestamp: "2026-02-12T00:00:01.000Z" },
      ]);

      const { result, queryClient } = renderConversation("ws-1");

      // Active stream accumulates content.
      act(() => {
        __wsMock.emit("ws-1", {
          type: "user_message",
          message: { id: "u1", sessionId: "sess-1", role: "user", content: "hi", timestamp: "2026-02-12T00:00:00.000Z" },
        });
        __wsMock.emit("ws-1", { type: "text_delta", sessionId: "sess-1", text: "Hello" });
      });
      expect(result.current.currentStreamingText).toBe("Hello");
      expect(result.current.isStreaming).toBe(true);

      // Reconnect bootstrap: status (provisional, no longer streaming) and the
      // authoritative REST refetch surface the finalized turn, whose arrival drives
      // reconcile_history to drop the now-stale live stream slot.
      act(() => {
        __wsMock.emit("ws-1", { type: "status", status: "idle", sessionId: "sess-1", streaming: false });
      });
      await act(async () => {
        await queryClient.invalidateQueries({ queryKey: sessionMessagesKey("ws-1", "sess-1") });
      });

      // No leftover streaming bubble, and the finalized message appears exactly once.
      await waitFor(() => {
        expect(result.current.messages).toHaveLength(2);
      });
      expect(result.current.isStreaming).toBe(false);
      expect(result.current.currentStreamingText).toBe("");
      expect(result.current.messages.at(-1)?.content).toBe("Hello");
    });

    it("keeps an active stream and reconciles it via snapshot replace (no wipe)", async () => {
      const { __wsMock } = await getWsMock();
      const { result } = renderConversation("ws-1");

      act(() => {
        __wsMock.emit("ws-1", {
          type: "user_message",
          message: { id: "u1", sessionId: "sess-1", role: "user", content: "hi", timestamp: "2026-02-12T00:00:00.000Z" },
        });
        __wsMock.emit("ws-1", { type: "text_delta", sessionId: "sess-1", text: "Hel" });
      });
      expect(result.current.currentStreamingText).toBe("Hel");

      // Reconnect bootstrap for a still-streaming session: status (busy) →
      // history (finalized turns only) → snapshot (authoritative in-flight state).
      act(() => {
        __wsMock.emit("ws-1", { type: "status", status: "busy", sessionId: "sess-1", streaming: true });
        __wsMock.emit("ws-1", {
          type: "history",
          sessionId: "sess-1",
          messages: [
            { id: "u1", sessionId: "sess-1", role: "user", content: "hi", timestamp: "2026-02-12T00:00:00.000Z" },
          ],
        });
        __wsMock.emit("ws-1", {
          type: "stream_snapshot",
          sessionId: "sess-1",
          text: "Hello world",
          reasoningSegments: [],
          toolCalls: [],
          agentActivities: [],
          agentPlanMode: false,
        });
      });

      expect(result.current.isStreaming).toBe(true);
      expect(result.current.currentStreamingText).toBe("Hello world");
    });
  });
});
