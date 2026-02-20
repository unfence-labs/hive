import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ChatInput from "@/components/ChatInput";

vi.mock("@/hooks/useCompletions", () => ({
  useCompletions: () => [],
}));

function renderChatInput(sessionId?: string, wsId = "ws-test") {
  return render(
    <ChatInput
      wsId={wsId}
      sessionId={sessionId}
      onSend={() => true}
      onStop={() => {}}
      disabled={false}
      isStreaming={false}
      connectionStatus="connected"
    />,
  );
}

function inputValue(): string {
  return (screen.getByPlaceholderText("Send a message...") as HTMLTextAreaElement).value;
}

describe("ChatInput draft persistence", () => {
  it("keeps per-session draft text when switching sessions", () => {
    const { rerender } = renderChatInput("sess-a");

    fireEvent.change(screen.getByPlaceholderText("Send a message..."), { target: { value: "draft A" } });
    rerender(
      <ChatInput
        wsId="ws-test"
        sessionId="sess-b"
        onSend={() => true}
        onStop={() => {}}
        disabled={false}
        isStreaming={false}
        connectionStatus="connected"
      />,
    );
    expect(inputValue()).toBe("");

    fireEvent.change(screen.getByPlaceholderText("Send a message..."), { target: { value: "draft B" } });
    rerender(
      <ChatInput
        wsId="ws-test"
        sessionId="sess-a"
        onSend={() => true}
        onStop={() => {}}
        disabled={false}
        isStreaming={false}
        connectionStatus="connected"
      />,
    );
    expect(inputValue()).toBe("draft A");
  });

  it("does not erase existing draft on unmount/remount cycle", () => {
    const { rerender, unmount } = renderChatInput("sess-a");
    fireEvent.change(screen.getByPlaceholderText("Send a message..."), {
      target: { value: "keep me" },
    });

    rerender(
      <ChatInput
        wsId="ws-test"
        sessionId="sess-b"
        onSend={() => true}
        onStop={() => {}}
        disabled={false}
        isStreaming={false}
        connectionStatus="connected"
      />,
    );
    unmount();

    renderChatInput("sess-a");
    expect(inputValue()).toBe("keep me");
  });

  it("keeps draft when switching workspace and coming back", () => {
    const { rerender } = renderChatInput("sess-a", "ws-a");
    fireEvent.change(screen.getByPlaceholderText("Send a message..."), {
      target: { value: "workspace A draft" },
    });

    rerender(
      <ChatInput
        wsId="ws-b"
        sessionId="sess-b"
        onSend={() => true}
        onStop={() => {}}
        disabled={false}
        isStreaming={false}
        connectionStatus="connected"
      />,
    );
    expect(inputValue()).toBe("");

    rerender(
      <ChatInput
        wsId="ws-a"
        sessionId="sess-a"
        onSend={() => true}
        onStop={() => {}}
        disabled={false}
        isStreaming={false}
        connectionStatus="connected"
      />,
    );
    expect(inputValue()).toBe("workspace A draft");
  });
});
