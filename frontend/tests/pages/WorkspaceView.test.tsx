import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalProvider, useTerminalContext } from "@/contexts/TerminalContext";
import WorkspaceView from "@/pages/WorkspaceView";
import type { Workspace, WorkspaceFileTreeNode } from "@/types";

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  useConversation: vi.fn(),
  useSessions: vi.fn(),
  useDiffStat: vi.fn(),
  sendMessage: vi.fn(),
  stopStreaming: vi.fn(),
  clearChat: vi.fn(),
  switchSession: vi.fn(),
  answerQuestion: vi.fn(),
  batchAnswerQuestions: vi.fn(),
  approvePlan: vi.fn(),
  rejectToolInput: vi.fn(),
  createSession: vi.fn(),
  activateSession: vi.fn(),
  deleteSession: vi.fn(),
  refreshSessions: vi.fn(),
  refreshDiffStat: vi.fn(),
}));

vi.mock("@/hooks/useApi", () => ({
  api: { get: mocks.apiGet },
}));

vi.mock("@/hooks/useConversation", () => ({
  useConversation: mocks.useConversation,
}));

vi.mock("@/hooks/useSessions", () => ({
  useSessions: mocks.useSessions,
}));

vi.mock("@/hooks/useDiffStat", () => ({
  useDiffStat: mocks.useDiffStat,
}));

vi.mock("@/components/ChatConversation", () => ({
  default: () => <div data-testid="chat-conversation">chat-conversation</div>,
}));

vi.mock("@/components/ChatInput", () => ({
  default: () => <div data-testid="chat-input">chat-input</div>,
}));

vi.mock("@/components/chat/QuestionPanel", () => ({
  default: ({
    onBatchSubmit,
    onDismiss,
  }: {
    onBatchSubmit: (responses: Array<{ toolUseId: string; answers: unknown[] }>) => void;
    onDismiss: () => void;
  }) => (
    <div data-testid="question-panel">
      <button type="button" onClick={() => onBatchSubmit([{ toolUseId: "ask-1", answers: [] }])}>
        submit questions
      </button>
      <button type="button" onClick={onDismiss}>dismiss questions</button>
    </div>
  ),
}));

vi.mock("@/components/SessionSelector", () => ({
  SessionSelector: () => <div data-testid="session-selector">session-selector</div>,
}));

vi.mock("@/components/diff/GitDiffModal", () => ({
  GitDiffModal: () => <div data-testid="git-diff-modal">git-diff-modal</div>,
}));

vi.mock("@/components/diff/ModifiedFileList", () => ({
  ModifiedFileList: () => <div data-testid="modified-file-list">modified-file-list</div>,
}));

vi.mock("@/components/ai-elements/file-tree", () => ({
  FileTree: ({ children }: { children?: ReactNode }) => <div data-testid="file-tree">{children}</div>,
  FileTreeFile: ({ name }: { name: string }) => <div data-testid={`file-${name}`}>{name}</div>,
  FileTreeFolder: ({ name, children }: { name: string; children?: ReactNode }) => (
    <div data-testid={`folder-${name}`}>
      <span>{name}</span>
      {children}
    </div>
  ),
}));

const WORKSPACES: Record<string, Workspace> = {
  "ws-1": {
    id: "ws-1",
    name: "tokyo",
    branch: "workspace/tokyo",
    status: "idle",
    createdAt: "2026-02-12T00:00:00.000Z",
  },
  "ws-2": {
    id: "ws-2",
    name: "kyoto",
    branch: "workspace/kyoto",
    status: "idle",
    createdAt: "2026-02-12T00:00:00.000Z",
  },
};

const FILE_TREE: WorkspaceFileTreeNode[] = [
  {
    type: "directory",
    name: "src",
    path: "src",
    children: [{ type: "file", name: "index.ts", path: "src/index.ts" }],
  },
];

function TestControls() {
  const { activeTerminals, visibleTerminalWsId, closeTerminal } = useTerminalContext();
  const navigate = useNavigate();
  return (
    <div>
      <button type="button" onClick={() => closeTerminal("ws-1")}>close ws-1</button>
      <button type="button" onClick={() => navigate("/workspaces/ws-2")}>go ws-2</button>
      <div data-testid="ctx-active">{[...activeTerminals].sort().join(",")}</div>
      <div data-testid="ctx-visible">{visibleTerminalWsId ?? "none"}</div>
    </div>
  );
}

function renderWorkspace(initialEntry = "/workspaces/ws-1") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <TerminalProvider>
        <TestControls />
        <Routes>
          <Route path="/workspaces/:wsId" element={<WorkspaceView />} />
        </Routes>
      </TerminalProvider>
    </MemoryRouter>,
  );
}

describe("WorkspaceView terminal behavior", () => {
  beforeEach(() => {
    mocks.apiGet.mockReset();
    mocks.useConversation.mockReset();
    mocks.useSessions.mockReset();
    mocks.useDiffStat.mockReset();
    mocks.sendMessage.mockReset();
    mocks.stopStreaming.mockReset();
    mocks.clearChat.mockReset();
    mocks.switchSession.mockReset();
    mocks.answerQuestion.mockReset();
    mocks.batchAnswerQuestions.mockReset();
    mocks.approvePlan.mockReset();
    mocks.rejectToolInput.mockReset();
    mocks.createSession.mockReset();
    mocks.activateSession.mockReset();
    mocks.deleteSession.mockReset();
    mocks.refreshSessions.mockReset();
    mocks.refreshDiffStat.mockReset();

    mocks.apiGet.mockImplementation(async (url: string) => {
      const workspaceMatch = url.match(/^\/api\/workspaces\/([^/]+)$/);
      const filesMatch = url.match(/^\/api\/workspaces\/([^/]+)\/files$/);
      if (workspaceMatch) return WORKSPACES[workspaceMatch[1]] ?? null;
      if (filesMatch) return FILE_TREE;
      throw new Error(`Unexpected URL: ${url}`);
    });

    mocks.useConversation.mockReturnValue({
      messages: [],
      isStreaming: false,
      workspaceStatus: "idle",
      currentStreamingText: "",
      currentThinking: "",
      activeToolCalls: [],
      pendingToolInputs: [],
      connectionStatus: "connected",
      error: null,
      sessionId: undefined,
      sendMessage: mocks.sendMessage,
      stopStreaming: mocks.stopStreaming,
      clearChat: mocks.clearChat,
      switchSession: mocks.switchSession,
      answerQuestion: mocks.answerQuestion,
      batchAnswerQuestions: mocks.batchAnswerQuestions,
      approvePlan: mocks.approvePlan,
      rejectToolInput: mocks.rejectToolInput,
    });

    mocks.useSessions.mockReturnValue({
      sessions: [],
      createSession: mocks.createSession,
      activateSession: mocks.activateSession,
      deleteSession: mocks.deleteSession,
      refresh: mocks.refreshSessions,
    });

    mocks.useDiffStat.mockReturnValue({
      committed: [],
      uncommitted: [],
      totalCount: 0,
      loading: false,
      error: null,
      refresh: mocks.refreshDiffStat,
    });
  });

  it("opens terminal for the active workspace when Terminal toggle is clicked", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await screen.findByText("tokyo");
    await user.click(screen.getByRole("button", { name: "Terminal" }));

    expect(screen.getByTestId("ctx-active")).toHaveTextContent("ws-1");
    expect(screen.getByTestId("ctx-visible")).toHaveTextContent("ws-1");
  });

  it("hides terminal overlay when Chatbot toggle is clicked", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await screen.findByText("tokyo");
    await user.click(screen.getByRole("button", { name: "Terminal" }));
    expect(screen.getByTestId("ctx-visible")).toHaveTextContent("ws-1");

    await user.click(screen.getByRole("button", { name: "Chatbot" }));

    expect(screen.getByTestId("ctx-visible")).toHaveTextContent("none");
    expect(screen.getByTestId("ctx-active")).toHaveTextContent("ws-1");
  });

  it("switches back to chatbot view when terminal session exits", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await screen.findByText("tokyo");
    const chatbotButton = screen.getByRole("button", { name: "Chatbot" });
    const terminalButton = screen.getByRole("button", { name: "Terminal" });

    await user.click(terminalButton);
    expect(terminalButton.className).toContain("bg-primary/10");

    await user.click(screen.getByRole("button", { name: "close ws-1" }));

    await waitFor(() => {
      expect(chatbotButton.className).toContain("bg-primary/10");
    });
  });

  it("clears visible terminal when navigating to another workspace", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await screen.findByText("tokyo");
    await user.click(screen.getByRole("button", { name: "Terminal" }));
    expect(screen.getByTestId("ctx-visible")).toHaveTextContent("ws-1");

    await user.click(screen.getByRole("button", { name: "go ws-2" }));

    await screen.findByText("kyoto");
    expect(screen.getByTestId("ctx-visible")).toHaveTextContent("none");
  });

  it("shows QuestionPanel instead of ChatInput when AskUserQuestion is pending", async () => {
    mocks.useConversation.mockReturnValue({
      messages: [],
      isStreaming: false,
      workspaceStatus: "idle",
      currentStreamingText: "",
      currentThinking: "",
      activeToolCalls: [],
      pendingToolInputs: [
        {
          requestId: "req-ask",
          toolName: "AskUserQuestion",
          toolUseId: "ask-1",
          input: { questions: [{ question: "Pick one", options: [{ label: "A" }] }] },
        },
      ],
      connectionStatus: "connected",
      error: null,
      sessionId: undefined,
      sendMessage: mocks.sendMessage,
      stopStreaming: mocks.stopStreaming,
      clearChat: mocks.clearChat,
      switchSession: mocks.switchSession,
      answerQuestion: mocks.answerQuestion,
      batchAnswerQuestions: mocks.batchAnswerQuestions,
      approvePlan: mocks.approvePlan,
      rejectToolInput: mocks.rejectToolInput,
    });

    renderWorkspace();
    await screen.findByText("tokyo");

    expect(screen.getByTestId("question-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-input")).not.toBeInTheDocument();
  });

  it("wires QuestionPanel submit and dismiss actions to conversation callbacks", async () => {
    const user = userEvent.setup();
    mocks.useConversation.mockReturnValue({
      messages: [],
      isStreaming: false,
      workspaceStatus: "idle",
      currentStreamingText: "",
      currentThinking: "",
      activeToolCalls: [],
      pendingToolInputs: [
        {
          requestId: "req-ask",
          toolName: "AskUserQuestion",
          toolUseId: "ask-1",
          input: { questions: [{ question: "Pick one", options: [{ label: "A" }] }] },
        },
      ],
      connectionStatus: "connected",
      error: null,
      sessionId: undefined,
      sendMessage: mocks.sendMessage,
      stopStreaming: mocks.stopStreaming,
      clearChat: mocks.clearChat,
      switchSession: mocks.switchSession,
      answerQuestion: mocks.answerQuestion,
      batchAnswerQuestions: mocks.batchAnswerQuestions,
      approvePlan: mocks.approvePlan,
      rejectToolInput: mocks.rejectToolInput,
    });

    renderWorkspace();
    await screen.findByText("tokyo");

    await user.click(screen.getByRole("button", { name: "submit questions" }));
    expect(mocks.batchAnswerQuestions).toHaveBeenCalledWith([{ toolUseId: "ask-1", answers: [] }]);

    await user.click(screen.getByRole("button", { name: "dismiss questions" }));
    expect(mocks.rejectToolInput).toHaveBeenCalledWith("cancel");
  });

  it("prefers projectName in header and shows origin default branch when provided", async () => {
    mocks.apiGet.mockImplementation(async (url: string) => {
      const workspaceMatch = url.match(/^\/api\/workspaces\/([^/]+)$/);
      const filesMatch = url.match(/^\/api\/workspaces\/([^/]+)\/files$/);
      if (workspaceMatch) {
        const workspace = WORKSPACES[workspaceMatch[1]];
        if (!workspace) return null;
        return {
          ...workspace,
          projectName: "hive",
          defaultBranch: "main",
        };
      }
      if (filesMatch) return FILE_TREE;
      throw new Error(`Unexpected URL: ${url}`);
    });

    renderWorkspace();

    await screen.findByText("hive");
    expect(screen.getByText("workspace/tokyo")).toBeInTheDocument();
    expect(screen.getByText("> origin/main")).toBeInTheDocument();
  });
});
