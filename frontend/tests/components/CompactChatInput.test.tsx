import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CompactChatInput } from "@/components/mosaic/CompactChatInput";
import type { ComponentProps } from "react";

function renderInput(overrides?: Partial<ComponentProps<typeof CompactChatInput>>) {
  const onSend = vi.fn(() => true);
  const onStop = vi.fn();
  const onQueue = vi.fn();
  const view = render(
    <CompactChatInput
      onSend={onSend}
      onStop={onStop}
      isStreaming={false}
      connectionStatus="connected"
      onQueue={onQueue}
      {...overrides}
    />,
  );
  return { onSend, onStop, onQueue, ...view };
}

describe("CompactChatInput", () => {
  it("renders a textarea and send button", () => {
    renderInput();
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
  });

  it("send button is disabled when textarea is empty", () => {
    renderInput();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("send button is enabled after typing", async () => {
    const user = userEvent.setup();
    renderInput();
    await user.type(screen.getByRole("textbox"), "hello");
    expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
  });

  it("Enter key submits the message", async () => {
    const user = userEvent.setup();
    const { onSend } = renderInput();
    await user.type(screen.getByRole("textbox"), "hello{Enter}");
    expect(onSend).toHaveBeenCalledWith("hello");
  });

  it("Shift+Enter does not submit", async () => {
    const user = userEvent.setup();
    const { onSend } = renderInput();
    await user.type(screen.getByRole("textbox"), "hello{Shift>}{Enter}{/Shift}");
    expect(onSend).not.toHaveBeenCalled();
  });

  it("shows stop button when streaming", () => {
    renderInput({ isStreaming: true });
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send" })).not.toBeInTheDocument();
  });

  it("stop button calls onStop", async () => {
    const user = userEvent.setup();
    const { onStop } = renderInput({ isStreaming: true });
    await user.click(screen.getByRole("button", { name: "Stop" }));
    expect(onStop).toHaveBeenCalled();
  });

  it("queues message when streaming", async () => {
    const user = userEvent.setup();
    const { onQueue, onSend } = renderInput({ isStreaming: true });
    await user.type(screen.getByRole("textbox"), "follow-up{Enter}");
    expect(onQueue).toHaveBeenCalledWith({ content: "follow-up" });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("textarea is disabled when disconnected", () => {
    renderInput({ connectionStatus: "disconnected" });
    expect(screen.getByRole("textbox")).toBeDisabled();
    expect(screen.getByPlaceholderText("Disconnected")).toBeInTheDocument();
  });

  it("textarea is disabled when a message is queued", () => {
    renderInput({ queuedMessage: { content: "queued msg" } });
    expect(screen.getByRole("textbox")).toBeDisabled();
  });
});
