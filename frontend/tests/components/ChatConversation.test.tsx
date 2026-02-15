import { render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import ChatConversation from "@/components/ChatConversation";
import type { ChatMessage } from "@/types";

vi.mock("@/components/ai-elements/conversation", () => ({
  Conversation: ({ children }: { children: ReactNode }) => <div data-testid="conversation">{children}</div>,
  ConversationContent: ({ children }: { children: ReactNode }) => (
    <div data-testid="conversation-content">{children}</div>
  ),
  ConversationEmptyState: ({
    children,
    title,
  }: {
    children?: ReactNode;
    title?: string;
  }) => <div data-testid="conversation-empty-state">{children ?? title}</div>,
  ConversationScrollButton: () => <button type="button" data-testid="conversation-scroll-btn">scroll</button>,
}));

vi.mock("@/components/ChatMessage", () => ({
  default: ({ message }: { message: ChatMessage }) => <div data-testid={`msg-${message.id}`}>{message.content}</div>,
}));

vi.mock("@/components/chat/AgentActivityPreview", () => ({
  default: () => <div data-testid="agent-activity-preview">activity</div>,
}));

vi.mock("@/components/ai-elements/message", () => ({
  MessageResponse: ({ children }: { children: ReactNode }) => (
    <span data-testid="message-response">{children}</span>
  ),
}));

vi.mock("@/components/chat/ThinkingBlock", () => ({
  ThinkingBlock: ({ content }: { content: string }) => <div data-testid="thinking-block">{content}</div>,
}));

vi.mock("@/components/chat/ToolCallList", () => ({
  ToolCallList: () => <div data-testid="tool-call-list">tool-call-list</div>,
}));

function renderConversation(props?: Partial<ComponentProps<typeof ChatConversation>>) {
  render(
    <ChatConversation
      messages={[]}
      isStreaming={false}
      currentStreamingText=""
      currentThinking=""
      activeToolCalls={[]}
      {...props}
    />,
  );
}

describe("ChatConversation empty states", () => {
  it("renders the workspace welcome state when metadata is available", () => {
    renderConversation({
      workspaceName: "san-antonio",
      projectName: "hive",
      branch: "workspace/san-antonio",
      defaultBranch: "main",
      fileCount: 42,
    });

    expect(screen.getByText(/You're in a new copy of/i)).toBeInTheDocument();
    expect(screen.getByText("origin/main")).toBeInTheDocument();
    expect(screen.getByTestId("conversation-content")).toHaveTextContent("and copied 42 files");
    expect(screen.queryByText("Send a message to start a conversation.")).not.toBeInTheDocument();
  });

  it("defaults fileCount to 0 when not provided", () => {
    renderConversation({
      workspaceName: "san-antonio",
      projectName: "hive",
      branch: "workspace/san-antonio",
      defaultBranch: "main",
    });

    expect(screen.getByTestId("conversation-content")).toHaveTextContent("and copied 0 files");
  });

  it("renders the generic empty prompt when workspace metadata is incomplete", () => {
    renderConversation({
      workspaceName: "san-antonio",
      projectName: "hive",
      branch: "workspace/san-antonio",
      defaultBranch: undefined,
    });

    expect(screen.getByText("Send a message to start a conversation.")).toBeInTheDocument();
    expect(screen.queryByText(/You're in a new copy of/i)).not.toBeInTheDocument();
  });

  it("does not render empty states when messages exist", () => {
    renderConversation({
      messages: [
        {
          id: "u1",
          sessionId: "sess-1",
          role: "user",
          content: "hello",
          timestamp: "2026-02-12T00:00:00.000Z",
        },
      ],
      workspaceName: "san-antonio",
      projectName: "hive",
      branch: "workspace/san-antonio",
      defaultBranch: "main",
    });

    expect(screen.queryByText(/You're in a new copy of/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Send a message to start a conversation.")).not.toBeInTheDocument();
    expect(screen.getByTestId("msg-u1")).toHaveTextContent("hello");
  });
});
