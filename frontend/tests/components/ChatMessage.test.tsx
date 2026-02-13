import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import ChatMessage from "@/components/ChatMessage";
import type { ChatMessage as ChatMessageType } from "@/types";

vi.mock("@/components/chat/ThinkingBlock", () => ({
  ThinkingBlock: ({ content }: { content: string }) => <div data-testid="thinking-block">{content}</div>,
}));

vi.mock("@/components/chat/ToolCallList", () => ({
  ToolCallList: () => <div data-testid="tool-call-list">tool-list</div>,
}));

vi.mock("@/components/chat/CopyButton", () => ({
  CopyButton: ({ content }: { content: string }) => <button data-testid="copy-button">{content}</button>,
}));

vi.mock("@/components/ai-elements/message", () => ({
  MessageResponse: ({ children }: { children: ReactNode }) => (
    <span data-testid="message-response">{children}</span>
  ),
}));

function assistantMessage(overrides: Partial<ChatMessageType> = {}): ChatMessageType {
  return {
    id: "a1",
    sessionId: "sess-1",
    role: "assistant",
    content: "Assistant text",
    timestamp: "2026-02-12T00:00:00.000Z",
    ...overrides,
  };
}

describe("ChatMessage", () => {
  it("renders assistant response before tool call list", () => {
    render(
      <ChatMessage
        message={assistantMessage({
          content: "Final answer",
          toolCalls: [{ id: "t1", name: "Read", input: "{}" }],
        })}
      />,
    );

    const response = screen.getByTestId("message-response");
    const tools = screen.getByTestId("tool-call-list");
    expect(response.compareDocumentPosition(tools) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renders thinking, cancellation flag, and copy button for assistant", () => {
    render(
      <ChatMessage
        message={assistantMessage({
          thinkingContent: "reasoning",
          cancelled: true,
          durationMs: 1200,
          toolCalls: [{ id: "t1", name: "Read", input: "{}" }],
        })}
      />,
    );

    expect(screen.getByTestId("thinking-block")).toHaveTextContent("reasoning");
    expect(screen.getByText("(cancelled)")).toBeInTheDocument();
    expect(screen.getByTestId("copy-button")).toBeInTheDocument();
  });

  it("does not render assistant-only affordances for user messages", () => {
    render(
      <ChatMessage
        message={{
          id: "u1",
          sessionId: "sess-1",
          role: "user",
          content: "Hi",
          timestamp: "2026-02-12T00:00:00.000Z",
        }}
      />,
    );

    expect(screen.getByText("Hi")).toBeInTheDocument();
    expect(screen.queryByTestId("copy-button")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tool-call-list")).not.toBeInTheDocument();
  });
});
