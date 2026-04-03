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
  createSession: vi.fn(),
  switchSession: vi.fn(),
}));

vi.mock("@/hooks/useConversation", () => ({
  useConversation: mocks.useConversation,
}));

vi.mock("@/hooks/useSessions", () => ({
  useSessions: () => ({
    sessions: [],
    createSession: mocks.createSession,
    switchSession: mocks.switchSession,
  }),
}));

vi.mock("@/hooks/useSessionMessages", () => ({
  useSessionMessages: () => ({
    messages: [],
    isLoading: false,
  }),
}));

vi.mock("@/contexts/WorkspaceLiveDataContext", () => ({
  useWorkspaceLiveDataContext: () => liveDataRef,
}));

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

vi.mock("@/components/chat/PlanActionBar", () => ({
  PlanActionBar: () => <div data-testid="plan-action-bar">PlanActionBar</div>,
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
  approvePlan: vi.fn(),
  dismissPlan: vi.fn(),
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
  onHide?: (wsId: string) => void;
  onAddTile?: () => void;
  onNeedsInputChange?: (wsId: string, needs: boolean) => void;
  onHeaderPointerDown?: (e: React.PointerEvent) => void;
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
      onHide={overrides?.onHide}
      onAddTile={overrides?.onAddTile}
      onNeedsInputChange={overrides?.onNeedsInputChange}
      onHeaderPointerDown={overrides?.onHeaderPointerDown}
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

  it("always shows full ChatInput", () => {
    renderTile();
    expect(screen.getByTestId("chat-input")).toBeInTheDocument();
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

  it("shows remove button when onHide is provided", () => {
    renderTile({ onHide: vi.fn() });
    expect(screen.getByTitle("Remove tile")).toBeInTheDocument();
  });

  it("remove button calls onHide with workspace ID", async () => {
    const user = userEvent.setup();
    const onHide = vi.fn();
    renderTile({ onHide });
    await user.click(screen.getByTitle("Remove tile"));
    expect(onHide).toHaveBeenCalledWith("ws-1");
  });

  it("add tile button calls onAddTile with old session ID", async () => {
    const user = userEvent.setup();
    const onAddTile = vi.fn();
    mocks.createSession.mockResolvedValue({ sessionId: "sess-new" });
    renderTile({ onAddTile });
    await user.click(screen.getByTitle("New conversation"));
    // Wait for async createSession to resolve
    await vi.waitFor(() => {
      expect(onAddTile).toHaveBeenCalledWith("sess-1");
    });
  });

  it("does not show add tile button when onAddTile is not provided", () => {
    renderTile();
    expect(screen.queryByTitle("New conversation")).not.toBeInTheDocument();
  });
});
