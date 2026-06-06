import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConversationPane, type ConversationPaneProps } from "@/components/chat/ConversationPane";
import type { PendingToolInput } from "@/hooks/useConversation";

// Keep the heavy children inert so the pane's own structure/gating is tested.
vi.mock("@/components/ChatConversation", () => ({
  default: () => <div data-testid="chat-conversation">chat</div>,
}));
vi.mock("@/components/ConversationTabs", () => ({
  ConversationTabs: () => <div data-testid="tabs">tabs</div>,
}));
vi.mock("@/components/TaskTracker", () => ({
  default: () => <div data-testid="task-tracker">tasks</div>,
}));
vi.mock("@/components/chat/QuestionPanel", () => ({
  default: () => <div data-testid="question-panel">question</div>,
}));

function baseProps(overrides: Partial<ConversationPaneProps> = {}): ConversationPaneProps {
  return {
    sessions: [],
    activeSessionId: "s1",
    isStreaming: false,
    onCreateSession: vi.fn(),
    onActivateSession: vi.fn(),
    onDeleteSession: vi.fn(),
    messages: [],
    currentStreamingText: "",
    currentThinking: "",
    activeToolCalls: [],
    activeAgentActivities: [],
    pendingToolInputs: [],
    switchCounter: 0,
    scrollToBottomTrigger: 0,
    tasks: [],
    currentTask: undefined,
    taskCounts: { total: 0, completed: 0, inProgress: 0, pending: 0 },
    backgroundAgents: [],
    backgroundRunningCount: 0,
    onBatchAnswerQuestions: vi.fn(),
    onDismissQuestion: vi.fn(),
    chatInput: <div data-testid="chat-input">input</div>,
    ...overrides,
  };
}

const question: PendingToolInput = {
  toolUseId: "t1",
  toolName: "AskUserQuestion",
  input: {},
} as unknown as PendingToolInput;

describe("ConversationPane", () => {
  it("always renders the tab strip and the conversation", () => {
    render(<ConversationPane {...baseProps()} />);
    expect(screen.getByTestId("tabs")).toBeInTheDocument();
    expect(screen.getByTestId("chat-conversation")).toBeInTheDocument();
  });

  it("hides (not unmounts) the chat body when a file tab is active", () => {
    render(<ConversationPane {...baseProps({ isFileTabActive: true })} />);
    const chat = screen.getByTestId("chat-conversation");
    // Body is still mounted but inside a `.hidden` container.
    expect(chat.closest(".hidden")).not.toBeNull();
  });

  it("renders the chat input footer when there is no pending question", () => {
    render(<ConversationPane {...baseProps()} />);
    expect(screen.getByTestId("chat-input")).toBeInTheDocument();
    expect(screen.queryByTestId("question-panel")).not.toBeInTheDocument();
  });

  it("renders the question panel instead of the input when an AskUserQuestion is pending", () => {
    render(<ConversationPane {...baseProps({ pendingToolInputs: [question] })} />);
    expect(screen.getByTestId("question-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-input")).not.toBeInTheDocument();
  });

  it("renders the plan action bar slot alongside the input", () => {
    render(
      <ConversationPane
        {...baseProps({ planActionBar: <div data-testid="plan-bar">plan</div> })}
      />,
    );
    expect(screen.getByTestId("plan-bar")).toBeInTheDocument();
    expect(screen.getByTestId("chat-input")).toBeInTheDocument();
  });

  it("shows the task tracker only when tasks/agents exist and no question is pending", () => {
    const { rerender } = render(<ConversationPane {...baseProps()} />);
    expect(screen.queryByTestId("task-tracker")).not.toBeInTheDocument();

    rerender(
      <ConversationPane
        {...baseProps({ tasks: [{ id: "1", subject: "do", status: "in_progress" }] })}
      />,
    );
    expect(screen.getByTestId("task-tracker")).toBeInTheDocument();

    // A pending question suppresses the tracker.
    rerender(
      <ConversationPane
        {...baseProps({
          tasks: [{ id: "1", subject: "do", status: "in_progress" }],
          pendingToolInputs: [question],
        })}
      />,
    );
    expect(screen.queryByTestId("task-tracker")).not.toBeInTheDocument();
  });
});
