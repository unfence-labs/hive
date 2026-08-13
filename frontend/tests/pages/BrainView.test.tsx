import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BrainView from "@/pages/BrainView";
import { _resetSnapshotCache } from "@/hooks/useTabs";
import { BRAIN_WORKSPACE_ID } from "@/lib/brain";
import { createWrapper } from "../test-utils";

function renderBrain() {
  const { wrapper } = createWrapper();
  return render(<BrainView />, { wrapper });
}

const mocks = vi.hoisted(() => ({
  useBrain: vi.fn(),
  useBrainFileTree: vi.fn(),
  useBrainFileMutations: vi.fn(),
  useBrainRefresh: vi.fn(),
  useBrainStatus: vi.fn(),
  useBrainSave: vi.fn(),
  save: vi.fn(),
  // Chat hooks
  useConversation: vi.fn(),
  useSessions: vi.fn(),
  useWorkspaceLiveDataContext: vi.fn(),
  wsSend: vi.fn(),
  useTasks: vi.fn(),
  useBackgroundAgents: vi.fn(),
  useTerminalApps: vi.fn(),
  flushFileViewer: vi.fn(),
}));

vi.mock("@/hooks/useBrain", () => ({ useBrain: mocks.useBrain }));
vi.mock("@/hooks/useBrainFiles", () => ({
  useBrainFileTree: mocks.useBrainFileTree,
  useBrainFileMutations: mocks.useBrainFileMutations,
  useBrainRefresh: mocks.useBrainRefresh,
}));
vi.mock("@/hooks/useBrainGit", () => ({
  useBrainStatus: mocks.useBrainStatus,
  useBrainSave: mocks.useBrainSave,
}));
vi.mock("@/hooks/useBrainChatRefresh", () => ({ useBrainChatRefresh: vi.fn() }));

// Stub the chat machinery so BrainView's layout/file-tab/save behavior is
// tested in isolation (the chat stack is covered by its own tests).
vi.mock("@/hooks/useConversation", () => ({ useConversation: mocks.useConversation }));
vi.mock("@/hooks/useSessions", () => ({ useSessions: mocks.useSessions }));
vi.mock("@/contexts/WorkspaceLiveDataContext", () => ({
  useWorkspaceLiveDataContext: mocks.useWorkspaceLiveDataContext,
}));
vi.mock("@/lib/ws-transport", () => ({
  wsTransport: { send: mocks.wsSend },
}));
vi.mock("@/hooks/useTasks", () => ({ useTasks: mocks.useTasks }));
vi.mock("@/hooks/useBackgroundAgents", () => ({ useBackgroundAgents: mocks.useBackgroundAgents }));
vi.mock("@/hooks/useTerminalApps", () => ({
  useTerminalApps: mocks.useTerminalApps,
}));
vi.mock("@/components/ChatConversation", () => ({
  default: () => <div data-testid="chat-conversation">chat</div>,
}));
vi.mock("@/components/ChatInput", () => ({
  default: () => <div data-testid="chat-input">input</div>,
}));

// Keep FileViewer + diff/editor lightweight in tests.
vi.mock("@/components/FileViewer", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    FileViewer: React.forwardRef<{ flushPendingWrite: () => Promise<void> }, { filePath: string }>(
      function FileViewer({ filePath }, ref) {
        React.useImperativeHandle(ref, () => ({
          flushPendingWrite: mocks.flushFileViewer,
        }));
        return <div data-testid="file-viewer">{filePath}</div>;
      },
    ),
  };
});
vi.mock("@/components/diff/InlineDiffViewer", () => ({
  InlineDiffViewer: ({ filePath }: { filePath: string }) => (
    <div data-testid="inline-diff">{filePath}</div>
  ),
}));
vi.mock("@/components/ai-elements/message", () => ({
  MessageResponse: ({ children }: { children: string }) => <div>{children}</div>,
}));
vi.mock("@/components/MarkdownEditor", () => ({
  MarkdownEditor: () => <textarea data-testid="raw-editor" />,
}));
vi.mock("@pierre/diffs", () => ({
  parsePatchFiles: () => [
    { files: [{ name: "a.md", prevName: "", type: "modified", hunks: [] }] },
  ],
}));

function emptyConversation() {
  return {
    messages: [],
    isStreaming: false,
    streamingStartedAt: null,
    workspaceStatus: "idle",
    currentStreamingText: "",
    currentReasoningSegments: [],
    activeToolCalls: [],
    activeAgentActivities: [],
    pendingToolInputs: [],
    connectionStatus: "connected",
    error: null,
    sessionId: "s1",
    sendMessage: vi.fn(),
    stopStreaming: vi.fn(),
    clearChat: vi.fn(),
    switchSession: vi.fn(),
    answerQuestion: vi.fn(),
    batchAnswerQuestions: vi.fn(),
    rejectToolInput: vi.fn(),
    agentPlanMode: false,
    lockedProvider: undefined,
    switchCounter: 0,
  };
}

describe("BrainView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    _resetSnapshotCache();
    mocks.useBrain.mockReturnValue({ brain: { exists: true, repoUrl: "x", createdAt: "" }, loading: false });
    mocks.useBrainFileTree.mockReturnValue({ data: [{ name: "a.md", path: "a.md", type: "file" }], error: null });
    mocks.useBrainFileMutations.mockReturnValue({
      upsertFile: vi.fn().mockResolvedValue(undefined),
    });
    mocks.useBrainRefresh.mockReturnValue(vi.fn());
    mocks.useBrainStatus.mockReturnValue({ data: { files: [{ path: "a.md", status: "modified" }], count: 1 } });
    mocks.useBrainSave.mockReturnValue({ save: mocks.save, isSaving: false });
    mocks.flushFileViewer.mockResolvedValue(undefined);

    mocks.useConversation.mockReturnValue(emptyConversation());
    mocks.useSessions.mockReturnValue({
      sessions: [{ sessionId: "s1", title: "Chat" }],
      createSession: vi.fn(),
      deleteSession: vi.fn(),
    });
    mocks.useWorkspaceLiveDataContext.mockReturnValue({});
    mocks.useTasks.mockReturnValue({ tasks: [], currentTask: null, counts: {} });
    mocks.useBackgroundAgents.mockReturnValue({ agents: [], runningCount: 0 });
    mocks.useTerminalApps.mockReturnValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the not-connected state when no Brain exists", () => {
    mocks.useBrain.mockReturnValue({ brain: { exists: false }, loading: false });
    renderBrain();
    expect(screen.getByText(/No Brain repository connected/i)).toBeInTheDocument();
  });

  it("renders the chat column and the shared file browser (Files/Changes tabs)", () => {
    renderBrain();
    expect(screen.getByTestId("chat-conversation")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Files$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Changes/i })).toBeInTheDocument();
    // The note appears in the tree (Files tab is the default).
    expect(screen.getByText("a.md")).toBeInTheDocument();
    // Chat is visible, no file tab open yet.
    expect(screen.queryByTestId("file-viewer")).not.toBeInTheDocument();
  });

  it("marks the visible Brain conversation read using the rendered assistant count", async () => {
    mocks.useConversation.mockReturnValue({
      ...emptyConversation(),
      messages: [{
        id: "assistant-1",
        sessionId: "s1",
        role: "assistant",
        content: "Saved note",
        timestamp: "2026-02-12T00:00:00.000Z",
      }],
      isHistoryLoading: false,
    });
    mocks.useWorkspaceLiveDataContext.mockReturnValue({
      [BRAIN_WORKSPACE_ID]: {
        unreadSessions: {
          s1: {
            sessionId: "s1",
            assistantMessageCount: 2,
            readAssistantMessageCount: 0,
          },
        },
      },
    });

    renderBrain();

    await waitFor(() => {
      expect(mocks.wsSend).toHaveBeenCalledWith(BRAIN_WORKSPACE_ID, {
        type: "mark_read",
        sessionId: "s1",
        throughCount: 1,
      });
    });
  });

  it("has no note-management (create/rename/delete) affordances", () => {
    renderBrain();
    expect(screen.queryByRole("button", { name: /New note/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Rename/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Delete/i })).not.toBeInTheDocument();
  });

  it("opens a file tab (FileViewer) that takes over the chat area when a note is selected", async () => {
    const user = userEvent.setup();
    renderBrain();

    // Click the note in the tree.
    await user.click(screen.getByText("a.md"));

    // FileViewer is shown; the chat conversation is hidden (display: none).
    const viewer = await screen.findByTestId("file-viewer");
    expect(viewer).toHaveTextContent("a.md");
    const chat = screen.getByTestId("chat-conversation");
    expect(chat.closest(".hidden")).not.toBeNull();
  });

  it("opens a per-file diff tab (InlineDiffViewer) from the Changes tab", async () => {
    const user = userEvent.setup();
    renderBrain();

    // Switch to the Changes tab, then click the modified file.
    await user.click(screen.getByRole("button", { name: /^Changes/i }));
    const modifiedRow = await screen.findByRole("button", { name: /a\.md/i });
    await user.click(modifiedRow);

    // The inline diff viewer takes over the chat area for that file.
    const diff = await screen.findByTestId("inline-diff");
    expect(diff).toHaveTextContent("a.md");
  });

  it("returns to the chat when the file tab is closed", async () => {
    const user = userEvent.setup();
    renderBrain();

    await user.click(screen.getByText("a.md"));
    await screen.findByTestId("file-viewer");

    // The file tab's close affordance is a span[role=button] whose only child is
    // the X icon (the surrounding tab button also contains it, so match the leaf).
    const fileTabClose = screen
      .getAllByRole("button")
      .find((b) => b.querySelector(":scope > svg.lucide-x"));
    expect(fileTabClose).toBeTruthy();
    await user.click(fileTabClose!);

    await waitFor(() => expect(screen.queryByTestId("file-viewer")).not.toBeInTheDocument());
  });

  it("disables Save (in the Sync section) when there are no pending changes", () => {
    mocks.useBrainStatus.mockReturnValue({ data: { files: [], count: 0 } });
    renderBrain();
    const saveBtn = screen.getByRole("button", { name: /Save/i });
    expect(saveBtn).toBeDisabled();
  });

  it("commits + pushes directly on Save (Sync section), with no review modal", async () => {
    const user = userEvent.setup();
    mocks.save.mockResolvedValue({ committed: true, pushed: true });
    renderBrain();

    const saveBtn = screen.getByRole("button", { name: /Save/i });
    expect(saveBtn).toHaveTextContent("1");
    await user.click(saveBtn);

    // The save mutation is invoked directly (no message → backend default).
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(undefined));

    // No review modal / sheet appears.
    expect(screen.queryByText(/Review changes/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Save & Push/i })).not.toBeInTheDocument();
  });

  it("shows push failed when pushing existing local commits fails", async () => {
    const user = userEvent.setup();
    mocks.useBrainStatus.mockReturnValue({
      data: {
        files: [],
        count: 0,
        upstream: "origin/main",
        unpushedCommitCount: 1,
      },
    });
    mocks.save.mockResolvedValue({ committed: false, pushed: false, error: "Push failed" });
    renderBrain();

    await user.click(screen.getByRole("button", { name: /Save/i }));

    await waitFor(() => expect(screen.getByText("Push failed")).toBeInTheDocument());
  });

  it("flushes an open raw file before saving", async () => {
    const user = userEvent.setup();
    const order: string[] = [];
    mocks.flushFileViewer.mockImplementation(async () => {
      order.push("flush");
    });
    mocks.save.mockImplementation(async () => {
      order.push("save");
      return { committed: true, pushed: true };
    });
    renderBrain();

    await user.click(screen.getByText("a.md"));
    await screen.findByTestId("file-viewer");
    await user.click(screen.getByRole("button", { name: /Save/i }));

    await waitFor(() => expect(mocks.save).toHaveBeenCalled());
    expect(order).toEqual(["flush", "save"]);
  });

  it("flushes an open raw file before refreshing files", async () => {
    const user = userEvent.setup();
    const order: string[] = [];
    const refresh = vi.fn(() => {
      order.push("refresh");
    });
    mocks.flushFileViewer.mockImplementation(async () => {
      order.push("flush");
    });
    mocks.useBrainRefresh.mockReturnValue(refresh);
    renderBrain();

    await user.click(screen.getByText("a.md"));
    await screen.findByTestId("file-viewer");
    await user.click(screen.getByRole("button", { name: /Refresh files/i }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(order).toEqual(["flush", "refresh"]);
  });

  it("does not refresh the open file content when flushing before refresh fails", async () => {
    const user = userEvent.setup();
    const refreshOpenFile = vi.fn();
    const refreshWorkingTree = vi.fn();
    const flushError = new Error("flush failed");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.useBrainRefresh.mockImplementation((openFilePath?: string | null) =>
      openFilePath ? refreshOpenFile : refreshWorkingTree,
    );
    mocks.flushFileViewer.mockRejectedValue(flushError);
    renderBrain();

    await user.click(screen.getByText("a.md"));
    await screen.findByTestId("file-viewer");
    await user.click(screen.getByRole("button", { name: /Refresh files/i }));

    await waitFor(() => expect(refreshWorkingTree).toHaveBeenCalled());
    expect(refreshOpenFile).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      "Failed to flush pending Brain note write before refresh",
      flushError,
    );
    consoleError.mockRestore();
  });
});
