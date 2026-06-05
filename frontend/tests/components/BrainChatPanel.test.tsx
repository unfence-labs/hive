import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceLiveDataProvider } from "@/contexts/WorkspaceLiveDataContext";

const mocks = vi.hoisted(() => ({
  useConversation: vi.fn(),
  useSessions: vi.fn(),
  useWorkspaceLiveData: vi.fn().mockReturnValue({ liveData: {}, clearUnread: vi.fn() }),
}));

vi.mock("@/hooks/useConversation", () => ({ useConversation: mocks.useConversation }));
vi.mock("@/hooks/useSessions", () => ({ useSessions: mocks.useSessions }));
vi.mock("@/hooks/useWorkspaceLiveData", () => ({ useWorkspaceLiveData: mocks.useWorkspaceLiveData }));

vi.mock("@/components/ChatConversation", () => ({
  default: ({ projectName }: { projectName?: string }) => (
    <div data-testid="chat-conversation" data-project={projectName ?? ""}>chat</div>
  ),
}));

vi.mock("@/components/ChatInput", () => ({
  default: ({ wsId }: { wsId?: string }) => (
    <div data-testid="chat-input" data-ws-id={wsId ?? ""}>input</div>
  ),
}));

vi.mock("@/components/ConversationTabs", () => ({
  ConversationTabs: ({ sessions }: { sessions: unknown[] }) => (
    <div data-testid="conversation-tabs" data-count={sessions.length}>tabs</div>
  ),
}));

vi.mock("@/components/TaskTracker", () => ({ default: () => <div>tasks</div> }));
vi.mock("@/components/chat/QuestionPanel", () => ({ default: () => <div>question</div> }));

import { BrainChatPanel } from "@/components/brain/BrainChatPanel";

function baseConversation() {
  return {
    messages: [],
    isStreaming: false,
    streamingStartedAt: null,
    workspaceStatus: "idle" as const,
    currentStreamingText: "",
    currentThinking: "",
    activeToolCalls: [],
    activeAgentActivities: [],
    pendingToolInputs: [],
    connectionStatus: "connected" as const,
    error: undefined,
    sessionId: "brain-session-1",
    sendMessage: vi.fn().mockReturnValue(true),
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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useConversation.mockReturnValue(baseConversation());
  mocks.useSessions.mockReturnValue({
    sessions: [{ sessionId: "brain-session-1", title: "Notes", createdAt: "", updatedAt: "" }],
    createSession: vi.fn(),
    deleteSession: vi.fn(),
  });
});

afterEach(() => vi.clearAllMocks());

function renderPanel() {
  return render(
    <WorkspaceLiveDataProvider workspaceIds={["brain"]}>
      <BrainChatPanel />
    </WorkspaceLiveDataProvider>,
  );
}

describe("BrainChatPanel", () => {
  it("wires the conversation and sessions hooks to the brain workspace", () => {
    renderPanel();
    expect(mocks.useConversation).toHaveBeenCalledWith("brain");
    expect(mocks.useSessions).toHaveBeenCalledWith("brain");
  });

  it("renders the reused chat surface pointed at the brain workspace", () => {
    renderPanel();
    expect(screen.getByTestId("conversation-tabs")).toHaveAttribute("data-count", "1");
    expect(screen.getByTestId("chat-conversation")).toHaveAttribute("data-project", "Brain");
    expect(screen.getByTestId("chat-input")).toHaveAttribute("data-ws-id", "brain");
  });
});
