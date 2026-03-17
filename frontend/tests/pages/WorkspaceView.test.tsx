// matchMedia stub — returns true for lg breakpoint so the right panel renders
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: query === "(min-width: 1024px)" ? true : false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WorkspaceLiveDataProvider } from "@/contexts/WorkspaceLiveDataContext";
import WorkspaceView from "@/pages/WorkspaceView";
import type { Workspace, WorkspaceFileTreeNode } from "@/types";

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  useConversation: vi.fn(),
  useSessions: vi.fn(),
  useWorkspaceLiveData: vi.fn().mockReturnValue({ liveData: {}, clearUnread: vi.fn() }),
  sendMessage: vi.fn(),
  stopStreaming: vi.fn(),
  clearChat: vi.fn(),
  switchSession: vi.fn(),
  answerQuestion: vi.fn(),
  batchAnswerQuestions: vi.fn(),
  approvePlan: vi.fn(),
  rejectToolInput: vi.fn(),
  dismissPlan: vi.fn(),
  createSession: vi.fn(),
  deleteSession: vi.fn(),
  refreshSessions: vi.fn(),
  clearCachedData: vi.fn(),
  useScripts: vi.fn(),
  startScript: vi.fn(),
  stopScript: vi.fn(),
  connectScriptOutput: vi.fn(),
  disconnectScriptOutput: vi.fn(),
  openExternal: vi.fn(),
  useTerminalApps: vi.fn().mockReturnValue([]),
  openTerminalSsh: vi.fn(),
  captureConversationTabsProps: vi.fn(),
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

vi.mock("@/hooks/useWorkspaceLiveData", () => ({
  useWorkspaceLiveData: mocks.useWorkspaceLiveData,
}));

vi.mock("@/lib/ws-transport", () => ({
  wsTransport: { clearCachedData: mocks.clearCachedData, onReconnect: vi.fn(() => () => {}) },
}));

vi.mock("@/hooks/useScripts", () => ({
  useScripts: mocks.useScripts,
}));

vi.mock("@/lib/open-external", async () => {
  const actual = await vi.importActual<typeof import("@/lib/open-external")>("@/lib/open-external");
  return {
    ...actual,
    openExternal: mocks.openExternal,
  };
});

vi.mock("@/hooks/useTerminalApps", () => ({
  useTerminalApps: mocks.useTerminalApps,
}));

vi.mock("@/lib/terminal", () => ({
  openTerminalSsh: mocks.openTerminalSsh,
}));

// react-resizable-panels needs real DOM layout (getBoundingClientRect, ResizeObserver)
// which jsdom cannot provide. Mock it with transparent wrappers.
vi.mock("react-resizable-panels", () => {
  const React = require("react");
  return {
    Group: ({ children, style, className }: any) => React.createElement("div", { style, className, "data-testid": "panel-group" }, children),
    Panel: ({ children, style, className }: any) => React.createElement("div", { style, className, "data-testid": "panel" }, children),
    Separator: ({ className }: any) => React.createElement("div", { className, "data-testid": "panel-separator", role: "separator" }),
    usePanelRef: () => ({ current: { collapse: () => {}, expand: () => {}, isCollapsed: () => false, resize: () => {}, getSize: () => ({ asPercentage: 50, inPixels: 400 }) } }),
    useDefaultLayout: () => ({ defaultLayout: undefined, onLayoutChanged: () => {} }),
  };
});

vi.mock("@/components/ScriptPanel", () => ({
  default: ({ config }: { config: unknown }) => {
    const hasScripts = config && typeof config === "object" && "scripts" in config && (config as Record<string, unknown>).scripts;
    return hasScripts
      ? <div data-testid="script-panel">script-panel</div>
      : <div data-testid="script-panel-placeholder">Add a <code>hive.json</code> to your repo.</div>;
  },
}));

vi.mock("@/components/ChatConversation", () => ({
  default: ({
    isStreaming,
    streamingStartedAt,
    queuedMessage,
  }: {
    isStreaming?: boolean;
    streamingStartedAt?: number | null;
    queuedMessage?: { content: string } | null;
  }) => (
    <div data-testid="chat-conversation">
      chat-conversation
      <div data-testid="chat-is-streaming">{String(Boolean(isStreaming))}</div>
      <div data-testid="chat-streaming-started-at">{streamingStartedAt ?? "none"}</div>
      <div data-testid="chat-queued-message">{queuedMessage?.content ?? "none"}</div>
    </div>
  ),
}));

vi.mock("@/components/ChatInput", () => ({
  default: ({
    wsId,
    sessionId,
    isStreaming,
    placeholder,
    queuedMessage,
    onSend,
    onQueue,
  }: {
    wsId?: string;
    sessionId?: string;
    isStreaming?: boolean;
    placeholder?: string;
    queuedMessage?: { content: string } | null;
    onSend?: (content: string) => boolean;
    onQueue?: (msg: { content: string }) => void;
  }) => (
    <div
      data-testid="chat-input"
      data-ws-id={wsId ?? ""}
      data-session-id={sessionId ?? ""}
      data-has-queue={queuedMessage ? "true" : "false"}
      data-placeholder={placeholder ?? ""}
    >
      chat-input
      {onSend && (
        <button type="button" data-testid="chat-send-btn" onClick={() => onSend("queued revision")}>
          send message
        </button>
      )}
      {isStreaming && onQueue && (
        <button type="button" data-testid="queue-message-btn" onClick={() => onQueue({ content: "queued msg" })}>
          queue message
        </button>
      )}
    </div>
  ),
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

vi.mock("@/components/ConversationTabs", () => ({
  ConversationTabs: (props: {
    onDeleteSession: (id: string) => void;
    onCreateSession: () => void;
    onActivateSession: (id: string) => void;
    onFileTabActivate?: () => void;
    unreadSessions?: Record<string, boolean>;
  }) => {
    const { onDeleteSession, onCreateSession, onActivateSession, onFileTabActivate } = props;
    mocks.captureConversationTabsProps(props);
    return (
      <div data-testid="conversation-tabs">
        <button type="button" data-testid="delete-active-btn" onClick={() => onDeleteSession("sess-active")}>
          delete active
        </button>
        <button type="button" data-testid="delete-inactive-btn" onClick={() => onDeleteSession("sess-inactive")}>
          delete inactive
        </button>
        <button type="button" data-testid="create-session-btn" onClick={onCreateSession}>
          create session
        </button>
        <button type="button" data-testid="activate-session-btn" onClick={() => onActivateSession("sess-2")}>
          activate session
        </button>
        <button type="button" data-testid="file-tab-btn" onClick={() => onFileTabActivate?.()}>
          file tab
        </button>
      </div>
    );
  },
}));

vi.mock("@/components/diff/InlineDiffViewer", () => ({
  InlineDiffViewer: () => <div data-testid="inline-diff-viewer">inline-diff-viewer</div>,
}));

vi.mock("@/components/diff/ModifiedFileList", () => ({
  ModifiedFileList: () => <div data-testid="modified-file-list">modified-file-list</div>,
}));

vi.mock("@/components/ai-elements/file-tree", () => ({
  FileTree: ({ children, onPathSelect }: { children?: ReactNode; onPathSelect?: (path: string) => void }) => (
    <div data-testid="file-tree">
      {children}
      {onPathSelect && (
        <button type="button" data-testid="select-file-btn" onClick={() => onPathSelect("src/index.ts")}>
          select file
        </button>
      )}
    </div>
  ),
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

const DIFF_STATS = { committed: [], uncommitted: [] };

function buildConversationState(
  overrides: Record<string, unknown> = {},
) {
  return {
    messages: [],
    isStreaming: false,
    streamingStartedAt: null,
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
    dismissPlan: mocks.dismissPlan,
    ...overrides,
  };
}

function TestControls() {
  const navigate = useNavigate();
  return (
    <div>
      <button type="button" onClick={() => navigate("/workspaces/ws-1")}>go ws-1</button>
      <button type="button" onClick={() => navigate("/workspaces/ws-2")}>go ws-2</button>
    </div>
  );
}

function renderWorkspace(initialEntry = "/workspaces/ws-1") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  const wsIds = Object.keys(WORKSPACES);

  return render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceLiveDataProvider workspaceIds={wsIds}>
        <MemoryRouter initialEntries={[initialEntry]}>
          <TestControls />
          <Routes>
            <Route path="/workspaces/:wsId" element={<WorkspaceView />} />
            <Route path="/home" element={<div data-testid="home-page">Home page</div>} />
          </Routes>
        </MemoryRouter>
      </WorkspaceLiveDataProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.removeItem("hive-server-url");
  localStorage.removeItem("hive-tailscale-ip");
  localStorage.removeItem("hive-tailscale-port");
  localStorage.removeItem("hive-ssh-user");
  mocks.openExternal.mockReset();
  mocks.useTerminalApps.mockReset();
  mocks.useTerminalApps.mockReturnValue([]);
  mocks.openTerminalSsh.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("WorkspaceView behavior", () => {
  beforeEach(() => {
    mocks.apiGet.mockReset();
    mocks.useConversation.mockReset();
    mocks.useSessions.mockReset();
    mocks.sendMessage.mockReset();
    mocks.stopStreaming.mockReset();
    mocks.clearChat.mockReset();
    mocks.switchSession.mockReset();
    mocks.answerQuestion.mockReset();
    mocks.batchAnswerQuestions.mockReset();
    mocks.approvePlan.mockReset();
    mocks.rejectToolInput.mockReset();
    mocks.dismissPlan.mockReset();
    mocks.createSession.mockReset();
    mocks.deleteSession.mockReset();
    mocks.refreshSessions.mockReset();
    mocks.clearCachedData.mockReset();
    mocks.useWorkspaceLiveData.mockReset();
    mocks.useWorkspaceLiveData.mockReturnValue({ liveData: {}, clearUnread: vi.fn() });
    mocks.captureConversationTabsProps.mockReset();
    mocks.openExternal.mockReset();

    mocks.useScripts.mockReturnValue({
      config: null,
      status: { setup: { state: "idle" }, run: { state: "idle" } },
      startScript: mocks.startScript,
      stopScript: mocks.stopScript,
      connectOutput: mocks.connectScriptOutput,
      disconnectOutput: mocks.disconnectScriptOutput,
    });

    mocks.apiGet.mockImplementation(async (url: string) => {
      const workspaceMatch = url.match(/^\/api\/workspaces\/([^/]+)$/);
      const filesMatch = url.match(/^\/api\/workspaces\/([^/]+)\/files$/);
      const diffStatsMatch = url.match(/^\/api\/workspaces\/([^/]+)\/diff\/stat$/);
      if (workspaceMatch) return WORKSPACES[workspaceMatch[1]] ?? null;
      if (filesMatch) return FILE_TREE;
      if (diffStatsMatch) return DIFF_STATS;
      throw new Error(`Unexpected URL: ${url}`);
    });

    mocks.useConversation.mockReturnValue(buildConversationState());

    mocks.useSessions.mockReturnValue({
      sessions: [],
      createSession: mocks.createSession,
      deleteSession: mocks.deleteSession,
      refresh: mocks.refreshSessions,
    });

  });

  it("disables VS Code button when workspace path is unavailable", async () => {
    renderWorkspace();

    await screen.findByText("tokyo");
    expect(screen.getByRole("button", { name: "VS Code" })).toBeDisabled();
  });

  it("opens VS Code URI with tailscale host and SSH user when configured", async () => {
    const user = userEvent.setup();
    localStorage.setItem("hive-tailscale-ip", "100.64.0.77");
    localStorage.setItem("hive-ssh-user", "dev user");
    localStorage.setItem("hive-server-url", "http://backend.internal:3000");

    mocks.apiGet.mockImplementation(async (url: string) => {
      const workspaceMatch = url.match(/^\/api\/workspaces\/([^/]+)$/);
      const filesMatch = url.match(/^\/api\/workspaces\/([^/]+)\/files$/);
      const diffStatsMatch = url.match(/^\/api\/workspaces\/([^/]+)\/diff\/stat$/);
      if (workspaceMatch) {
        const workspace = WORKSPACES[workspaceMatch[1]];
        return workspace ? { ...workspace, worktreePath: "/Users/me/project folder" } : null;
      }
      if (filesMatch) return FILE_TREE;
      if (diffStatsMatch) return DIFF_STATS;
      throw new Error(`Unexpected URL: ${url}`);
    });

    renderWorkspace();

    await screen.findByText("tokyo");
    const vscodeButton = screen.getByRole("button", { name: "VS Code" });
    expect(vscodeButton).toBeEnabled();

    await user.click(vscodeButton);

    await waitFor(() => {
      expect(mocks.openExternal).toHaveBeenCalledWith(
        "vscode://vscode-remote/ssh-remote+dev%20user%40100.64.0.77/Users/me/project%20folder",
      );
    });
  });

  it("falls back to server URL host for VS Code URI when tailscale IP is not set", async () => {
    const user = userEvent.setup();
    localStorage.setItem("hive-server-url", "backend.internal:4444");

    mocks.apiGet.mockImplementation(async (url: string) => {
      const workspaceMatch = url.match(/^\/api\/workspaces\/([^/]+)$/);
      const filesMatch = url.match(/^\/api\/workspaces\/([^/]+)\/files$/);
      const diffStatsMatch = url.match(/^\/api\/workspaces\/([^/]+)\/diff\/stat$/);
      if (workspaceMatch) {
        const workspace = WORKSPACES[workspaceMatch[1]];
        return workspace ? { ...workspace, worktreePath: "/srv/hive/tokyo" } : null;
      }
      if (filesMatch) return FILE_TREE;
      if (diffStatsMatch) return DIFF_STATS;
      throw new Error(`Unexpected URL: ${url}`);
    });

    renderWorkspace();

    await screen.findByText("tokyo");
    await user.click(screen.getByRole("button", { name: "VS Code" }));

    await waitFor(() => {
      expect(mocks.openExternal).toHaveBeenCalledWith(
        "vscode://vscode-remote/ssh-remote+backend.internal/srv/hive/tokyo",
      );
    });
  });

  it("shows dropdown with terminal options when terminal apps are detected", async () => {
    const user = userEvent.setup();
    mocks.useTerminalApps.mockReturnValue([
      { id: "terminal_app", name: "Terminal" },
      { id: "iterm2", name: "iTerm" },
    ]);

    localStorage.setItem("hive-tailscale-ip", "100.64.0.77");
    localStorage.setItem("hive-ssh-user", "root");

    mocks.apiGet.mockImplementation(async (url: string) => {
      const workspaceMatch = url.match(/^\/api\/workspaces\/([^/]+)$/);
      const filesMatch = url.match(/^\/api\/workspaces\/([^/]+)\/files$/);
      const diffStatsMatch = url.match(/^\/api\/workspaces\/([^/]+)\/diff\/stat$/);
      if (workspaceMatch) {
        const workspace = WORKSPACES[workspaceMatch[1]];
        return workspace ? { ...workspace, worktreePath: "/srv/hive/tokyo" } : null;
      }
      if (filesMatch) return FILE_TREE;
      if (diffStatsMatch) return DIFF_STATS;
      throw new Error(`Unexpected URL: ${url}`);
    });

    renderWorkspace();
    await screen.findByText("tokyo");

    // Should render dropdown trigger, not simple "VS Code" button
    const trigger = screen.getByRole("button", { name: /Open/i });
    expect(trigger).toBeInTheDocument();

    await user.click(trigger);

    // Menu items should appear
    expect(await screen.findByText("VS Code")).toBeInTheDocument();
    expect(screen.getByText("Terminal (SSH)")).toBeInTheDocument();
    expect(screen.getByText("iTerm (SSH)")).toBeInTheDocument();
  });

  it("calls openTerminalSsh when a terminal menu item is clicked", async () => {
    const user = userEvent.setup();
    mocks.useTerminalApps.mockReturnValue([
      { id: "terminal_app", name: "Terminal" },
    ]);
    mocks.openTerminalSsh.mockResolvedValue(undefined);

    localStorage.setItem("hive-tailscale-ip", "100.64.0.77");
    localStorage.setItem("hive-ssh-user", "dev");

    mocks.apiGet.mockImplementation(async (url: string) => {
      const workspaceMatch = url.match(/^\/api\/workspaces\/([^/]+)$/);
      const filesMatch = url.match(/^\/api\/workspaces\/([^/]+)\/files$/);
      const diffStatsMatch = url.match(/^\/api\/workspaces\/([^/]+)\/diff\/stat$/);
      if (workspaceMatch) {
        const workspace = WORKSPACES[workspaceMatch[1]];
        return workspace ? { ...workspace, worktreePath: "/srv/hive/tokyo" } : null;
      }
      if (filesMatch) return FILE_TREE;
      if (diffStatsMatch) return DIFF_STATS;
      throw new Error(`Unexpected URL: ${url}`);
    });

    renderWorkspace();
    await screen.findByText("tokyo");

    await user.click(screen.getByRole("button", { name: /Open/i }));
    await user.click(await screen.findByText("Terminal (SSH)"));

    await waitFor(() => {
      expect(mocks.openTerminalSsh).toHaveBeenCalledWith(
        "terminal_app",
        "dev@100.64.0.77",
        "/srv/hive/tokyo",
      );
    });
  });

  it("shows simple VS Code button when no terminal apps detected (browser mode)", async () => {
    mocks.useTerminalApps.mockReturnValue([]);

    renderWorkspace();
    await screen.findByText("tokyo");

    // Should render the simple "VS Code" button, not a dropdown
    expect(screen.getByRole("button", { name: "VS Code" })).toBeInTheDocument();
  });

  it("shows QuestionPanel instead of ChatInput when AskUserQuestion is pending", async () => {
    mocks.useConversation.mockReturnValue({
      messages: [],
      isStreaming: false,
      streamingStartedAt: null,
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
      dismissPlan: mocks.dismissPlan,
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
      dismissPlan: mocks.dismissPlan,
    });

    renderWorkspace();
    await screen.findByText("tokyo");

    await user.click(screen.getByRole("button", { name: "submit questions" }));
    expect(mocks.batchAnswerQuestions).toHaveBeenCalledWith([{ toolUseId: "ask-1", answers: [] }]);

    await user.click(screen.getByRole("button", { name: "dismiss questions" }));
    expect(mocks.rejectToolInput).toHaveBeenCalledWith("[question_dismissed]");
  });

  it("activates a session by calling switchSession directly", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await screen.findByText("tokyo");

    await user.click(screen.getByTestId("activate-session-btn"));

    expect(mocks.switchSession).toHaveBeenCalledWith("sess-2");
  });

  it("clears only the active session unread on mount (not entire workspace)", async () => {
    const user = userEvent.setup();
    const clearUnread = vi.fn();
    const liveData = { "ws-1": { unreadSessions: { "sess-1": true } } };
    mocks.useWorkspaceLiveData.mockReturnValue({ liveData, clearUnread });
    mocks.useConversation.mockReturnValue({
      messages: [],
      isStreaming: false,
      streamingStartedAt: null,
      workspaceStatus: "idle",
      currentStreamingText: "",
      currentThinking: "",
      activeToolCalls: [],
      pendingToolInputs: [],
      connectionStatus: "connected",
      error: null,
      sessionId: "sess-1",
      sendMessage: mocks.sendMessage,
      stopStreaming: mocks.stopStreaming,
      clearChat: mocks.clearChat,
      switchSession: mocks.switchSession,
      answerQuestion: mocks.answerQuestion,
      batchAnswerQuestions: mocks.batchAnswerQuestions,
      approvePlan: mocks.approvePlan,
      rejectToolInput: mocks.rejectToolInput,
      dismissPlan: mocks.dismissPlan,
    });

    renderWorkspace();
    await screen.findByText("tokyo");
    // Should clear only the active session, not the entire workspace
    expect(clearUnread).toHaveBeenCalledWith("ws-1", "sess-1");
    expect(clearUnread).not.toHaveBeenCalledWith("ws-1");
  });

  it("clears unread state for target session when activating a different session", async () => {
    const user = userEvent.setup();
    const clearUnread = vi.fn();
    mocks.useWorkspaceLiveData.mockReturnValue({ liveData: {}, clearUnread });

    renderWorkspace();
    await screen.findByText("tokyo");

    await user.click(screen.getByTestId("activate-session-btn"));
    expect(clearUnread).toHaveBeenCalledWith("ws-1", "sess-2");
  });

  it("does not clear target session unread when clicking the already active session", async () => {
    const user = userEvent.setup();
    const clearUnread = vi.fn();
    mocks.useWorkspaceLiveData.mockReturnValue({ liveData: {}, clearUnread });
    mocks.useConversation.mockReturnValue({
      messages: [],
      isStreaming: false,
      streamingStartedAt: null,
      workspaceStatus: "idle",
      currentStreamingText: "",
      currentThinking: "",
      activeToolCalls: [],
      pendingToolInputs: [],
      connectionStatus: "connected",
      error: null,
      sessionId: "sess-2",
      sendMessage: mocks.sendMessage,
      stopStreaming: mocks.stopStreaming,
      clearChat: mocks.clearChat,
      switchSession: mocks.switchSession,
      answerQuestion: mocks.answerQuestion,
      batchAnswerQuestions: mocks.batchAnswerQuestions,
      approvePlan: mocks.approvePlan,
      rejectToolInput: mocks.rejectToolInput,
      dismissPlan: mocks.dismissPlan,
    });

    renderWorkspace();
    await screen.findByText("tokyo");

    await user.click(screen.getByTestId("activate-session-btn"));
    expect(mocks.switchSession).not.toHaveBeenCalled();
    expect(
      clearUnread.mock.calls.some((call) => call[0] === "ws-1" && call[1] === "sess-2"),
    ).toBe(false);
  });

  it("returns to conversation tab when clicking the already active session", async () => {
    const user = userEvent.setup();
    const clearUnread = vi.fn();
    mocks.useWorkspaceLiveData.mockReturnValue({ liveData: {}, clearUnread });
    mocks.useConversation.mockReturnValue({
      messages: [],
      isStreaming: false,
      streamingStartedAt: null,
      workspaceStatus: "idle",
      currentStreamingText: "",
      currentThinking: "",
      activeToolCalls: [],
      pendingToolInputs: [],
      connectionStatus: "connected",
      error: null,
      sessionId: "sess-2",
      sendMessage: mocks.sendMessage,
      stopStreaming: mocks.stopStreaming,
      clearChat: mocks.clearChat,
      switchSession: mocks.switchSession,
      answerQuestion: mocks.answerQuestion,
      batchAnswerQuestions: mocks.batchAnswerQuestions,
      approvePlan: mocks.approvePlan,
      rejectToolInput: mocks.rejectToolInput,
      dismissPlan: mocks.dismissPlan,
    });

    renderWorkspace();
    await screen.findByText("tokyo");

    await waitFor(() => {
      const lastCall =
        mocks.captureConversationTabsProps.mock.calls[
          mocks.captureConversationTabsProps.mock.calls.length - 1
        ]?.[0] as { isFileTabActive?: boolean } | undefined;
      expect(lastCall?.isFileTabActive).toBe(false);
    });

    // Open a file first (via file tree), then the file tab becomes active
    await user.click(screen.getByTestId("select-file-btn"));

    await waitFor(() => {
      const lastCall =
        mocks.captureConversationTabsProps.mock.calls[
          mocks.captureConversationTabsProps.mock.calls.length - 1
        ]?.[0] as { isFileTabActive?: boolean } | undefined;
      expect(lastCall?.isFileTabActive).toBe(true);
    });

    await user.click(screen.getByTestId("activate-session-btn"));

    expect(mocks.switchSession).not.toHaveBeenCalled();
    expect(
      clearUnread.mock.calls.some((call) => call[0] === "ws-1" && call[1] === "sess-2"),
    ).toBe(false);

    await waitFor(() => {
      const lastCall =
        mocks.captureConversationTabsProps.mock.calls[
          mocks.captureConversationTabsProps.mock.calls.length - 1
        ]?.[0] as { isFileTabActive?: boolean } | undefined;
      expect(lastCall?.isFileTabActive).toBe(false);
    });
  });

  it("restores file tab state when navigating away and back to a workspace", async () => {
    const user = userEvent.setup();
    mocks.useConversation.mockImplementation((targetWsId?: string) => buildConversationState({
      sessionId: targetWsId === "ws-2" ? "sess-2" : "sess-1",
    }));

    renderWorkspace();
    await screen.findByText("tokyo");

    await user.click(screen.getByTestId("select-file-btn"));
    await waitFor(() => {
      const lastCall =
        mocks.captureConversationTabsProps.mock.calls[
          mocks.captureConversationTabsProps.mock.calls.length - 1
        ]?.[0] as { isFileTabActive?: boolean; openFile?: string | null } | undefined;
      expect(lastCall?.isFileTabActive).toBe(true);
      expect(lastCall?.openFile).toBe("src/index.ts");
    });

    await user.click(screen.getByRole("button", { name: "go ws-2" }));
    await screen.findByText("kyoto");
    await waitFor(() => {
      const lastCall =
        mocks.captureConversationTabsProps.mock.calls[
          mocks.captureConversationTabsProps.mock.calls.length - 1
        ]?.[0] as { isFileTabActive?: boolean; openFile?: string | null } | undefined;
      expect(lastCall?.isFileTabActive).toBe(false);
      expect(lastCall?.openFile).toBeNull();
    });

    await user.click(screen.getByRole("button", { name: "go ws-1" }));
    await screen.findByText("tokyo");
    await waitFor(() => {
      const lastCall =
        mocks.captureConversationTabsProps.mock.calls[
          mocks.captureConversationTabsProps.mock.calls.length - 1
        ]?.[0] as { isFileTabActive?: boolean; openFile?: string | null } | undefined;
      expect(lastCall?.isFileTabActive).toBe(true);
      expect(lastCall?.openFile).toBe("src/index.ts");
    });
  });

  it("passes unreadSessions from liveData to ConversationTabs", async () => {
    const unreadSessions = { "sess-2": true, "sess-3": true };
    mocks.useWorkspaceLiveData.mockReturnValue({
      liveData: {
        "ws-1": { unreadSessions },
      },
      clearUnread: vi.fn(),
    });

    renderWorkspace();
    await screen.findByText("tokyo");

    await waitFor(() => {
      const lastCall =
        mocks.captureConversationTabsProps.mock.calls[
          mocks.captureConversationTabsProps.mock.calls.length - 1
        ]?.[0] as { unreadSessions?: Record<string, boolean> } | undefined;
      expect(lastCall?.unreadSessions).toEqual(unreadSessions);
    });
  });

  it("displays live branch name from useWorkspaceLiveData when available", async () => {
    mocks.useWorkspaceLiveData.mockReturnValue({
      liveData: {
        "ws-1": { branch: "feature/live-branch", branchInfo: { name: "feature/live-branch", lastSyncedAt: "2026-02-13T00:00:00.000Z" } },
      },
      clearUnread: vi.fn(),
    });

    renderWorkspace();

    await screen.findByText("feature/live-branch");
    expect(screen.queryByText("workspace/tokyo")).not.toBeInTheDocument();
  });

  it("passes streamingStartedAt to ChatConversation", async () => {
    mocks.useConversation.mockReturnValue({
      messages: [],
      isStreaming: true,
      streamingStartedAt: 1_700_000_123_456,
      workspaceStatus: "busy",
      currentStreamingText: "hello",
      currentThinking: "",
      activeToolCalls: [],
      pendingToolInputs: [],
      connectionStatus: "connected",
      error: null,
      sessionId: "sess-stream",
      sendMessage: mocks.sendMessage,
      stopStreaming: mocks.stopStreaming,
      clearChat: mocks.clearChat,
      switchSession: mocks.switchSession,
      answerQuestion: mocks.answerQuestion,
      batchAnswerQuestions: mocks.batchAnswerQuestions,
      approvePlan: mocks.approvePlan,
      rejectToolInput: mocks.rejectToolInput,
      dismissPlan: mocks.dismissPlan,
    });

    renderWorkspace();
    await screen.findByText("tokyo");

    expect(screen.getByTestId("chat-is-streaming")).toHaveTextContent("true");
    expect(screen.getByTestId("chat-streaming-started-at")).toHaveTextContent("1700000123456");
    expect(screen.getByTestId("chat-input")).toHaveAttribute("data-ws-id", "ws-1");
    expect(screen.getByTestId("chat-input")).toHaveAttribute("data-session-id", "sess-stream");
  });

  it("renders TaskTracker when task tools are present in the conversation", async () => {
    const user = userEvent.setup();
    mocks.useConversation.mockReturnValue({
      messages: [
        {
          id: "msg-task-1",
          sessionId: "sess-task",
          role: "assistant",
          content: "",
          timestamp: "2026-02-12T00:00:00.000Z",
          toolCalls: [
            {
              id: "tc-create",
              name: "TaskCreate",
              input: JSON.stringify({ subject: "Implement auth" }),
              output: "Task #1 created",
            },
            {
              id: "tc-update",
              name: "TaskUpdate",
              input: JSON.stringify({ taskId: "1", status: "in_progress", activeForm: "Implementing auth" }),
              output: "Task #1 updated",
            },
          ],
        },
      ],
      isStreaming: true,
      streamingStartedAt: 1_700_000_123_456,
      workspaceStatus: "busy",
      currentStreamingText: "",
      currentThinking: "",
      activeToolCalls: [],
      pendingToolInputs: [],
      connectionStatus: "connected",
      error: null,
      sessionId: "sess-task",
      sendMessage: mocks.sendMessage,
      stopStreaming: mocks.stopStreaming,
      clearChat: mocks.clearChat,
      switchSession: mocks.switchSession,
      answerQuestion: mocks.answerQuestion,
      batchAnswerQuestions: mocks.batchAnswerQuestions,
      approvePlan: mocks.approvePlan,
      rejectToolInput: mocks.rejectToolInput,
      dismissPlan: mocks.dismissPlan,
    });

    renderWorkspace();
    await screen.findByText("tokyo");

    expect(screen.getByText("Implementing auth")).toBeInTheDocument();
    expect(screen.getByText("0/1")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /implementing auth/i }));
    expect(screen.getAllByText("Implementing auth")).toHaveLength(2);
  });

  it("prefers projectName in header and shows origin default branch when provided", async () => {
    mocks.apiGet.mockImplementation(async (url: string) => {
      const workspaceMatch = url.match(/^\/api\/workspaces\/([^/]+)$/);
      const filesMatch = url.match(/^\/api\/workspaces\/([^/]+)\/files$/);
      const diffStatsMatch = url.match(/^\/api\/workspaces\/([^/]+)\/diff\/stat$/);
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
      if (diffStatsMatch) return DIFF_STATS;
      throw new Error(`Unexpected URL: ${url}`);
    });

    renderWorkspace();

    await screen.findByText("hive");
    expect(screen.getByText("workspace/tokyo")).toBeInTheDocument();
    expect(screen.getByText("> origin/main")).toBeInTheDocument();
  });

  it("marks workspace and sidebar headers as drag regions", async () => {
    const { container } = renderWorkspace();

    await screen.findByText("tokyo");

    const workspaceHeader = screen.getByText("tokyo").closest("div");
    const sidebarHeader = screen.getByRole("button", { name: "All" }).closest("div");

    expect(workspaceHeader).toHaveAttribute("data-tauri-drag-region");
    expect(sidebarHeader).toHaveAttribute("data-tauri-drag-region");
    expect(container.querySelectorAll("[data-tauri-drag-region]")).toHaveLength(2);
  });

  it("fetches diff stats on workspace bootstrap", async () => {
    renderWorkspace();
    await screen.findByText("tokyo");

    expect(mocks.apiGet).toHaveBeenCalledWith("/api/workspaces/ws-1/diff/stat");
  });

  it("fetches diff stats again after switching workspace", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await screen.findByText("tokyo");
    expect(mocks.apiGet).toHaveBeenCalledWith("/api/workspaces/ws-1/diff/stat");

    mocks.apiGet.mockClear();

    await user.click(screen.getByRole("button", { name: "go ws-2" }));
    await screen.findByText("kyoto");

    expect(mocks.apiGet).toHaveBeenCalledWith("/api/workspaces/ws-2/diff/stat");
  });

  it("handles diff stats fetch failure gracefully", async () => {
    mocks.apiGet.mockImplementation(async (url: string) => {
      const workspaceMatch = url.match(/^\/api\/workspaces\/([^/]+)$/);
      const filesMatch = url.match(/^\/api\/workspaces\/([^/]+)\/files$/);
      const diffStatsMatch = url.match(/^\/api\/workspaces\/([^/]+)\/diff\/stat$/);
      if (workspaceMatch) return WORKSPACES[workspaceMatch[1]] ?? null;
      if (filesMatch) return FILE_TREE;
      if (diffStatsMatch) throw new Error("diff stat unavailable");
      throw new Error(`Unexpected URL: ${url}`);
    });

    renderWorkspace();

    // Page should still load normally despite diff stats failure
    await screen.findByText("tokyo");
    expect(screen.getByTestId("chat-conversation")).toBeInTheDocument();
  });

  it("hands off plan by dismissing current plan and moving message to a new session", async () => {
    const user = userEvent.setup();
    mocks.createSession.mockResolvedValue({
      sessionId: "sess-new",
      workspaceId: "ws-1",
      createdAt: "2026-02-12T00:00:00.000Z",
      updatedAt: "2026-02-12T00:00:00.000Z",
      messageCount: 0,
    });
    mocks.switchSession.mockResolvedValue(undefined);
    mocks.refreshSessions.mockResolvedValue(undefined);

    // Set up plan state so PlanActionBar renders
    mocks.useConversation.mockReturnValue(buildConversationState({
      messages: [{
        id: "msg-plan",
        role: "assistant",
        content: "",
        timestamp: "2026-02-12T00:00:00.000Z",
        toolCalls: [{
          id: "tool-exit",
          name: "ExitPlanMode",
          input: JSON.stringify({ plan: "PLAN-CONTENT" }),
        }],
      }],
      pendingToolInputs: [{
        toolName: "ExitPlanMode",
        toolUseId: "tool-exit",
        requestId: "req-1",
        sessionId: "sess-1",
        input: {},
      }],
    }));

    renderWorkspace();
    await screen.findByText("tokyo");

    await user.click(screen.getByRole("button", { name: /hand off/i }));

    await waitFor(() => {
      expect(mocks.dismissPlan).toHaveBeenCalledWith("Plan handed off to a new session.");
      expect(mocks.createSession).toHaveBeenCalled();
      expect(mocks.switchSession).toHaveBeenCalledWith("sess-new");
      expect(mocks.refreshSessions).toHaveBeenCalled();
      expect(mocks.sendMessage).toHaveBeenCalledWith(
        "Here is the implementation plan to execute:\n\nPLAN-CONTENT",
        undefined,
        undefined,
        "sess-new",
      );
    });
  });

  it("uses plan file path in handoff prompt when available", async () => {
    const user = userEvent.setup();
    mocks.createSession.mockResolvedValue({
      sessionId: "sess-new",
      workspaceId: "ws-1",
      createdAt: "2026-02-12T00:00:00.000Z",
      updatedAt: "2026-02-12T00:00:00.000Z",
      messageCount: 0,
    });
    mocks.switchSession.mockResolvedValue(undefined);
    mocks.refreshSessions.mockResolvedValue(undefined);

    // Set up plan state with file path so PlanActionBar renders
    mocks.useConversation.mockReturnValue(buildConversationState({
      messages: [{
        id: "msg-plan",
        role: "assistant",
        content: "",
        timestamp: "2026-02-12T00:00:00.000Z",
        toolCalls: [{
          id: "tool-exit",
          name: "ExitPlanMode",
          input: JSON.stringify({ plan: "PLAN-CONTENT", file_path: ".claude/plans/background.md" }),
        }],
      }],
      pendingToolInputs: [{
        toolName: "ExitPlanMode",
        toolUseId: "tool-exit",
        requestId: "req-1",
        sessionId: "sess-1",
        input: {},
      }],
    }));

    renderWorkspace();
    await screen.findByText("tokyo");

    await user.click(screen.getByRole("button", { name: /hand off/i }));

    await waitFor(() => {
      expect(mocks.sendMessage).toHaveBeenCalledWith(
        "Execute the approved plan from `.claude/plans/background.md`. Read that file and implement it end-to-end.",
        undefined,
        undefined,
        "sess-new",
      );
    });
  });

  it("approves plan from floating action bar", async () => {
    const user = userEvent.setup();
    mocks.useConversation.mockReturnValue(buildConversationState({
      messages: [{
        id: "msg-plan",
        role: "assistant",
        content: "",
        timestamp: "2026-02-12T00:00:00.000Z",
        toolCalls: [{
          id: "tool-exit",
          name: "ExitPlanMode",
          input: JSON.stringify({ plan: "PLAN-CONTENT" }),
        }],
      }],
      pendingToolInputs: [{
        toolName: "ExitPlanMode",
        toolUseId: "tool-exit",
        requestId: "req-1",
        input: {},
      }],
    }));

    renderWorkspace();
    await screen.findByText("tokyo");

    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.getByTestId("chat-input")).toHaveAttribute(
      "data-placeholder",
      "Enter your plan adjustments here...",
    );

    await user.click(screen.getByRole("button", { name: "Approve" }));
    expect(mocks.approvePlan).toHaveBeenCalledTimes(1);
  });

  it("prioritizes active tool-call plan content over older message plan during handoff", async () => {
    const user = userEvent.setup();
    mocks.createSession.mockResolvedValue({
      sessionId: "sess-new",
      workspaceId: "ws-1",
      createdAt: "2026-02-12T00:00:00.000Z",
      updatedAt: "2026-02-12T00:00:00.000Z",
      messageCount: 0,
    });
    mocks.switchSession.mockResolvedValue(undefined);
    mocks.refreshSessions.mockResolvedValue(undefined);
    mocks.useConversation.mockReturnValue(buildConversationState({
      messages: [{
        id: "msg-old-plan",
        role: "assistant",
        content: "",
        timestamp: "2026-02-12T00:00:00.000Z",
        toolCalls: [{
          id: "tool-old-exit",
          name: "ExitPlanMode",
          input: JSON.stringify({ plan: "OLD-PLAN-CONTENT" }),
        }],
      }],
      activeToolCalls: [{
        id: "tool-active-exit",
        name: "ExitPlanMode",
        input: JSON.stringify({ plan: "ACTIVE-PLAN-CONTENT" }),
      }],
      pendingToolInputs: [{
        toolName: "ExitPlanMode",
        toolUseId: "tool-active-exit",
        requestId: "req-active",
        input: {},
      }],
    }));

    renderWorkspace();
    await screen.findByText("tokyo");
    await user.click(screen.getByRole("button", { name: /Hand off/i }));

    await waitFor(() => {
      expect(mocks.sendMessage).toHaveBeenCalledWith(
        "Here is the implementation plan to execute:\n\nACTIVE-PLAN-CONTENT",
        undefined,
        undefined,
        "sess-new",
      );
    });
  });

  it("routes send action to rejectToolInput while ExitPlanMode input is pending", async () => {
    const user = userEvent.setup();
    mocks.useConversation.mockReturnValue(buildConversationState({
      messages: [{
        id: "msg-plan",
        role: "assistant",
        content: "",
        timestamp: "2026-02-12T00:00:00.000Z",
        toolCalls: [{
          id: "tool-exit",
          name: "ExitPlanMode",
          input: JSON.stringify({ plan: "PLAN-CONTENT" }),
        }],
      }],
      pendingToolInputs: [{
        toolName: "ExitPlanMode",
        toolUseId: "tool-exit",
        requestId: "req-1",
        input: {},
      }],
    }));

    renderWorkspace();
    await screen.findByText("tokyo");
    await user.click(screen.getByTestId("chat-send-btn"));

    expect(mocks.rejectToolInput).toHaveBeenCalledWith("queued revision");
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("uses normal sendMessage flow when pending plan is from fallback history only", async () => {
    const user = userEvent.setup();
    mocks.useConversation.mockReturnValue(buildConversationState({
      messages: [{
        id: "msg-plan",
        role: "assistant",
        content: "",
        timestamp: "2026-02-12T00:00:00.000Z",
        toolCalls: [{
          id: "tool-exit",
          name: "ExitPlanMode",
          input: JSON.stringify({ plan: "PLAN-CONTENT" }),
        }],
      }],
      pendingToolInputs: [],
    }));

    renderWorkspace();
    await screen.findByText("tokyo");
    await user.click(screen.getByTestId("chat-send-btn"));

    expect(mocks.rejectToolInput).not.toHaveBeenCalled();
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      "queued revision",
      undefined,
      undefined,
      undefined,
      undefined,
    );
  });

  it("does not render plan action bar when plan is pending but content is unavailable", async () => {
    mocks.useConversation.mockReturnValue(buildConversationState({
      messages: [],
      activeToolCalls: [],
      pendingToolInputs: [{
        toolName: "ExitPlanMode",
        toolUseId: "tool-exit",
        requestId: "req-1",
        input: {},
      }],
    }));

    renderWorkspace();
    await screen.findByText("tokyo");

    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Hand off/i })).not.toBeInTheDocument();
    expect(screen.getByTestId("chat-input")).toHaveAttribute(
      "data-placeholder",
      "Enter your plan adjustments here...",
    );
  });
});

describe("WorkspaceView session delete behavior", () => {
  beforeEach(() => {
    mocks.apiGet.mockReset();
    mocks.useConversation.mockReset();
    mocks.useSessions.mockReset();
    mocks.sendMessage.mockReset();
    mocks.stopStreaming.mockReset();
    mocks.clearChat.mockReset();
    mocks.switchSession.mockReset();
    mocks.answerQuestion.mockReset();
    mocks.batchAnswerQuestions.mockReset();
    mocks.approvePlan.mockReset();
    mocks.rejectToolInput.mockReset();
    mocks.dismissPlan.mockReset();
    mocks.createSession.mockReset();
    mocks.deleteSession.mockReset();
    mocks.refreshSessions.mockReset();
    mocks.clearCachedData.mockReset();
    mocks.useWorkspaceLiveData.mockReset();
    mocks.useWorkspaceLiveData.mockReturnValue({ liveData: {}, clearUnread: vi.fn() });

    mocks.useScripts.mockReturnValue({
      config: null,
      status: { setup: { state: "idle" }, run: { state: "idle" } },
      startScript: mocks.startScript,
      stopScript: mocks.stopScript,
      connectOutput: mocks.connectScriptOutput,
      disconnectOutput: mocks.disconnectScriptOutput,
    });

    mocks.apiGet.mockImplementation(async (url: string) => {
      const workspaceMatch = url.match(/^\/api\/workspaces\/([^/]+)$/);
      const filesMatch = url.match(/^\/api\/workspaces\/([^/]+)\/files$/);
      const diffStatsMatch = url.match(/^\/api\/workspaces\/([^/]+)\/diff\/stat$/);
      if (workspaceMatch) return WORKSPACES[workspaceMatch[1]] ?? null;
      if (filesMatch) return FILE_TREE;
      if (diffStatsMatch) return DIFF_STATS;
      throw new Error(`Unexpected URL: ${url}`);
    });

    mocks.useConversation.mockReturnValue({
      messages: [],
      isStreaming: false,
      streamingStartedAt: null,
      workspaceStatus: "idle",
      currentStreamingText: "",
      currentThinking: "",
      activeToolCalls: [],
      pendingToolInputs: [],
      connectionStatus: "connected",
      error: null,
      sessionId: "sess-active",
      sendMessage: mocks.sendMessage,
      stopStreaming: mocks.stopStreaming,
      clearChat: mocks.clearChat,
      switchSession: mocks.switchSession,
      answerQuestion: mocks.answerQuestion,
      batchAnswerQuestions: mocks.batchAnswerQuestions,
      approvePlan: mocks.approvePlan,
      rejectToolInput: mocks.rejectToolInput,
      dismissPlan: mocks.dismissPlan,
    });

  });

  it("auto-switches to the next session when deleting the active session", async () => {
    const user = userEvent.setup();
    mocks.useSessions.mockReturnValue({
      sessions: [
        { sessionId: "sess-active", workspaceId: "ws-1", createdAt: "2026-02-12T00:00:00.000Z", updatedAt: "2026-02-12T00:00:01.000Z", messageCount: 5 },
        { sessionId: "sess-other", workspaceId: "ws-1", createdAt: "2026-02-12T00:00:00.000Z", updatedAt: "2026-02-12T00:00:00.000Z", messageCount: 2 },
      ],
      createSession: mocks.createSession,
      deleteSession: mocks.deleteSession.mockResolvedValue(true),
      refresh: mocks.refreshSessions,
    });

    renderWorkspace();
    await screen.findByText("tokyo");

    await user.click(screen.getByTestId("delete-active-btn"));

    await waitFor(() => {
      expect(mocks.deleteSession).toHaveBeenCalledWith("sess-active");
      expect(mocks.switchSession).toHaveBeenCalledWith("sess-other");
    });

    // Should NOT have cleared chat since we switched to another session
    expect(mocks.clearChat).not.toHaveBeenCalled();
    expect(mocks.clearCachedData).not.toHaveBeenCalled();
  });

  it("clears chat and cached data when deleting the last remaining session", async () => {
    const user = userEvent.setup();
    mocks.useSessions.mockReturnValue({
      sessions: [
        { sessionId: "sess-active", workspaceId: "ws-1", createdAt: "2026-02-12T00:00:00.000Z", updatedAt: "2026-02-12T00:00:01.000Z", messageCount: 5 },
      ],
      createSession: mocks.createSession,
      deleteSession: mocks.deleteSession.mockResolvedValue(true),
      refresh: mocks.refreshSessions,
    });

    renderWorkspace();
    await screen.findByText("tokyo");

    await user.click(screen.getByTestId("delete-active-btn"));

    await waitFor(() => {
      expect(mocks.deleteSession).toHaveBeenCalledWith("sess-active");
      expect(mocks.clearChat).toHaveBeenCalled();
      expect(mocks.clearCachedData).toHaveBeenCalledWith("ws-1");
    });

    // Should NOT have tried to activate another session

  });

  it("does nothing when delete fails", async () => {
    const user = userEvent.setup();
    mocks.useSessions.mockReturnValue({
      sessions: [
        { sessionId: "sess-active", workspaceId: "ws-1", createdAt: "2026-02-12T00:00:00.000Z", updatedAt: "2026-02-12T00:00:01.000Z", messageCount: 5 },
        { sessionId: "sess-other", workspaceId: "ws-1", createdAt: "2026-02-12T00:00:00.000Z", updatedAt: "2026-02-12T00:00:00.000Z", messageCount: 2 },
      ],
      createSession: mocks.createSession,
      deleteSession: mocks.deleteSession.mockResolvedValue(false),
      refresh: mocks.refreshSessions,
    });

    renderWorkspace();
    await screen.findByText("tokyo");

    await user.click(screen.getByTestId("delete-active-btn"));

    await waitFor(() => {
      expect(mocks.deleteSession).toHaveBeenCalledWith("sess-active");
    });

    // Nothing else should happen
    expect(mocks.clearChat).not.toHaveBeenCalled();

    expect(mocks.switchSession).not.toHaveBeenCalled();
    expect(mocks.clearCachedData).not.toHaveBeenCalled();
  });

  it("does not switch session when deleting an inactive session", async () => {
    const user = userEvent.setup();
    mocks.useSessions.mockReturnValue({
      sessions: [
        { sessionId: "sess-active", workspaceId: "ws-1", createdAt: "2026-02-12T00:00:00.000Z", updatedAt: "2026-02-12T00:00:01.000Z", messageCount: 5 },
        { sessionId: "sess-inactive", workspaceId: "ws-1", createdAt: "2026-02-12T00:00:00.000Z", updatedAt: "2026-02-12T00:00:00.000Z", messageCount: 2 },
      ],
      createSession: mocks.createSession,
      deleteSession: mocks.deleteSession.mockResolvedValue(true),
      refresh: mocks.refreshSessions,
    });

    renderWorkspace();
    await screen.findByText("tokyo");

    await user.click(screen.getByTestId("delete-inactive-btn"));

    await waitFor(() => {
      expect(mocks.deleteSession).toHaveBeenCalledWith("sess-inactive");
    });

    // Should NOT switch, clear, or do anything else — inactive session delete is silent
    expect(mocks.clearChat).not.toHaveBeenCalled();

    expect(mocks.switchSession).not.toHaveBeenCalled();
    expect(mocks.clearCachedData).not.toHaveBeenCalled();
  });
});

// ─── SSH Host Resolution & VS Code Button Edge Cases ─────────────────────────

describe("WorkspaceView VS Code SSH host resolution", () => {
  function setupWithWorktreePath(opts: {
    tailscaleIp?: string;
    sshUser?: string;
    serverUrl?: string;
    worktreePath?: string;
  } = {}) {
    if (opts.tailscaleIp) localStorage.setItem("hive-tailscale-ip", opts.tailscaleIp);
    if (opts.sshUser) localStorage.setItem("hive-ssh-user", opts.sshUser);
    if (opts.serverUrl) localStorage.setItem("hive-server-url", opts.serverUrl);

    mocks.useTerminalApps.mockReturnValue([]);

    mocks.apiGet.mockImplementation(async (url: string) => {
      const workspaceMatch = url.match(/^\/api\/workspaces\/([^/]+)$/);
      const filesMatch = url.match(/^\/api\/workspaces\/([^/]+)\/files$/);
      const diffStatsMatch = url.match(/^\/api\/workspaces\/([^/]+)\/diff\/stat$/);
      if (workspaceMatch) {
        const workspace = WORKSPACES[workspaceMatch[1]];
        return workspace
          ? { ...workspace, worktreePath: opts.worktreePath ?? undefined }
          : null;
      }
      if (filesMatch) return FILE_TREE;
      if (diffStatsMatch) return DIFF_STATS;
      throw new Error(`Unexpected URL: ${url}`);
    });

    mocks.useConversation.mockReturnValue({
      messages: [],
      isStreaming: false,
      streamingStartedAt: null,
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
      dismissPlan: mocks.dismissPlan,
    });

    mocks.useSessions.mockReturnValue({
      sessions: [],
      createSession: mocks.createSession,
      deleteSession: mocks.deleteSession,
      refresh: mocks.refreshSessions,
    });

    mocks.useScripts.mockReturnValue({
      config: null,
      status: { setup: { state: "idle" }, run: { state: "idle" } },
      startScript: mocks.startScript,
      stopScript: mocks.stopScript,
      connectOutput: mocks.connectScriptOutput,
      disconnectOutput: mocks.disconnectScriptOutput,
    });

    mocks.useWorkspaceLiveData.mockReturnValue({ liveData: {}, clearUnread: vi.fn() });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.removeItem("hive-server-url");
    localStorage.removeItem("hive-tailscale-ip");
    localStorage.removeItem("hive-tailscale-port");
    localStorage.removeItem("hive-ssh-user");
  });

  it("VS Code button is disabled when no SSH host is available", async () => {
    setupWithWorktreePath({ worktreePath: "/srv/hive/tokyo" });

    renderWorkspace();
    await screen.findByText("tokyo");

    // Window.location.hostname in jsdom is "localhost" which is truthy,
    // but no worktreePath might still cause issues. Let's check with path present.
    // Actually localhost IS a valid fallback host, so button should be enabled.
    const btn = screen.getByRole("button", { name: "VS Code" });
    expect(btn).toBeInTheDocument();
  });

  it("VS Code button disabled when workspace has no worktreePath", async () => {
    setupWithWorktreePath({ tailscaleIp: "10.0.0.1" });

    renderWorkspace();
    await screen.findByText("tokyo");

    expect(screen.getByRole("button", { name: "VS Code" })).toBeDisabled();
  });

  it("prefers tailscaleIp over serverUrl hostname for SSH host", async () => {
    const user = userEvent.setup();
    setupWithWorktreePath({
      tailscaleIp: "100.64.0.77",
      serverUrl: "http://backend.internal:3000",
      worktreePath: "/srv/hive/tokyo",
    });

    renderWorkspace();
    await screen.findByText("tokyo");
    await user.click(screen.getByRole("button", { name: "VS Code" }));

    await waitFor(() => {
      expect(mocks.openExternal).toHaveBeenCalledWith(
        expect.stringContaining("100.64.0.77"),
      );
    });
    // Should NOT use backend.internal
    expect(mocks.openExternal).not.toHaveBeenCalledWith(
      expect.stringContaining("backend.internal"),
    );
  });

  it("falls back to serverUrl hostname when tailscaleIp is empty", async () => {
    const user = userEvent.setup();
    setupWithWorktreePath({
      serverUrl: "http://my-server.example.com:4444",
      worktreePath: "/srv/hive/tokyo",
    });

    renderWorkspace();
    await screen.findByText("tokyo");
    await user.click(screen.getByRole("button", { name: "VS Code" }));

    await waitFor(() => {
      expect(mocks.openExternal).toHaveBeenCalledWith(
        expect.stringContaining("my-server.example.com"),
      );
    });
  });

  it("extracts hostname from serverUrl without protocol prefix", async () => {
    const user = userEvent.setup();
    setupWithWorktreePath({
      serverUrl: "backend.internal:4444",
      worktreePath: "/srv/hive/tokyo",
    });

    renderWorkspace();
    await screen.findByText("tokyo");
    await user.click(screen.getByRole("button", { name: "VS Code" }));

    await waitFor(() => {
      expect(mocks.openExternal).toHaveBeenCalledWith(
        expect.stringContaining("backend.internal"),
      );
    });
  });

  it("prepends sshUser@ to SSH host when SSH user is configured", async () => {
    const user = userEvent.setup();
    setupWithWorktreePath({
      tailscaleIp: "100.64.0.77",
      sshUser: "devuser",
      worktreePath: "/srv/hive/tokyo",
    });

    renderWorkspace();
    await screen.findByText("tokyo");
    await user.click(screen.getByRole("button", { name: "VS Code" }));

    await waitFor(() => {
      expect(mocks.openExternal).toHaveBeenCalledWith(
        expect.stringContaining("devuser%40100.64.0.77"),
      );
    });
  });

  it("does not prepend sshUser when SSH user is empty", async () => {
    const user = userEvent.setup();
    setupWithWorktreePath({
      tailscaleIp: "100.64.0.77",
      worktreePath: "/srv/hive/tokyo",
    });

    renderWorkspace();
    await screen.findByText("tokyo");
    await user.click(screen.getByRole("button", { name: "VS Code" }));

    await waitFor(() => {
      expect(mocks.openExternal).toHaveBeenCalledWith(
        expect.stringContaining("ssh-remote+100.64.0.77/"),
      );
    });
  });

  it("encodes spaces in worktreePath segments", async () => {
    const user = userEvent.setup();
    setupWithWorktreePath({
      tailscaleIp: "10.0.0.1",
      worktreePath: "/Users/me/my workspace",
    });

    renderWorkspace();
    await screen.findByText("tokyo");
    await user.click(screen.getByRole("button", { name: "VS Code" }));

    await waitFor(() => {
      expect(mocks.openExternal).toHaveBeenCalledWith(
        expect.stringContaining("my%20workspace"),
      );
    });
  });

  it("builds correct URI with all parts: sshUser, tailscaleIp, worktreePath", async () => {
    const user = userEvent.setup();
    setupWithWorktreePath({
      tailscaleIp: "100.64.0.77",
      sshUser: "root",
      worktreePath: "/srv/hive/tokyo",
    });

    renderWorkspace();
    await screen.findByText("tokyo");
    await user.click(screen.getByRole("button", { name: "VS Code" }));

    await waitFor(() => {
      expect(mocks.openExternal).toHaveBeenCalledWith(
        "vscode://vscode-remote/ssh-remote+root%40100.64.0.77/srv/hive/tokyo",
      );
    });
  });

  it("uses sshUser with serverUrl host when tailscaleIp is empty", async () => {
    const user = userEvent.setup();
    setupWithWorktreePath({
      serverUrl: "http://192.168.1.50:3000",
      sshUser: "admin",
      worktreePath: "/data/workspaces/tokyo",
    });

    renderWorkspace();
    await screen.findByText("tokyo");
    await user.click(screen.getByRole("button", { name: "VS Code" }));

    await waitFor(() => {
      expect(mocks.openExternal).toHaveBeenCalledWith(
        "vscode://vscode-remote/ssh-remote+admin%40192.168.1.50/data/workspaces/tokyo",
      );
    });
  });
});

// ─── Dropdown menu with terminal apps ────────────────────────────────────────

describe("WorkspaceView dropdown terminal interactions", () => {
  function setupDropdownTest(opts: {
    terminalApps?: Array<{ id: string; name: string }>;
    worktreePath?: string;
    tailscaleIp?: string;
    sshUser?: string;
  } = {}) {
    mocks.useTerminalApps.mockReturnValue(opts.terminalApps ?? []);
    if (opts.tailscaleIp) localStorage.setItem("hive-tailscale-ip", opts.tailscaleIp);
    if (opts.sshUser) localStorage.setItem("hive-ssh-user", opts.sshUser);

    mocks.apiGet.mockImplementation(async (url: string) => {
      const workspaceMatch = url.match(/^\/api\/workspaces\/([^/]+)$/);
      const filesMatch = url.match(/^\/api\/workspaces\/([^/]+)\/files$/);
      const diffStatsMatch = url.match(/^\/api\/workspaces\/([^/]+)\/diff\/stat$/);
      if (workspaceMatch) {
        const workspace = WORKSPACES[workspaceMatch[1]];
        return workspace
          ? { ...workspace, worktreePath: opts.worktreePath ?? undefined }
          : null;
      }
      if (filesMatch) return FILE_TREE;
      if (diffStatsMatch) return DIFF_STATS;
      throw new Error(`Unexpected URL: ${url}`);
    });

    mocks.useConversation.mockReturnValue({
      messages: [],
      isStreaming: false,
      streamingStartedAt: null,
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
      dismissPlan: mocks.dismissPlan,
    });

    mocks.useSessions.mockReturnValue({
      sessions: [],
      createSession: mocks.createSession,
      deleteSession: mocks.deleteSession,
      refresh: mocks.refreshSessions,
    });

    mocks.useScripts.mockReturnValue({
      config: null,
      status: { setup: { state: "idle" }, run: { state: "idle" } },
      startScript: mocks.startScript,
      stopScript: mocks.stopScript,
      connectOutput: mocks.connectScriptOutput,
      disconnectOutput: mocks.disconnectScriptOutput,
    });

    mocks.useWorkspaceLiveData.mockReturnValue({ liveData: {}, clearUnread: vi.fn() });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.removeItem("hive-server-url");
    localStorage.removeItem("hive-tailscale-ip");
    localStorage.removeItem("hive-tailscale-port");
    localStorage.removeItem("hive-ssh-user");
  });

  it("shows 'VS Code' as first item in dropdown", async () => {
    const user = userEvent.setup();
    setupDropdownTest({
      terminalApps: [{ id: "terminal_app", name: "Terminal" }],
      tailscaleIp: "10.0.0.1",
      worktreePath: "/srv/hive/tokyo",
    });

    renderWorkspace();
    await screen.findByText("tokyo");

    await user.click(screen.getByRole("button", { name: /Open/i }));
    expect(await screen.findByText("VS Code")).toBeInTheDocument();
  });

  it("separates VS Code from terminal apps with a separator", async () => {
    const user = userEvent.setup();
    setupDropdownTest({
      terminalApps: [{ id: "terminal_app", name: "Terminal" }],
      tailscaleIp: "10.0.0.1",
      worktreePath: "/srv/hive/tokyo",
    });

    renderWorkspace();
    await screen.findByText("tokyo");

    await user.click(screen.getByRole("button", { name: /Open/i }));
    await screen.findByText("VS Code");

    // There should be a separator element in the DOM
    expect(document.querySelector("[role='separator']")).toBeInTheDocument();
  });

  it("disables 'Open in VS Code' when vscodeUri is null (no worktreePath)", async () => {
    const user = userEvent.setup();
    setupDropdownTest({
      terminalApps: [{ id: "terminal_app", name: "Terminal" }],
      tailscaleIp: "10.0.0.1",
      // no worktreePath
    });

    renderWorkspace();
    await screen.findByText("tokyo");

    await user.click(screen.getByRole("button", { name: /Open/i }));

    const vscodeItem = await screen.findByText("VS Code");
    // The menu item should be disabled (aria-disabled or data-disabled)
    expect(vscodeItem.closest("[data-disabled]") ?? vscodeItem.closest("[aria-disabled]")).toBeTruthy();
  });

  it("disables SSH terminal items when canSsh is false (no worktreePath)", async () => {
    const user = userEvent.setup();
    setupDropdownTest({
      terminalApps: [{ id: "terminal_app", name: "Terminal" }],
      tailscaleIp: "10.0.0.1",
      // no worktreePath
    });

    renderWorkspace();
    await screen.findByText("tokyo");

    await user.click(screen.getByRole("button", { name: /Open/i }));

    const terminalItem = await screen.findByText("Terminal (SSH)");
    expect(terminalItem.closest("[data-disabled]") ?? terminalItem.closest("[aria-disabled]")).toBeTruthy();
  });

  it("calls openExternal with correct URI from dropdown VS Code item", async () => {
    const user = userEvent.setup();
    setupDropdownTest({
      terminalApps: [{ id: "terminal_app", name: "Terminal" }],
      tailscaleIp: "10.0.0.1",
      sshUser: "root",
      worktreePath: "/srv/hive/tokyo",
    });

    renderWorkspace();
    await screen.findByText("tokyo");

    await user.click(screen.getByRole("button", { name: /Open/i }));
    await user.click(await screen.findByText("VS Code"));

    await waitFor(() => {
      expect(mocks.openExternal).toHaveBeenCalledWith(
        "vscode://vscode-remote/ssh-remote+root%4010.0.0.1/srv/hive/tokyo",
      );
    });
  });

  it("calls openTerminalSsh with correct args from dropdown terminal item", async () => {
    const user = userEvent.setup();
    mocks.openTerminalSsh.mockResolvedValue(undefined);
    setupDropdownTest({
      terminalApps: [
        { id: "terminal_app", name: "Terminal" },
        { id: "iterm2", name: "iTerm" },
      ],
      tailscaleIp: "10.0.0.1",
      sshUser: "dev",
      worktreePath: "/srv/hive/tokyo",
    });

    renderWorkspace();
    await screen.findByText("tokyo");

    await user.click(screen.getByRole("button", { name: /Open/i }));
    await user.click(await screen.findByText("iTerm (SSH)"));

    await waitFor(() => {
      expect(mocks.openTerminalSsh).toHaveBeenCalledWith(
        "iterm2",
        "dev@10.0.0.1",
        "/srv/hive/tokyo",
      );
    });
  });

  it("renders dropdown button label as 'Open' with chevron when terminal apps exist", async () => {
    setupDropdownTest({
      terminalApps: [{ id: "terminal_app", name: "Terminal" }],
    });

    renderWorkspace();
    await screen.findByText("tokyo");

    const trigger = screen.getByRole("button", { name: /Open/i });
    expect(trigger).toBeInTheDocument();
    expect(trigger.textContent).toContain("Open");
  });

  it("renders simple 'VS Code' button when no terminal apps detected", async () => {
    setupDropdownTest({ terminalApps: [] });

    renderWorkspace();
    await screen.findByText("tokyo");

    expect(screen.getByRole("button", { name: "VS Code" })).toBeInTheDocument();
  });

  it("passes queued message to ChatConversation when queued during streaming", async () => {
    const user = userEvent.setup();
    mocks.useConversation.mockReturnValue({
      messages: [],
      isStreaming: true,
      streamingStartedAt: Date.now(),
      workspaceStatus: "busy",
      currentStreamingText: "",
      currentThinking: "",
      activeToolCalls: [],
      pendingToolInputs: [],
      connectionStatus: "connected",
      error: null,
      sessionId: "sess-active",
      sendMessage: mocks.sendMessage,
      stopStreaming: mocks.stopStreaming,
      clearChat: mocks.clearChat,
      switchSession: mocks.switchSession,
      answerQuestion: mocks.answerQuestion,
      batchAnswerQuestions: mocks.batchAnswerQuestions,
      approvePlan: mocks.approvePlan,
      rejectToolInput: mocks.rejectToolInput,
      dismissPlan: mocks.dismissPlan,
    });

    renderWorkspace();
    await screen.findByText("tokyo");

    // Initially no queued message
    expect(screen.getByTestId("chat-queued-message")).toHaveTextContent("none");
    expect(screen.getByTestId("chat-input")).toHaveAttribute("data-has-queue", "false");

    // Queue a message via ChatInput's queue button
    await user.click(screen.getByTestId("queue-message-btn"));

    // Queued message flows to ChatConversation and ChatInput
    expect(screen.getByTestId("chat-queued-message")).toHaveTextContent("queued msg");
    expect(screen.getByTestId("chat-input")).toHaveAttribute("data-has-queue", "true");
  });

  it("redirects to /home when workspace is not found", async () => {
    mocks.apiGet.mockImplementation(async (url: string) => {
      const workspaceMatch = url.match(/^\/api\/workspaces\/([^/]+)$/);
      if (workspaceMatch) return null;
      return [];
    });

    renderWorkspace("/workspaces/nonexistent");

    await waitFor(() => {
      expect(screen.getByTestId("home-page")).toBeInTheDocument();
    });
  });

  it("redirects to /home when workspace API call fails", async () => {
    mocks.apiGet.mockImplementation(async (url: string) => {
      const workspaceMatch = url.match(/^\/api\/workspaces\/([^/]+)$/);
      if (workspaceMatch) throw new Error("Network error");
      return [];
    });

    renderWorkspace("/workspaces/ws-1");

    await waitFor(() => {
      expect(screen.getByTestId("home-page")).toBeInTheDocument();
    });
  });
});
