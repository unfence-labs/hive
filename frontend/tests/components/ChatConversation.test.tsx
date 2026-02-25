import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import ChatConversation from "@/components/ChatConversation";
import type { ChatMessage } from "@/types";

vi.mock("@/components/ai-elements/conversation", () => ({
  Conversation: ({
    children,
    className,
    resize,
  }: {
    children: ReactNode;
    className?: string;
    resize?: "smooth" | "instant";
  }) => (
    <div data-testid="conversation" data-resize={resize} className={className}>
      {children}
    </div>
  ),
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

const baseConversationProps: ComponentProps<typeof ChatConversation> = {
  messages: [],
  isStreaming: false,
  streamingStartedAt: null,
  currentStreamingText: "",
  currentThinking: "",
  activeToolCalls: [],
  switchCounter: 0,
};

function renderConversation(props?: Partial<ComponentProps<typeof ChatConversation>>) {
  return render(
    <ChatConversation
      {...baseConversationProps}
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

describe("ChatConversation streaming timer", () => {
  it("computes elapsed time from streamingStartedAt and updates over time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-16T12:00:10.000Z"));

    renderConversation({
      isStreaming: true,
      streamingStartedAt: new Date("2026-02-16T12:00:05.000Z").getTime(),
    });

    expect(screen.getByText("5.0s")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByText("5.5s")).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("resets timer to 0 when streaming stops", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-16T12:00:10.000Z"));

    const { rerender } = renderConversation({
      isStreaming: true,
      streamingStartedAt: new Date("2026-02-16T12:00:08.000Z").getTime(),
    });

    expect(screen.getByText("2.0s")).toBeInTheDocument();

    rerender(
      <ChatConversation
        {...baseConversationProps}
        isStreaming={false}
      />,
    );

    expect(screen.queryByText("2.0s")).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it("stays at 0 when streamingStartedAt is missing", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-16T12:00:10.000Z"));

    renderConversation({
      isStreaming: true,
      streamingStartedAt: null,
    });
    expect(screen.getByText("0.0s")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.getByText("0.0s")).toBeInTheDocument();
    vi.useRealTimers();
  });
});

describe("ChatConversation error banner", () => {
  it("renders error banner when error prop is provided", () => {
    renderConversation({ error: "Something went wrong" });

    const banner = screen.getByText("Something went wrong");
    expect(banner).toBeInTheDocument();
    expect(banner.closest("div")).toHaveClass("text-destructive");
  });

  it("does not render error banner when error is undefined", () => {
    renderConversation({ error: undefined });

    expect(screen.queryByText(/went wrong/i)).not.toBeInTheDocument();
  });

  it("renders both error banner and messages together", () => {
    renderConversation({
      error: "Connection lost",
      messages: [{
        id: "u1",
        sessionId: "sess-1",
        role: "user",
        content: "hello",
        timestamp: "2026-02-12T00:00:00.000Z",
      }],
    });

    expect(screen.getByText("Connection lost")).toBeInTheDocument();
    expect(screen.getByTestId("msg-u1")).toHaveTextContent("hello");
  });
});

describe("ChatConversation hydration on session/workspace switch", () => {
  it("keeps resize instant during hydration, then switches to smooth after settling", () => {
    vi.useFakeTimers();
    const rafQueue: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafQueue.length;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    renderConversation({
      messages: [{
        id: "a1",
        sessionId: "sess-1",
        role: "assistant",
        content: "hydrating",
        timestamp: "2026-02-20T00:00:00.000Z",
      }],
      switchCounter: 1,
    });

    const conversation = screen.getByTestId("conversation");
    expect(conversation.className).toContain("invisible");
    expect(conversation).toHaveAttribute("data-resize", "instant");

    act(() => {
      const raf1 = rafQueue.shift();
      raf1?.(16);
    });
    expect(conversation.className).toContain("invisible");

    act(() => {
      const raf2 = rafQueue.shift();
      raf2?.(32);
    });
    expect(conversation.className).not.toContain("invisible");
    expect(conversation).toHaveAttribute("data-resize", "instant");

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(conversation).toHaveAttribute("data-resize", "smooth");

    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("reveals content after 200ms fallback when requestAnimationFrame stalls", () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    renderConversation({
      messages: [{
        id: "a1",
        sessionId: "sess-1",
        role: "assistant",
        content: "fallback reveal",
        timestamp: "2026-02-20T00:00:00.000Z",
      }],
      switchCounter: 1,
    });

    const conversation = screen.getByTestId("conversation");
    expect(conversation.className).toContain("invisible");
    expect(conversation).toHaveAttribute("data-resize", "instant");

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(conversation.className).not.toContain("invisible");

    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("resets hydration immediately when switchCounter changes", () => {
    vi.useFakeTimers();
    const rafQueue: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafQueue.length;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const message: ChatMessage = {
      id: "a1",
      sessionId: "sess-1",
      role: "assistant",
      content: "ready",
      timestamp: "2026-02-20T00:00:00.000Z",
    };

    const { rerender } = renderConversation({ messages: [message], switchCounter: 1 });
    const conversation = screen.getByTestId("conversation");

    act(() => {
      const raf1 = rafQueue.shift();
      raf1?.(16);
      const raf2 = rafQueue.shift();
      raf2?.(32);
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(conversation.className).not.toContain("invisible");
    expect(conversation).toHaveAttribute("data-resize", "smooth");

    rerender(
      <ChatConversation
        {...baseConversationProps}
        messages={[message]}
        switchCounter={2}
      />,
    );

    expect(conversation.className).toContain("invisible");
    expect(conversation).toHaveAttribute("data-resize", "instant");

    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
});

describe("ChatConversation queued message", () => {
  it("renders queued message at the bottom when queuedMessage is set", () => {
    renderConversation({
      messages: [{
        id: "u1",
        sessionId: "sess-1",
        role: "user",
        content: "first message",
        timestamp: "2026-02-12T00:00:00.000Z",
      }],
      isStreaming: true,
      queuedMessage: { content: "my follow-up" },
    });

    const queued = screen.getByTestId("queued-message");
    expect(queued).toBeInTheDocument();
    expect(queued).toHaveTextContent("my follow-up");
    expect(queued).toHaveTextContent("Queued");
  });

  it("does not render queued message when queuedMessage is null", () => {
    renderConversation({
      queuedMessage: null,
    });

    expect(screen.queryByTestId("queued-message")).not.toBeInTheDocument();
  });

  it("calls onClearQueue when trash button is clicked", async () => {
    const user = userEvent.setup();
    const onClearQueue = vi.fn();

    renderConversation({
      isStreaming: true,
      queuedMessage: { content: "cancel me" },
      onClearQueue,
    });

    await user.click(screen.getByRole("button", { name: "Cancel queued message" }));
    expect(onClearQueue).toHaveBeenCalledTimes(1);
  });
});
