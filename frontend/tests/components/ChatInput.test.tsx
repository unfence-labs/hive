import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import ChatInput from "@/components/ChatInput";

function renderChatInput(overrides?: Partial<ComponentProps<typeof ChatInput>>) {
  const onSend = overrides?.onSend ?? vi.fn(() => true);
  const onStop = overrides?.onStop ?? vi.fn();
  render(
    <ChatInput
      onSend={onSend}
      onStop={onStop}
      disabled={false}
      isStreaming={false}
      connectionStatus="connected"
      {...overrides}
    />,
  );
  return { onSend, onStop };
}

describe("ChatInput", () => {
  it("does not render legacy status labels", () => {
    renderChatInput();

    expect(screen.queryByText("Working…")).not.toBeInTheDocument();
    expect(screen.queryByText("Awaiting response…")).not.toBeInTheDocument();
  });

  it("keeps the submit button in send mode when idle", () => {
    renderChatInput();

    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();
  });

  it("sends message on Send button click", async () => {
    const user = userEvent.setup();
    const { onSend } = renderChatInput();

    await user.type(screen.getByPlaceholderText("Send a message..."), "hello");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(onSend).toHaveBeenCalledWith("hello", undefined, { planMode: false, thinkingEnabled: true });
  });

  it("sends message on Enter without Shift", async () => {
    const user = userEvent.setup();
    const { onSend } = renderChatInput();

    await user.type(screen.getByPlaceholderText("Send a message..."), "hello{enter}");

    expect(onSend).toHaveBeenCalledWith("hello", undefined, { planMode: false, thinkingEnabled: true });
  });

  it("does not send on Shift+Enter", async () => {
    const user = userEvent.setup();
    const { onSend } = renderChatInput();

    await user.type(screen.getByPlaceholderText("Send a message..."), "hello{shift>}{enter}{/shift}");

    expect(onSend).not.toHaveBeenCalled();
  });

  it("sends toggled thinking/plan options", async () => {
    const user = userEvent.setup();
    const { onSend } = renderChatInput();

    await user.click(screen.getByRole("button", { name: "Toggle thinking" }));
    await user.click(screen.getByRole("button", { name: "Toggle plan mode" }));
    await user.type(screen.getByPlaceholderText("Send a message..."), "hello");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(onSend).toHaveBeenCalledWith("hello", undefined, { planMode: true, thinkingEnabled: false });
  });

  it("restores default options when toggles are clicked twice", async () => {
    const user = userEvent.setup();
    const { onSend } = renderChatInput();

    await user.click(screen.getByRole("button", { name: "Toggle thinking" }));
    await user.click(screen.getByRole("button", { name: "Toggle plan mode" }));
    await user.click(screen.getByRole("button", { name: "Toggle thinking" }));
    await user.click(screen.getByRole("button", { name: "Toggle plan mode" }));
    await user.type(screen.getByPlaceholderText("Send a message..."), "hello");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(onSend).toHaveBeenCalledWith("hello", undefined, { planMode: false, thinkingEnabled: true });
  });

  it("shows stop button and calls onStop while streaming", async () => {
    const user = userEvent.setup();
    const { onStop } = renderChatInput({ isStreaming: true });

    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Send a message...")).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Stop" }));

    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("disables input when disconnected", () => {
    renderChatInput({ connectionStatus: "disconnected" });

    expect(screen.getByPlaceholderText("Reconnecting...")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("keeps input value when onSend returns false", async () => {
    const user = userEvent.setup();
    const { onSend } = renderChatInput({ onSend: vi.fn(() => false) });

    const input = screen.getByPlaceholderText("Send a message...");
    await user.type(input, "hello");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(onSend).toHaveBeenCalledWith("hello", undefined, { planMode: false, thinkingEnabled: true });
    expect(input).toHaveValue("hello");
  });
});
