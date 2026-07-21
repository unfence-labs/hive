import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import ChatMessage from "@/components/ChatMessage";
import type { ChatMessage as ChatMessageType } from "@/types";

vi.mock("@/components/chat/ThinkingBlock", () => ({
  ThinkingBlock: ({
    segments = [],
  }: {
    segments?: ChatMessageType["reasoningSegments"];
  }) => segments.length > 0
    ? <div data-testid="thinking-block">{segments.map((segment) => segment.headline ?? segment.body).join("")}</div>
    : null,
}));

vi.mock("@/components/chat/ToolCallList", () => ({
  ToolCallList: () => <div data-testid="tool-call-list">tool-list</div>,
}));

vi.mock("@/components/chat/CopyButton", () => ({
  CopyButton: ({ content }: { content: string }) => <button data-testid="copy-button" data-content={content} />,
}));

vi.mock("@/components/ai-elements/message", () => ({
  MessageResponse: ({ children }: { children: ReactNode }) => (
    <span data-testid="message-response">{children}</span>
  ),
}));

vi.mock("@/lib/image-url", () => ({
  resolveImageSrc: (url: string) => url.startsWith("/api/") ? `http://test-server${url}` : url,
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

  it("renders reasoning, cancellation flag, and copy button for assistant", () => {
    render(
      <ChatMessage
        message={assistantMessage({
          reasoningSegments: [{ id: "r1", headline: "reasoning" }],
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

  it("renders cancellation diagnostics when provided", () => {
    render(
      <ChatMessage
        message={assistantMessage({
          cancelled: true,
          errorDetail: "exit code 1 | stderr: permission denied",
        })}
      />,
    );

    expect(screen.getByText("(cancelled)")).toBeInTheDocument();
    expect(screen.getByText(/exit code 1/)).toBeInTheDocument();
    expect(screen.getByText(/permission denied/)).toBeInTheDocument();
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
    expect(screen.queryByTestId("tool-call-list")).not.toBeInTheDocument();
  });

  it("renders a quiet goal badge for goal command user messages", () => {
    render(
      <ChatMessage
        message={{
          id: "u-goal",
          sessionId: "sess-1",
          role: "user",
          content: "/goal Ship the feature",
          goalCommand: true,
          timestamp: "2026-02-12T00:00:00.000Z",
        }}
      />,
    );

    expect(screen.getByText("Sent with goal")).toBeInTheDocument();
  });

  // ── Image attachment tests ──────────────────────────────────────────

  it("renders image attachments for user messages", () => {
    render(
      <ChatMessage
        message={{
          id: "u-img",
          sessionId: "sess-1",
          role: "user",
          content: "Look at this",
          timestamp: "2026-02-12T00:00:00.000Z",
          images: [
            { name: "screenshot.png", mediaType: "image/png", dataUrl: "data:image/png;base64,abc" },
            { name: "photo.jpg", mediaType: "image/jpeg", dataUrl: "data:image/jpeg;base64,def" },
          ],
        }}
      />,
    );

    const images = screen.getAllByRole("img");
    expect(images).toHaveLength(2);
    expect(images[0]).toHaveAttribute("alt", "screenshot.png");
    expect(images[0]).toHaveAttribute("src", "data:image/png;base64,abc");
    expect(images[1]).toHaveAttribute("alt", "photo.jpg");
    expect(screen.getByText("Look at this")).toBeInTheDocument();
  });

  it("renders user message with images but no text content", () => {
    render(
      <ChatMessage
        message={{
          id: "u-img-only",
          sessionId: "sess-1",
          role: "user",
          content: "",
          timestamp: "2026-02-12T00:00:00.000Z",
          images: [
            { name: "diagram.png", mediaType: "image/png", dataUrl: "data:image/png;base64,xyz" },
          ],
        }}
      />,
    );

    expect(screen.getByRole("img")).toHaveAttribute("alt", "diagram.png");
  });

  it("does not render images when user message has no images field", () => {
    render(
      <ChatMessage
        message={{
          id: "u-no-img",
          sessionId: "sess-1",
          role: "user",
          content: "Just text",
          timestamp: "2026-02-12T00:00:00.000Z",
        }}
      />,
    );

    expect(screen.getByText("Just text")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("does not render images when images array is empty", () => {
    render(
      <ChatMessage
        message={{
          id: "u-empty-img",
          sessionId: "sess-1",
          role: "user",
          content: "Text only",
          timestamp: "2026-02-12T00:00:00.000Z",
          images: [],
        }}
      />,
    );

    expect(screen.getByText("Text only")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("resolves API path images via resolveImageSrc", () => {
    render(
      <ChatMessage
        message={{
          id: "u-api-img",
          sessionId: "sess-1",
          role: "user",
          content: "Server image",
          timestamp: "2026-02-12T00:00:00.000Z",
          images: [
            { name: "photo.jpg", mediaType: "image/jpeg", dataUrl: "/api/workspaces/ws1/sessions/s1/attachments/abc.jpg" },
          ],
        }}
      />,
    );

    const img = screen.getByRole("img");
    // resolveImageSrc mock prepends http://test-server for /api/ paths
    expect(img).toHaveAttribute("src", "http://test-server/api/workspaces/ws1/sessions/s1/attachments/abc.jpg");
    expect(img).toHaveAttribute("alt", "photo.jpg");
  });

  it("handles mix of base64 and API path images", () => {
    render(
      <ChatMessage
        message={{
          id: "u-mixed-img",
          sessionId: "sess-1",
          role: "user",
          content: "",
          timestamp: "2026-02-12T00:00:00.000Z",
          images: [
            { name: "old.png", mediaType: "image/png", dataUrl: "data:image/png;base64,abc" },
            { name: "new.jpg", mediaType: "image/jpeg", dataUrl: "/api/workspaces/ws1/sessions/s1/attachments/def.jpg" },
          ],
        }}
      />,
    );

    const images = screen.getAllByRole("img");
    expect(images).toHaveLength(2);
    // base64 passed through as-is
    expect(images[0]).toHaveAttribute("src", "data:image/png;base64,abc");
    // API path resolved with server URL
    expect(images[1]).toHaveAttribute("src", "http://test-server/api/workspaces/ws1/sessions/s1/attachments/def.jpg");
  });

  // ── Additional assistant message coverage ───────────────────────────

  it("shows copy button when durationMs is absent", () => {
    render(
      <ChatMessage
        message={assistantMessage({ durationMs: undefined })}
      />,
    );

    expect(screen.getByTestId("copy-button")).toHaveAttribute("data-content", "Assistant text");
  });

  it("shows duration and copy button when durationMs is set", () => {
    render(
      <ChatMessage
        message={assistantMessage({ durationMs: 3000 })}
      />,
    );

    expect(screen.getByTestId("copy-button")).toBeInTheDocument();
  });

  it("does not show cancelled label when cancelled is falsy", () => {
    render(
      <ChatMessage
        message={assistantMessage({ cancelled: false })}
      />,
    );

    expect(screen.queryByText("(cancelled)")).not.toBeInTheDocument();
  });

  it("does not render thinking block when reasoning segments are absent", () => {
    render(
      <ChatMessage
        message={assistantMessage({ reasoningSegments: undefined })}
      />,
    );

    expect(screen.queryByTestId("thinking-block")).not.toBeInTheDocument();
  });

  it("does not render tool call list when no toolCalls", () => {
    render(
      <ChatMessage
        message={assistantMessage({ toolCalls: undefined })}
      />,
    );

    expect(screen.queryByTestId("tool-call-list")).not.toBeInTheDocument();
  });
});
