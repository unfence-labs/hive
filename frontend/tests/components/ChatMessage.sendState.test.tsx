import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import ChatMessage, { SENDING_INDICATOR_DELAY_MS } from "@/components/ChatMessage";
import type { ChatMessage as ChatMessageType } from "@/types";

function userMessage(overrides: Partial<ChatMessageType> = {}): ChatMessageType {
  return {
    id: "msg-1",
    sessionId: "session-1",
    role: "user",
    content: "hello world",
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe("ChatMessage sendState indicator", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not show 'Sending…' immediately, only after the grace delay", () => {
    vi.useFakeTimers();
    render(<ChatMessage message={userMessage()} sendState="sending" />);

    expect(screen.queryByTestId("send-state-sending")).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(SENDING_INDICATOR_DELAY_MS);
    });

    expect(screen.getByTestId("send-state-sending")).toBeInTheDocument();
  });

  it("never shows the label when the echo confirms before the delay elapses", () => {
    vi.useFakeTimers();
    const { rerender } = render(<ChatMessage message={userMessage()} sendState="sending" />);

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.queryByTestId("send-state-sending")).not.toBeInTheDocument();

    rerender(<ChatMessage message={userMessage()} sendState={undefined} />);

    act(() => {
      vi.advanceTimersByTime(SENDING_INDICATOR_DELAY_MS);
    });

    expect(screen.queryByTestId("send-state-sending")).not.toBeInTheDocument();
  });

  it("shows 'Not delivered' immediately with no timer advance needed", () => {
    render(<ChatMessage message={userMessage()} sendState="failed" />);

    expect(screen.getByTestId("send-state-failed")).toBeInTheDocument();
  });

  it("on retry, hides the failed state immediately and re-arms the delay", () => {
    vi.useFakeTimers();
    const { rerender } = render(<ChatMessage message={userMessage()} sendState="failed" />);
    expect(screen.getByTestId("send-state-failed")).toBeInTheDocument();

    rerender(<ChatMessage message={userMessage()} sendState="sending" />);

    expect(screen.queryByTestId("send-state-failed")).not.toBeInTheDocument();
    expect(screen.queryByTestId("send-state-sending")).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(SENDING_INDICATOR_DELAY_MS);
    });

    expect(screen.getByTestId("send-state-sending")).toBeInTheDocument();
  });
});
