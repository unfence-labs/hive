import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ChatInput from "@/components/ChatInput";

describe("ChatInput", () => {
  it("sends message on Send button click", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn(() => true);

    render(
      <ChatInput
        onSend={onSend}
        onStop={vi.fn()}
        disabled={false}
        isStreaming={false}
        connectionStatus="connected"
      />,
    );

    await user.type(screen.getByPlaceholderText("Send a message..."), "hello");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(onSend).toHaveBeenCalledWith("hello");
  });

  it("sends message on Enter without Shift", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn(() => true);

    render(
      <ChatInput
        onSend={onSend}
        onStop={vi.fn()}
        disabled={false}
        isStreaming={false}
        connectionStatus="connected"
      />,
    );

    await user.type(screen.getByPlaceholderText("Send a message..."), "hello{enter}");

    expect(onSend).toHaveBeenCalledWith("hello");
  });

  it("does not send on Shift+Enter", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn(() => true);

    render(
      <ChatInput
        onSend={onSend}
        onStop={vi.fn()}
        disabled={false}
        isStreaming={false}
        connectionStatus="connected"
      />,
    );

    await user.type(screen.getByPlaceholderText("Send a message..."), "hello{shift>}{enter}{/shift}");

    expect(onSend).not.toHaveBeenCalled();
  });

  it("shows stop button and calls onStop while streaming", async () => {
    const user = userEvent.setup();
    const onStop = vi.fn();

    render(
      <ChatInput
        onSend={vi.fn(() => true)}
        onStop={onStop}
        disabled={false}
        isStreaming
        connectionStatus="connected"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Stop" }));

    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("disables input when disconnected", () => {
    render(
      <ChatInput
        onSend={vi.fn(() => true)}
        onStop={vi.fn()}
        disabled={false}
        isStreaming={false}
        connectionStatus="disconnected"
      />,
    );

    expect(screen.getByPlaceholderText("Reconnecting...")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("keeps input value when onSend returns false", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn(() => false);

    render(
      <ChatInput
        onSend={onSend}
        onStop={vi.fn()}
        disabled={false}
        isStreaming={false}
        connectionStatus="connected"
      />,
    );

    const input = screen.getByPlaceholderText("Send a message...");
    await user.type(input, "hello");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(onSend).toHaveBeenCalledWith("hello");
    expect(input).toHaveValue("hello");
  });
});
