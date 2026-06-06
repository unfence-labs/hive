import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useConversationColumn } from "@/hooks/useConversationColumn";
import { _resetSnapshotCache } from "@/hooks/useTabs";
import type { QueuedMessage } from "@/types";

const mocks = vi.hoisted(() => ({
  useConversation: vi.fn(),
  useSessions: vi.fn(),
  useTasks: vi.fn(),
  useBackgroundAgents: vi.fn(),
}));

vi.mock("@/hooks/useConversation", () => ({ useConversation: mocks.useConversation }));
vi.mock("@/hooks/useSessions", () => ({ useSessions: mocks.useSessions }));
vi.mock("@/hooks/useTasks", () => ({ useTasks: mocks.useTasks }));
vi.mock("@/hooks/useBackgroundAgents", () => ({ useBackgroundAgents: mocks.useBackgroundAgents }));

// Shared mutable conversation state so we can re-render with different values.
let conversation: Record<string, unknown>;

function makeConversation(overrides: Record<string, unknown> = {}) {
  return {
    messages: [],
    isStreaming: false,
    streamingStartedAt: null,
    workspaceStatus: "idle",
    currentStreamingText: "",
    currentThinking: "",
    activeToolCalls: [],
    activeAgentActivities: [],
    pendingToolInputs: [],
    connectionStatus: "connected",
    error: null,
    sessionId: "s1",
    agentPlanMode: false,
    lockedProvider: undefined,
    switchCounter: 0,
    sendMessage: vi.fn(() => true),
    stopStreaming: vi.fn(),
    clearChat: vi.fn(),
    switchSession: vi.fn(),
    answerQuestion: vi.fn(),
    batchAnswerQuestions: vi.fn(),
    approvePlan: vi.fn(),
    rejectToolInput: vi.fn(),
    dismissPlan: vi.fn(),
    ...overrides,
  };
}

const sessionList = [
  { sessionId: "s1", title: "One", createdAt: "2024-01-01T00:00:00Z" },
  { sessionId: "s2", title: "Two", createdAt: "2024-01-02T00:00:00Z" },
];

let createSession: ReturnType<typeof vi.fn>;
let deleteSession: ReturnType<typeof vi.fn>;
let refresh: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  _resetSnapshotCache();
  conversation = makeConversation();
  mocks.useConversation.mockImplementation(() => conversation);
  createSession = vi.fn().mockResolvedValue({ sessionId: "s3", title: "New", createdAt: "2024-01-03T00:00:00Z" });
  deleteSession = vi.fn().mockResolvedValue(true);
  refresh = vi.fn();
  mocks.useSessions.mockReturnValue({ sessions: sessionList, createSession, deleteSession, refresh });
  mocks.useTasks.mockReturnValue({ tasks: [], currentTask: undefined, counts: {} });
  mocks.useBackgroundAgents.mockReturnValue({ agents: [], runningCount: 0 });
});

describe("useConversationColumn — session handlers", () => {
  it("handleCreateSession creates then switches to the new session", async () => {
    const { result } = renderHook(() => useConversationColumn("ws1"));
    await act(async () => {
      await result.current.handleCreateSession();
    });
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(conversation.switchSession).toHaveBeenCalledWith("s3");
  });

  it("handleActivateSession activates the tab, switches, and runs onActivateSession", () => {
    const onActivateSession = vi.fn();
    const { result } = renderHook(() => useConversationColumn("ws1", { onActivateSession }));
    act(() => result.current.handleActivateSession("s2"));
    expect(conversation.switchSession).toHaveBeenCalledWith("s2");
    expect(onActivateSession).toHaveBeenCalledWith("s2");
    // The file/session tab should now track the session tab.
    expect(result.current.activateTab).toBeTypeOf("function");
  });

  it("handleActivateSession is a no-op switch when already active", () => {
    const onActivateSession = vi.fn();
    const { result } = renderHook(() => useConversationColumn("ws1", { onActivateSession }));
    act(() => result.current.handleActivateSession("s1")); // s1 is active
    expect(conversation.switchSession).not.toHaveBeenCalled();
    expect(onActivateSession).not.toHaveBeenCalled();
  });

  it("handleDeleteSession on a non-last active session activates the next one", async () => {
    const onLastSessionDeleted = vi.fn();
    const { result } = renderHook(() => useConversationColumn("ws1", { onLastSessionDeleted }));
    await act(async () => {
      await result.current.handleDeleteSession("s1"); // active, sibling s2 remains
    });
    expect(deleteSession).toHaveBeenCalledWith("s1");
    expect(conversation.switchSession).toHaveBeenCalledWith("s2");
    expect(conversation.clearChat).not.toHaveBeenCalled();
    expect(onLastSessionDeleted).not.toHaveBeenCalled();
  });

  it("handleDeleteSession on the last session clears chat and runs onLastSessionDeleted", async () => {
    mocks.useSessions.mockReturnValue({
      sessions: [sessionList[0]],
      createSession,
      deleteSession,
      refresh,
    });
    const onLastSessionDeleted = vi.fn();
    const { result } = renderHook(() => useConversationColumn("ws1", { onLastSessionDeleted }));
    await act(async () => {
      await result.current.handleDeleteSession("s1");
    });
    expect(conversation.clearChat).toHaveBeenCalledTimes(1);
    expect(onLastSessionDeleted).toHaveBeenCalledTimes(1);
  });

  it("handleDeleteSession does nothing when delete fails", async () => {
    deleteSession.mockResolvedValue(false);
    const onLastSessionDeleted = vi.fn();
    const { result } = renderHook(() => useConversationColumn("ws1", { onLastSessionDeleted }));
    await act(async () => {
      await result.current.handleDeleteSession("s1");
    });
    expect(conversation.clearChat).not.toHaveBeenCalled();
    expect(onLastSessionDeleted).not.toHaveBeenCalled();
    expect(conversation.switchSession).not.toHaveBeenCalled();
  });
});

describe("useConversationColumn — per-session message queue", () => {
  const queued = (content: string): QueuedMessage => ({ content, images: [], options: undefined, fileMentions: [] });

  it("keys the queue per wsId:sessionId so switching sessions preserves drafts", () => {
    // Start streaming so the queue is not auto-dequeued.
    conversation = makeConversation({ isStreaming: true });
    mocks.useConversation.mockImplementation(() => conversation);

    const { result, rerender } = renderHook(() => useConversationColumn("ws1"));

    act(() => result.current.setQueuedMessage(queued("for s1")));
    expect(result.current.queuedMessage?.content).toBe("for s1");

    // Switch to s2: queue for s1 must not leak into s2.
    conversation = makeConversation({ isStreaming: true, sessionId: "s2" });
    mocks.useConversation.mockImplementation(() => conversation);
    rerender();
    expect(result.current.queuedMessage).toBeNull();

    // Queue a message for s2.
    act(() => result.current.setQueuedMessage(queued("for s2")));
    expect(result.current.queuedMessage?.content).toBe("for s2");

    // Switch back to s1: its original draft is still there.
    conversation = makeConversation({ isStreaming: true, sessionId: "s1" });
    mocks.useConversation.mockImplementation(() => conversation);
    rerender();
    expect(result.current.queuedMessage?.content).toBe("for s1");
  });

  it("auto-dequeues and sends when the workspace becomes idle", () => {
    conversation = makeConversation({ isStreaming: true });
    mocks.useConversation.mockImplementation(() => conversation);
    const { result, rerender } = renderHook(() => useConversationColumn("ws1"));

    act(() => result.current.setQueuedMessage(queued("hello")));
    expect(result.current.queuedMessage?.content).toBe("hello");
    expect(conversation.sendMessage).not.toHaveBeenCalled();

    // Agent finishes: idle, not streaming, no pending tool inputs.
    const sendMessage = conversation.sendMessage;
    conversation = makeConversation({ isStreaming: false, sendMessage });
    mocks.useConversation.mockImplementation(() => conversation);
    rerender();

    expect(sendMessage).toHaveBeenCalledWith("hello", [], undefined, undefined, []);
    expect(result.current.queuedMessage).toBeNull();
  });

  it("does not dequeue while pending tool inputs exist", () => {
    conversation = makeConversation({ isStreaming: false, pendingToolInputs: [{ toolName: "AskUserQuestion" }] });
    mocks.useConversation.mockImplementation(() => conversation);
    const { result } = renderHook(() => useConversationColumn("ws1"));
    act(() => result.current.setQueuedMessage(queued("blocked")));
    expect(conversation.sendMessage).not.toHaveBeenCalled();
    expect(result.current.queuedMessage?.content).toBe("blocked");
  });

  it("bumpScrollToBottom increments the scroll trigger", () => {
    const { result } = renderHook(() => useConversationColumn("ws1"));
    const before = result.current.scrollToBottomTrigger;
    act(() => result.current.bumpScrollToBottom());
    expect(result.current.scrollToBottomTrigger).toBe(before + 1);
  });
});
