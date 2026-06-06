import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BrainView from "@/pages/BrainView";
import { _resetSnapshotCache } from "@/hooks/useTabs";
import { createWrapper } from "../test-utils";

function renderBrain() {
  const { wrapper } = createWrapper();
  return render(<BrainView />, { wrapper });
}

const mocks = vi.hoisted(() => ({
  useBrain: vi.fn(),
  useBrainFileTree: vi.fn(),
  useBrainFileMutations: vi.fn(),
  useBrainStatus: vi.fn(),
  useBrainDiff: vi.fn(),
  useBrainSave: vi.fn(),
  save: vi.fn(),
  // Chat hooks
  useConversation: vi.fn(),
  useSessions: vi.fn(),
  useWorkspaceLiveDataContext: vi.fn(),
  useTasks: vi.fn(),
  useBackgroundAgents: vi.fn(),
}));

vi.mock("@/hooks/useBrain", () => ({ useBrain: mocks.useBrain }));
vi.mock("@/hooks/useBrainFiles", () => ({
  useBrainFileTree: mocks.useBrainFileTree,
  useBrainFileMutations: mocks.useBrainFileMutations,
}));
vi.mock("@/hooks/useBrainGit", () => ({
  useBrainStatus: mocks.useBrainStatus,
  useBrainDiff: mocks.useBrainDiff,
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
vi.mock("@/hooks/useTasks", () => ({ useTasks: mocks.useTasks }));
vi.mock("@/hooks/useBackgroundAgents", () => ({ useBackgroundAgents: mocks.useBackgroundAgents }));
vi.mock("@/components/ChatConversation", () => ({
  default: () => <div data-testid="chat-conversation">chat</div>,
}));
vi.mock("@/components/ChatInput", () => ({
  default: () => <div data-testid="chat-input">input</div>,
}));

// Keep FileViewer + diff/editor lightweight in tests.
vi.mock("@/components/FileViewer", () => ({
  FileViewer: ({ filePath }: { filePath: string }) => (
    <div data-testid="file-viewer">{filePath}</div>
  ),
}));
vi.mock("@/components/diff/FileDiffCard", () => ({
  FileDiffCard: ({ fileName }: { fileName: string }) => <div data-testid="diff-file">{fileName}</div>,
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

// jsdom has no layout, so the real virtualizer renders 0 rows. Render every row
// so the tree's notes are queryable (windowing itself is covered elsewhere).
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 28,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        start: index * 28,
        size: 28,
      })),
  }),
}));

function emptyConversation() {
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
    _resetSnapshotCache();
    mocks.useBrain.mockReturnValue({ brain: { exists: true, repoUrl: "x", createdAt: "" }, loading: false });
    mocks.useBrainFileTree.mockReturnValue({ data: [{ name: "a.md", path: "a.md", type: "file" }], error: null });
    mocks.useBrainFileMutations.mockReturnValue({
      upsertFile: vi.fn().mockResolvedValue(undefined),
      deleteFile: vi.fn().mockResolvedValue(undefined),
      renameFile: vi.fn().mockResolvedValue(undefined),
    });
    mocks.useBrainStatus.mockReturnValue({ data: { files: [{ path: "a.md", status: "modified" }], count: 1 } });
    mocks.useBrainDiff.mockReturnValue({ data: { diff: "patch" }, isLoading: false, error: null });
    mocks.useBrainSave.mockReturnValue({ save: mocks.save, isSaving: false });

    mocks.useConversation.mockReturnValue(emptyConversation());
    mocks.useSessions.mockReturnValue({
      sessions: [{ sessionId: "s1", title: "Chat" }],
      createSession: vi.fn(),
      deleteSession: vi.fn(),
    });
    mocks.useWorkspaceLiveDataContext.mockReturnValue({});
    mocks.useTasks.mockReturnValue({ tasks: [], currentTask: null, counts: {} });
    mocks.useBackgroundAgents.mockReturnValue({ agents: [], runningCount: 0 });
  });

  it("shows the not-connected state when no Brain exists", () => {
    mocks.useBrain.mockReturnValue({ brain: { exists: false }, loading: false });
    renderBrain();
    expect(screen.getByText(/No Brain repository connected/i)).toBeInTheDocument();
  });

  it("renders the chat column and the notes tree", () => {
    renderBrain();
    expect(screen.getByTestId("chat-conversation")).toBeInTheDocument();
    expect(screen.getByText("Notes")).toBeInTheDocument();
    // Chat is visible, no file tab open yet.
    expect(screen.queryByTestId("file-viewer")).not.toBeInTheDocument();
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

  it("disables Save when there are no pending changes", () => {
    mocks.useBrainStatus.mockReturnValue({ data: { files: [], count: 0 } });
    renderBrain();
    const saveBtn = screen.getByRole("button", { name: /Save/i });
    expect(saveBtn).toBeDisabled();
  });

  it("opens the review modal on Save and commits + pushes on confirm", async () => {
    const user = userEvent.setup();
    mocks.save.mockResolvedValue({ committed: true, pushed: true });
    renderBrain();

    const saveBtn = screen.getByRole("button", { name: /Save/i });
    expect(saveBtn).toHaveTextContent("1");
    await user.click(saveBtn);

    // Review modal appears with the diff.
    expect(await screen.findByText(/Review changes/i)).toBeInTheDocument();
    expect(screen.getByTestId("diff-file")).toHaveTextContent("a.md");

    await user.click(screen.getByRole("button", { name: /Save & Push/i }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(undefined));
  });

  it("closes the review modal on cancel without saving", async () => {
    const user = userEvent.setup();
    renderBrain();

    await user.click(screen.getByRole("button", { name: /Save/i }));
    expect(await screen.findByText(/Review changes/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Cancel$/i }));
    await waitFor(() => expect(screen.queryByText(/Review changes/i)).not.toBeInTheDocument());
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
