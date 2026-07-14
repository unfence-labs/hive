import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useConversationColumn } from "@/hooks/useConversationColumn";
import { _resetSnapshotCache } from "@/hooks/useTabs";
import * as sessionMessages from "@/hooks/useSessionMessages";
import type { QueuedMessage } from "@/types";

const mocks = vi.hoisted(() => ({
  useConversation: vi.fn(),
  useSessions: vi.fn(),
  useTasks: vi.fn(),
  useBackgroundAgents: vi.fn(),
  apiPost: vi.fn(),
}));

vi.mock("@/hooks/useConversation", () => ({ useConversation: mocks.useConversation }));
vi.mock("@/hooks/useSessions", () => ({ useSessions: mocks.useSessions }));
vi.mock("@/hooks/useTasks", () => ({ useTasks: mocks.useTasks }));
vi.mock("@/hooks/useBackgroundAgents", () => ({ useBackgroundAgents: mocks.useBackgroundAgents }));
vi.mock("@/hooks/useApi", () => ({ api: { post: mocks.apiPost } }));

// The prefetch effect calls useQueryClient(), so tests need a provider wrapper.
function wrapperFor(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function renderColumn(
  wsId: string | undefined,
  opts?: Parameters<typeof useConversationColumn>[1],
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  return renderHook(() => useConversationColumn(wsId, opts), {
    wrapper: wrapperFor(queryClient),
  });
}

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
  { sessionId: "s1", title: "One", createdAt: "2024-01-01T00:00:00Z", messageCount: 0 },
  { sessionId: "s2", title: "Two", createdAt: "2024-01-02T00:00:00Z", messageCount: 0 },
];

let createSession: ReturnType<typeof vi.fn>;
let convertToTerminal: ReturnType<typeof vi.fn>;
let deleteSession: ReturnType<typeof vi.fn>;
let refresh: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  _resetSnapshotCache();
  conversation = makeConversation();
  mocks.useConversation.mockImplementation(() => conversation);
  createSession = vi.fn().mockResolvedValue({ sessionId: "s3", title: "New", createdAt: "2024-01-03T00:00:00Z" });
  convertToTerminal = vi.fn().mockResolvedValue({ sessionId: "s1", kind: "terminal", createdAt: "2024-01-01T00:00:00Z" });
  deleteSession = vi.fn().mockResolvedValue(true);
  refresh = vi.fn();
  mocks.apiPost.mockResolvedValue(undefined);
  mocks.useSessions.mockReturnValue({ sessions: sessionList, createSession, convertToTerminal, deleteSession, refresh });
  mocks.useTasks.mockReturnValue({ tasks: [], currentTask: undefined, counts: {} });
  mocks.useBackgroundAgents.mockReturnValue({ agents: [], runningCount: 0 });
});

describe("useConversationColumn — session handlers", () => {
  it("handleCreateSession creates then switches to the new session", async () => {
    const { result } = renderColumn("ws1");
    await act(async () => {
      await result.current.handleCreateSession();
    });
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(conversation.switchSession).toHaveBeenCalledWith("s3");
  });

  it("handleActivateSession activates the tab, switches, and runs onActivateSession", () => {
    const onActivateSession = vi.fn();
    const { result } = renderColumn("ws1", { onActivateSession });
    act(() => result.current.handleActivateSession("s2"));
    expect(conversation.switchSession).toHaveBeenCalledWith("s2");
    expect(onActivateSession).toHaveBeenCalledWith("s2");
    // The file/session tab should now track the session tab.
    expect(result.current.activateTab).toBeTypeOf("function");
  });

  it("handleActivateSession is a no-op switch when already active", () => {
    const onActivateSession = vi.fn();
    const { result } = renderColumn("ws1", { onActivateSession });
    act(() => result.current.handleActivateSession("s1")); // s1 is active
    expect(conversation.switchSession).not.toHaveBeenCalled();
    expect(onActivateSession).not.toHaveBeenCalled();
  });

  it("handleDeleteSession on a non-last active session activates the next one", async () => {
    const onLastSessionDeleted = vi.fn();
    const { result } = renderColumn("ws1", { onLastSessionDeleted });
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
    const { result } = renderColumn("ws1", { onLastSessionDeleted });
    await act(async () => {
      await result.current.handleDeleteSession("s1");
    });
    expect(conversation.clearChat).toHaveBeenCalledTimes(1);
    expect(onLastSessionDeleted).toHaveBeenCalledTimes(1);
  });

  it("handleDeleteSession does nothing when delete fails", async () => {
    deleteSession.mockResolvedValue(false);
    const onLastSessionDeleted = vi.fn();
    const { result } = renderColumn("ws1", { onLastSessionDeleted });
    await act(async () => {
      await result.current.handleDeleteSession("s1");
    });
    expect(conversation.clearChat).not.toHaveBeenCalled();
    expect(onLastSessionDeleted).not.toHaveBeenCalled();
    expect(conversation.switchSession).not.toHaveBeenCalled();
  });
});

describe("useConversationColumn — handleStartTerminal", () => {
  it("converts the active session in place when it is an empty chat", async () => {
    // Active session s1 is an empty chat (kind absent, messageCount 0).
    const { result } = renderColumn("ws1");
    await act(async () => {
      await result.current.handleStartTerminal();
    });

    expect(convertToTerminal).toHaveBeenCalledWith("s1");
    expect(createSession).not.toHaveBeenCalled();
    expect(mocks.apiPost).toHaveBeenCalledWith("/api/workspaces/ws1/terminal-tabs/s1/start");
    expect(refresh).toHaveBeenCalledTimes(1);
    // Activating the already-active session is a no-op switch, but the tab is
    // still re-activated.
    expect(result.current.activateTab).toBeTypeOf("function");
  });

  it("creates a fresh terminal session when the active chat already has messages", async () => {
    mocks.useSessions.mockReturnValue({
      sessions: [
        { sessionId: "s1", title: "One", createdAt: "2024-01-01T00:00:00Z", messageCount: 3 },
      ],
      createSession,
      convertToTerminal,
      deleteSession,
      refresh,
    });
    createSession.mockResolvedValue({ sessionId: "term-1", kind: "terminal", createdAt: "2024-01-04T00:00:00Z" });

    const { result } = renderColumn("ws1");
    await act(async () => {
      await result.current.handleStartTerminal();
    });

    expect(createSession).toHaveBeenCalledWith("terminal");
    expect(convertToTerminal).not.toHaveBeenCalled();
    expect(mocks.apiPost).toHaveBeenCalledWith("/api/workspaces/ws1/terminal-tabs/term-1/start");
    expect(conversation.switchSession).toHaveBeenCalledWith("term-1");
  });

  it("aborts (no start) when the conversion fails", async () => {
    convertToTerminal.mockResolvedValue(null);
    const { result } = renderColumn("ws1");
    await act(async () => {
      await result.current.handleStartTerminal();
    });

    expect(convertToTerminal).toHaveBeenCalledWith("s1");
    expect(mocks.apiPost).not.toHaveBeenCalled();
  });

  it("still lands on the tab when the start request fails", async () => {
    // Convert succeeds but the PTY start rejects. The session is already a
    // terminal (convert is irreversible), so this must not reject unhandled and
    // must still refresh + activate so the pane's Start button can retry.
    mocks.apiPost.mockRejectedValueOnce(new Error("network"));
    const { result } = renderColumn("ws1");
    await act(async () => {
      await result.current.handleStartTerminal();
    });

    expect(mocks.apiPost).toHaveBeenCalledWith("/api/workspaces/ws1/terminal-tabs/s1/start");
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe("useConversationColumn — per-session message queue", () => {
  const queued = (content: string): QueuedMessage => ({ content, images: [], options: undefined, fileMentions: [] });

  it("keys the queue per wsId:sessionId so switching sessions preserves drafts", () => {
    // Start streaming so the queue is not auto-dequeued.
    conversation = makeConversation({ isStreaming: true });
    mocks.useConversation.mockImplementation(() => conversation);

    const { result, rerender } = renderColumn("ws1");

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
    const { result, rerender } = renderColumn("ws1");

    act(() => result.current.setQueuedMessage(queued("hello")));
    expect(result.current.queuedMessage?.content).toBe("hello");
    expect(conversation.sendMessage).not.toHaveBeenCalled();

    // Agent finishes: idle, not streaming, no pending tool inputs.
    const sendMessage = conversation.sendMessage;
    conversation = makeConversation({ isStreaming: false, sendMessage });
    mocks.useConversation.mockImplementation(() => conversation);
    rerender();

    expect(sendMessage).toHaveBeenCalledWith("hello", [], undefined, undefined, [], undefined);
    expect(result.current.queuedMessage).toBeNull();
  });

  it("does not dequeue while pending tool inputs exist", () => {
    conversation = makeConversation({ isStreaming: false, pendingToolInputs: [{ toolName: "AskUserQuestion" }] });
    mocks.useConversation.mockImplementation(() => conversation);
    const { result } = renderColumn("ws1");
    act(() => result.current.setQueuedMessage(queued("blocked")));
    expect(conversation.sendMessage).not.toHaveBeenCalled();
    expect(result.current.queuedMessage?.content).toBe("blocked");
  });

  it("bumpScrollToBottom increments the scroll trigger", () => {
    const { result } = renderColumn("ws1");
    const before = result.current.scrollToBottomTrigger;
    act(() => result.current.bumpScrollToBottom());
    expect(result.current.scrollToBottomTrigger).toBe(before + 1);
  });
});

describe("useConversationColumn — REST history pre-warm", () => {
  let prefetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Spy without hitting the network / React Query.
    prefetchSpy = vi.spyOn(sessionMessages, "prefetchSessionMessages").mockImplementation(() => {});
  });

  it("prefetches eligible sessions and skips the active, terminal, and empty ones", () => {
    // Active is s1. s2 is a warmable chat; s3 is a terminal; s4 is empty.
    mocks.useSessions.mockReturnValue({
      sessions: [
        { sessionId: "s1", title: "One", createdAt: "2024-01-01T00:00:00Z", updatedAt: "2024-01-01T00:00:00Z", messageCount: 5 },
        { sessionId: "s2", title: "Two", createdAt: "2024-01-02T00:00:00Z", updatedAt: "2024-01-02T00:00:00Z", messageCount: 3 },
        { sessionId: "s3", title: "Term", kind: "terminal", createdAt: "2024-01-03T00:00:00Z", updatedAt: "2024-01-03T00:00:00Z", messageCount: 4 },
        { sessionId: "s4", title: "Empty", createdAt: "2024-01-04T00:00:00Z", updatedAt: "2024-01-04T00:00:00Z", messageCount: 0 },
      ],
      createSession,
      convertToTerminal,
      deleteSession,
      refresh,
    });

    renderColumn("ws1"); // active sessionId is "s1"

    const warmedIds = prefetchSpy.mock.calls.map((call) => call[2]);
    expect(warmedIds).toEqual(["s2"]);
    expect(prefetchSpy).toHaveBeenCalledWith(expect.anything(), "ws1", "s2");
  });

  it("warms every eligible session, most-recent first (no cap — a context holds at most 6)", () => {
    // A context caps at MAX_SESSIONS_PER_WORKSPACE (6); use the realistic max.
    const sessions = Array.from({ length: 6 }, (_, i) => {
      const day = String(i + 1).padStart(2, "0");
      return {
        sessionId: `s${i}`,
        title: `S${i}`,
        createdAt: `2024-02-${day}T00:00:00Z`,
        updatedAt: `2024-02-${day}T00:00:00Z`,
        messageCount: 2,
      };
    });
    mocks.useConversation.mockImplementation(() =>
      makeConversation({ sessionId: "none" }),
    );
    mocks.useSessions.mockReturnValue({ sessions, createSession, convertToTerminal, deleteSession, refresh });

    renderColumn("ws1");

    const warmedIds = prefetchSpy.mock.calls.map((call) => call[2]);
    // All 6 warmed (none active/terminal/empty), newest updatedAt first.
    expect(warmedIds).toEqual(["s5", "s4", "s3", "s2", "s1", "s0"]);
  });

  it("does not prefetch when there is no workspace id", () => {
    renderColumn(undefined);
    expect(prefetchSpy).not.toHaveBeenCalled();
  });
});
