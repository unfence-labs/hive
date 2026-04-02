import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({
  useConversation: vi.fn(),
  sendMessage: vi.fn(() => true),
  stopStreaming: vi.fn(),
  answerQuestion: vi.fn(),
  batchAnswerQuestions: vi.fn(),
  rejectToolInput: vi.fn(),
  switchSession: vi.fn(),
  createSession: vi.fn(async () => ({ sessionId: "new-sess", createdAt: "2025-01-01" })),
}));

vi.mock("@/hooks/useConversation", () => ({
  useConversation: mocks.useConversation,
}));

vi.mock("@/hooks/useSessions", () => ({
  useSessions: () => ({
    sessions: [{ sessionId: "sess-1", createdAt: "2025-01-01" }],
    createSession: mocks.createSession,
    deleteSession: vi.fn(),
    loading: false,
    refresh: vi.fn(),
  }),
}));

vi.mock("@/contexts/WorkspaceLiveDataContext", () => ({
  useWorkspaceLiveDataContext: () => liveDataRef,
}));

// ChatConversation renders complex scroll primitives; mock it to test tile-level behavior
vi.mock("@/components/ChatConversation", () => ({
  default: ({ messages, compactMode }: any) => (
    <div data-testid="chat-conversation" data-compact={compactMode ?? false}>
      {messages.map((m: any, i: number) => (
        <div key={i} data-testid="message">
          {m.content}
        </div>
      ))}
    </div>
  ),
}));

vi.mock("@/components/chat/QuestionPanel", () => ({
  default: () => <div data-testid="question-panel">QuestionPanel</div>,
}));

vi.mock("@/components/chat/AgentActivityPreview", () => ({
  default: ({ size }: { size: string }) => (
    <div data-testid="activity-preview" data-size={size} />
  ),
}));

vi.mock("@/components/BranchLabel", () => ({
  BranchLabel: ({ branch }: { branch: string }) => (
    <span data-testid="branch-label">{branch}</span>
  ),
}));

vi.mock("@/components/ChatInput", () => ({
  default: () => <div data-testid="chat-input">ChatInput</div>,
}));

import { ConversationTile } from "@/components/mosaic/ConversationTile";
import type { Workspace } from "@/types";

let liveDataRef: Record<string, any> = {};

const defaultConversation = {
  messages: [
    { id: "m1", role: "user", content: "Hello", timestamp: 1 },
    { id: "m2", role: "assistant", content: "Hi there", timestamp: 2 },
  ],
  isStreaming: false,
  streamingStartedAt: null,
  currentStreamingText: "",
  currentThinking: "",
  activeToolCalls: [],
  pendingToolInputs: [],
  connectionStatus: "connected" as const,
  error: undefined,
  workspaceStatus: "idle",
  sessionId: "sess-1",
  sendMessage: mocks.sendMessage,
  stopStreaming: mocks.stopStreaming,
  answerQuestion: mocks.answerQuestion,
  batchAnswerQuestions: mocks.batchAnswerQuestions,
  rejectToolInput: mocks.rejectToolInput,
  agentPlanMode: false,
  lockedProvider: undefined,
  switchCounter: 0,
  switchSession: mocks.switchSession,
};

const workspace: Workspace = {
  id: "ws-1",
  name: "denver",
  branch: "feat/auth",
  createdAt: "2025-01-01",
};

function renderTile(overrides?: {
  conversation?: Partial<typeof defaultConversation>;
  liveData?: Record<string, any>;
  onJumpOut?: () => void;
  onNeedsInputChange?: (wsId: string, needs: boolean) => void;
}) {
  mocks.useConversation.mockReturnValue({
    ...defaultConversation,
    ...overrides?.conversation,
  });
  liveDataRef = overrides?.liveData ?? {};

  return render(
    <ConversationTile
      wsId="ws-1"
      workspace={workspace}
      onJumpOut={overrides?.onJumpOut ?? vi.fn()}
      onNeedsInputChange={overrides?.onNeedsInputChange}
    />,
  );
}

describe("ConversationTile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    liveDataRef = {};
  });

  it("renders workspace name and branch", () => {
    renderTile({ liveData: { "ws-1": { branch: "feat/auth" } } });
    expect(screen.getByText("denver")).toBeInTheDocument();
    expect(screen.getByTestId("branch-label")).toHaveTextContent("feat/auth");
  });

  it("renders messages via ChatConversation", () => {
    renderTile();
    expect(screen.getByTestId("chat-conversation")).toBeInTheDocument();
    expect(screen.getAllByTestId("message")).toHaveLength(2);
  });

  it("passes compactMode to ChatConversation", () => {
    renderTile();
    expect(screen.getByTestId("chat-conversation")).toHaveAttribute("data-compact", "true");
  });

  it("shows activity indicator when streaming", () => {
    renderTile({ liveData: { "ws-1": { streaming: true } } });
    expect(screen.getByTestId("activity-preview")).toBeInTheDocument();
  });

  it("shows green dot when workspace has unread sessions", () => {
    renderTile({
      liveData: { "ws-1": { unreadSessions: { "sess-1": true } } },
    });
    const dots = document.querySelectorAll(".bg-emerald-400");
    expect(dots.length).toBeGreaterThan(0);
  });

  it("shows gray dot when idle", () => {
    renderTile({ liveData: {} });
    expect(screen.queryByTestId("activity-preview")).not.toBeInTheDocument();
    const grayDots = document.querySelectorAll('[class*="bg-muted-foreground"]');
    expect(grayDots.length).toBeGreaterThan(0);
  });

  it("jump-out button calls onJumpOut with workspace ID", async () => {
    const user = userEvent.setup();
    const onJumpOut = vi.fn();
    renderTile({ onJumpOut });
    await user.click(screen.getByRole("button", { name: /open.*full view/i }));
    expect(onJumpOut).toHaveBeenCalledWith("ws-1");
  });

  it("shows QuestionPanel when AskUserQuestion is pending", () => {
    renderTile({
      conversation: {
        pendingToolInputs: [
          { toolUseId: "tool-1", toolName: "AskUserQuestion" },
        ],
      },
    });
    expect(screen.getByTestId("question-panel")).toBeInTheDocument();
  });

  it("reports needs-input state to parent", () => {
    const onNeedsInputChange = vi.fn();
    renderTile({
      conversation: {
        pendingToolInputs: [
          { toolUseId: "tool-1", toolName: "AskUserQuestion" },
        ],
      },
      onNeedsInputChange,
    });
    expect(onNeedsInputChange).toHaveBeenCalledWith("ws-1", true);
  });

  it("shows collapsed input bar by default", () => {
    renderTile();
    expect(screen.getByText("Send a message...")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-input")).not.toBeInTheDocument();
  });

  it("expands to full ChatInput on click", async () => {
    const user = userEvent.setup();
    renderTile();
    await user.click(screen.getByText("Send a message..."));
    expect(screen.getByTestId("chat-input")).toBeInTheDocument();
  });

  it("shows stop button in collapsed bar when streaming", () => {
    renderTile({ conversation: { isStreaming: true } });
    expect(screen.getByTitle("Stop")).toBeInTheDocument();
  });

  it("new session button creates and switches to a new session", async () => {
    const user = userEvent.setup();
    renderTile();
    await user.click(screen.getByTitle("New session"));
    expect(mocks.createSession).toHaveBeenCalled();
    expect(mocks.switchSession).toHaveBeenCalledWith("new-sess");
  });
});
