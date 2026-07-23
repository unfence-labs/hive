import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import ChatMessage, { SENDING_INDICATOR_DELAY_MS } from "@/components/ChatMessage";
import type { ChatMessage as ChatMessageType } from "@/types";

const message: ChatMessageType = {
  id: "msg-1",
  sessionId: "session-1",
  role: "user",
  content: "hello world",
  timestamp: "2026-07-23T00:00:00.000Z",
};

describe("ChatMessage send state", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("delays the sending indicator", () => {
    vi.useFakeTimers();
    render(<ChatMessage message={message} sendState="sending" />);

    expect(screen.queryByTestId("send-state-sending")).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(SENDING_INDICATOR_DELAY_MS));
    expect(screen.getByTestId("send-state-sending")).toBeInTheDocument();
  });

  it("cancels the indicator when delivery is confirmed before the delay", () => {
    vi.useFakeTimers();
    const { rerender } = render(<ChatMessage message={message} sendState="sending" />);

    rerender(<ChatMessage message={message} />);
    act(() => vi.advanceTimersByTime(SENDING_INDICATOR_DELAY_MS));

    expect(screen.queryByTestId("send-state-sending")).not.toBeInTheDocument();
  });

  it("shows retry and discard for a failed send", () => {
    const onRetrySend = vi.fn();
    const onDiscardSend = vi.fn();
    render(
      <ChatMessage
        message={message}
        sendState="failed"
        onRetrySend={onRetrySend}
        onDiscardSend={onDiscardSend}
      />,
    );

    expect(screen.getByText("Not delivered")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    fireEvent.click(screen.getByRole("button", { name: /discard message/i }));
    expect(onRetrySend).toHaveBeenCalledWith("msg-1");
    expect(onDiscardSend).toHaveBeenCalledWith("msg-1");
  });

  it("allows discard but not retry when delivery is unconfirmed", () => {
    const onDiscardSend = vi.fn();
    render(
      <ChatMessage
        message={message}
        sendState="unconfirmed"
        onRetrySend={vi.fn()}
        onDiscardSend={onDiscardSend}
      />,
    );

    expect(screen.getByText("Delivery unconfirmed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /discard message/i }));
    expect(onDiscardSend).toHaveBeenCalledWith("msg-1");
  });
});
