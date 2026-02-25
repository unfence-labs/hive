import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps } from "react";
import ChatInput from "@/components/ChatInput";

vi.mock("@/hooks/useModels", () => ({
  useModels: () => ({
    models: [
      { id: "claude:opus-4-6", modelId: "opus-4-6", label: "Opus 4.6", provider: "claude", providerLabel: "Claude Code", isNew: false, capabilities: { thinking: true, planMode: true, blockingTools: true, completions: true } },
      { id: "claude:sonnet-4-6", modelId: "sonnet-4-6", label: "Sonnet 4.6", provider: "claude", providerLabel: "Claude Code", isNew: true, capabilities: { thinking: true, planMode: true, blockingTools: true, completions: true } },
    ],
    defaultModelId: "claude:opus-4-6",
    selectedModelId: "claude:opus-4-6",
    selectedModel: { id: "claude:opus-4-6", modelId: "opus-4-6", label: "Opus 4.6", provider: "claude", providerLabel: "Claude Code", isNew: false, capabilities: { thinking: true, planMode: true, blockingTools: true, completions: true } },
    capabilities: { thinking: true, planMode: true, blockingTools: true, completions: true },
    setSelectedModelId: vi.fn(),
    isLoading: false,
  }),
}));

function renderChatInput(overrides?: Partial<ComponentProps<typeof ChatInput>>) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onSend = overrides?.onSend ?? vi.fn(() => true);
  const onStop = overrides?.onStop ?? vi.fn();
  const onQueue = overrides?.onQueue ?? vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <ChatInput
        onSend={onSend}
        onStop={onStop}
        onQueue={onQueue}
        disabled={false}
        isStreaming={false}
        connectionStatus="connected"
        messages={[]}
        {...overrides}
      />
    </QueryClientProvider>,
  );
  return { onSend, onStop, onQueue };
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

    expect(onSend).toHaveBeenCalledWith("hello", undefined, { model: "claude:opus-4-6", planMode: false, thinkingEnabled: true }, undefined);
  });

  it("sends message on Enter without Shift", async () => {
    const user = userEvent.setup();
    const { onSend } = renderChatInput();

    await user.type(screen.getByPlaceholderText("Send a message..."), "hello{enter}");

    expect(onSend).toHaveBeenCalledWith("hello", undefined, { model: "claude:opus-4-6", planMode: false, thinkingEnabled: true }, undefined);
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

    expect(onSend).toHaveBeenCalledWith("hello", undefined, { model: "claude:opus-4-6", planMode: true, thinkingEnabled: false }, undefined);
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

    expect(onSend).toHaveBeenCalledWith("hello", undefined, { model: "claude:opus-4-6", planMode: false, thinkingEnabled: true }, undefined);
  });

  it("shows stop button and calls onStop while streaming", async () => {
    const user = userEvent.setup();
    const { onStop } = renderChatInput({ isStreaming: true });

    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();

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

    expect(onSend).toHaveBeenCalledWith("hello", undefined, { model: "claude:opus-4-6", planMode: false, thinkingEnabled: true }, undefined);
    expect(input).toHaveValue("hello");
  });

  // ── Attachment button tests ─────────────────────────────────────────

  it("renders add attachments button", () => {
    renderChatInput();
    expect(screen.getByRole("button", { name: "Add attachments" })).toBeInTheDocument();
  });

  it("renders model label", () => {
    renderChatInput();
    expect(screen.getByText("Opus 4.6")).toBeInTheDocument();
  });

  it("disables send button when input is empty and not streaming", () => {
    renderChatInput();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("enables send button when text is entered", async () => {
    const user = userEvent.setup();
    renderChatInput();

    await user.type(screen.getByPlaceholderText("Send a message..."), "a");

    expect(screen.getByRole("button", { name: "Send" })).not.toBeDisabled();
  });

  it("disables input and attachment controls when disabled prop is true", () => {
    renderChatInput({ disabled: true });

    expect(screen.getByPlaceholderText("Send a message...")).toBeDisabled();
  });

  it("clears text input after successful send", async () => {
    const user = userEvent.setup();
    renderChatInput();

    const input = screen.getByPlaceholderText("Send a message...");
    await user.type(input, "hello");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(input).toHaveValue("");
  });

  it("keeps input enabled when connecting (only disconnected disables)", () => {
    renderChatInput({ connectionStatus: "connecting" });
    // "connecting" still uses the default placeholder and doesn't disable input
    expect(screen.getByPlaceholderText("Send a message...")).not.toBeDisabled();
  });

  // ── Message queue tests ───────────────────────────────────────────

  it("enables textarea during streaming so user can type a follow-up", () => {
    renderChatInput({ isStreaming: true });

    expect(screen.getByPlaceholderText("Send a message...")).not.toBeDisabled();
  });

  it("disables textarea when a queued message exists", () => {
    renderChatInput({
      isStreaming: true,
      queuedMessage: { content: "queued follow-up" },
    });

    expect(screen.getByPlaceholderText("Send a message...")).toBeDisabled();
  });

  it("calls onQueue instead of onSend when submitting during streaming", async () => {
    const user = userEvent.setup();
    const { onSend, onQueue } = renderChatInput({ isStreaming: true });

    await user.type(screen.getByPlaceholderText("Send a message..."), "follow up");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(onQueue).toHaveBeenCalledWith({
      content: "follow up",
      images: undefined,
      options: { model: "claude:opus-4-6", planMode: false, thinkingEnabled: true },
    });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("shows stop and send buttons separately during streaming", () => {
    renderChatInput({ isStreaming: true });

    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
  });

  it("hides stop button when not streaming", () => {
    renderChatInput({ isStreaming: false });

    expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
  });
});
