import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRef, type ComponentProps } from "react";
import ChatInput, { type ChatInputHandle } from "@/components/ChatInput";

const modelMock = vi.hoisted(() => {
  const capabilities = { thinkingLevels: ["low", "medium", "high", "xhigh", "max"], planMode: true, blockingTools: true, completions: true };
  const models = [
    { id: "claude:opus-4-7", modelId: "opus-4-7", label: "Opus 4.7", provider: "claude", providerLabel: "Claude Code", supportsFastMode: true, capabilities },
    { id: "claude:sonnet-4-6", modelId: "sonnet-4-6", label: "Sonnet 4.6", provider: "claude", providerLabel: "Claude Code", capabilities },
  ];
  return {
    models,
    selectedModelId: "claude:opus-4-7",
    setSelectedModelId: vi.fn((id: string) => {
      modelMock.selectedModelId = id;
    }),
  };
});

vi.mock("@/hooks/useModels", () => ({
  useModels: () => ({
    models: modelMock.models,
    defaultModelId: "claude:opus-4-7",
    selectedModelId: modelMock.selectedModelId,
    selectedModel: modelMock.models.find((model) => model.id === modelMock.selectedModelId),
    capabilities: modelMock.models.find((model) => model.id === modelMock.selectedModelId)?.capabilities,
    setSelectedModelId: modelMock.setSelectedModelId,
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
  const view = render(
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
  const rerender = (nextOverrides?: Partial<ComponentProps<typeof ChatInput>>) => {
    view.rerender(
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
          {...nextOverrides}
        />
      </QueryClientProvider>,
    );
  };
  return { onSend, onStop, onQueue, rerender };
}

describe("ChatInput", () => {
  beforeEach(() => {
    modelMock.selectedModelId = "claude:opus-4-7";
    modelMock.setSelectedModelId.mockClear();
  });

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

  it("disables native text replacement suggestions in the message input", () => {
    renderChatInput();

    const input = screen.getByPlaceholderText("Send message, #mention files, @call agents, run /commands");

    expect(input).toHaveAttribute("autocapitalize", "off");
    expect(input).toHaveAttribute("autocomplete", "off");
    expect(input).toHaveAttribute("autocorrect", "off");
    expect(input).toHaveAttribute("spellcheck", "false");
  });

  it("appends text through the imperative ref API", () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const ref = createRef<ChatInputHandle>();

    render(
      <QueryClientProvider client={queryClient}>
        <ChatInput
          ref={ref}
          onSend={vi.fn(() => true)}
          onStop={vi.fn()}
          onQueue={vi.fn()}
          disabled={false}
          isStreaming={false}
          connectionStatus="connected"
          messages={[]}
        />
      </QueryClientProvider>,
    );

    const input = screen.getByPlaceholderText("Send message, #mention files, @call agents, run /commands");
    expect(input).toHaveValue("");

    act(() => {
      ref.current?.appendText("First note");
    });
    expect(input).toHaveValue("First note");

    act(() => {
      ref.current?.appendText("Second note");
    });
    expect(input).toHaveValue("First note\n\nSecond note");
  });

  it("sends message on Send button click", async () => {
    const user = userEvent.setup();
    const { onSend } = renderChatInput();

    await user.type(screen.getByPlaceholderText("Send message, #mention files, @call agents, run /commands"), "hello");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(onSend).toHaveBeenCalledWith("hello", undefined, { model: "claude:opus-4-7", planMode: false, thinkingLevel: "high" }, undefined, undefined);
  });

  it("sends message on Enter without Shift", async () => {
    const user = userEvent.setup();
    const { onSend } = renderChatInput();

    await user.type(screen.getByPlaceholderText("Send message, #mention files, @call agents, run /commands"), "hello{enter}");

    expect(onSend).toHaveBeenCalledWith("hello", undefined, { model: "claude:opus-4-7", planMode: false, thinkingLevel: "high" }, undefined, undefined);
  });

  it("does not send on Shift+Enter", async () => {
    const user = userEvent.setup();
    const { onSend } = renderChatInput();

    await user.type(screen.getByPlaceholderText("Send message, #mention files, @call agents, run /commands"), "hello{shift>}{enter}{/shift}");

    expect(onSend).not.toHaveBeenCalled();
  });

  it("selects thinking level from the dropdown and toggles plan mode", async () => {
    const user = userEvent.setup();
    const { onSend } = renderChatInput();

    await user.click(screen.getByRole("button", { name: /^Thinking:/ }));
    await user.click(screen.getByRole("menuitem", { name: "xHigh" }));
    await user.click(screen.getByRole("button", { name: "Toggle plan mode" }));
    await user.type(screen.getByPlaceholderText("Send message, #mention files, @call agents, run /commands"), "hello");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(onSend).toHaveBeenCalledWith("hello", undefined, { model: "claude:opus-4-7", planMode: true, thinkingLevel: "xhigh" }, undefined, undefined);
  });

  it("shows Fast only for models that support it", () => {
    const { rerender } = renderChatInput();
    expect(screen.getByRole("button", { name: "Toggle fast mode (faster Opus, higher cost)" })).toBeInTheDocument();

    modelMock.selectedModelId = "claude:sonnet-4-6";
    rerender();

    expect(screen.queryByRole("button", { name: "Toggle fast mode (faster Opus, higher cost)" })).not.toBeInTheDocument();
  });

  it("sends fastMode only after the Opus Fast toggle is enabled", async () => {
    const user = userEvent.setup();
    const { onSend } = renderChatInput();

    await user.click(screen.getByRole("button", { name: "Toggle fast mode (faster Opus, higher cost)" }));
    await user.type(screen.getByPlaceholderText("Send message, #mention files, @call agents, run /commands"), "hello");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(onSend).toHaveBeenCalledWith("hello", undefined, {
      model: "claude:opus-4-7",
      planMode: false,
      thinkingLevel: "high",
      fastMode: true,
    }, undefined, undefined);
  });

  it("does not send fastMode for models that do not support it", async () => {
    modelMock.selectedModelId = "claude:sonnet-4-6";
    const user = userEvent.setup();
    const { onSend } = renderChatInput();

    expect(screen.queryByRole("button", { name: "Toggle fast mode (faster Opus, higher cost)" })).not.toBeInTheDocument();
    await user.type(screen.getByPlaceholderText("Send message, #mention files, @call agents, run /commands"), "hello");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(onSend).toHaveBeenCalledWith("hello", undefined, {
      model: "claude:sonnet-4-6",
      planMode: false,
      thinkingLevel: "high",
    }, undefined, undefined);
  });

  it("can select the default thinking level from the dropdown", async () => {
    const user = userEvent.setup();
    const { onSend } = renderChatInput();

    const thinkingButton = () => screen.getByRole("button", { name: /^Thinking:/ });
    await user.click(thinkingButton());
    await user.click(screen.getByRole("menuitem", { name: "Max" }));
    await user.click(thinkingButton());
    await user.click(screen.getByRole("menuitem", { name: "High" }));
    await user.type(screen.getByPlaceholderText("Send message, #mention files, @call agents, run /commands"), "hello");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(onSend).toHaveBeenCalledWith("hello", undefined, { model: "claude:opus-4-7", planMode: false, thinkingLevel: "high" }, undefined, undefined);
  });

  it("enables plan mode automatically when agentPlanMode is true", async () => {
    const user = userEvent.setup();
    const { onSend } = renderChatInput({ agentPlanMode: true });

    await user.type(screen.getByPlaceholderText("Send message, #mention files, @call agents, run /commands"), "hello");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(onSend).toHaveBeenCalledWith("hello", undefined, {
      model: "claude:opus-4-7",
      planMode: true,
      thinkingLevel: "high",
    }, undefined, undefined);
  });

  it("updates plan mode when agentPlanMode changes", async () => {
    const user = userEvent.setup();
    const { onSend, rerender } = renderChatInput({ agentPlanMode: true });

    rerender({ agentPlanMode: false });
    await user.type(screen.getByPlaceholderText("Send message, #mention files, @call agents, run /commands"), "hello");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(onSend).toHaveBeenCalledWith("hello", undefined, {
      model: "claude:opus-4-7",
      planMode: false,
      thinkingLevel: "high",
    }, undefined, undefined);
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

    const input = screen.getByPlaceholderText("Send message, #mention files, @call agents, run /commands");
    await user.type(input, "hello");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(onSend).toHaveBeenCalledWith("hello", undefined, { model: "claude:opus-4-7", planMode: false, thinkingLevel: "high" }, undefined, undefined);
    expect(input).toHaveValue("hello");
  });

  // ── Attachment button tests ─────────────────────────────────────────

  it("renders add attachments button", () => {
    renderChatInput();
    expect(screen.getByRole("button", { name: "Add attachments" })).toBeInTheDocument();
  });

  it("renders model label", () => {
    renderChatInput();
    expect(screen.getByText("Opus 4.7")).toBeInTheDocument();
  });

  it("disables send button when input is empty and not streaming", () => {
    renderChatInput();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("enables send button when text is entered", async () => {
    const user = userEvent.setup();
    renderChatInput();

    await user.type(screen.getByPlaceholderText("Send message, #mention files, @call agents, run /commands"), "a");

    expect(screen.getByRole("button", { name: "Send" })).not.toBeDisabled();
  });

  it("disables input and attachment controls when disabled prop is true", () => {
    renderChatInput({ disabled: true });

    expect(screen.getByPlaceholderText("Send message, #mention files, @call agents, run /commands")).toBeDisabled();
  });

  it("clears text input after successful send", async () => {
    const user = userEvent.setup();
    renderChatInput();

    const input = screen.getByPlaceholderText("Send message, #mention files, @call agents, run /commands");
    await user.type(input, "hello");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(input).toHaveValue("");
  });

  it("keeps input enabled when connecting (only disconnected disables)", () => {
    renderChatInput({ connectionStatus: "connecting" });
    // "connecting" still uses the default placeholder and doesn't disable input
    expect(screen.getByPlaceholderText("Send message, #mention files, @call agents, run /commands")).not.toBeDisabled();
  });

  // ── Message queue tests ───────────────────────────────────────────

  it("enables textarea during streaming so user can type a follow-up", () => {
    renderChatInput({ isStreaming: true });

    expect(screen.getByPlaceholderText("Send message, #mention files, @call agents, run /commands")).not.toBeDisabled();
  });

  it("disables textarea when a queued message exists", () => {
    renderChatInput({
      isStreaming: true,
      queuedMessage: { content: "queued follow-up" },
    });

    expect(screen.getByPlaceholderText("Send message, #mention files, @call agents, run /commands")).toBeDisabled();
  });

  it("calls onQueue instead of onSend when submitting during streaming", async () => {
    const user = userEvent.setup();
    const { onSend, onQueue } = renderChatInput({ isStreaming: true });

    await user.type(screen.getByPlaceholderText("Send message, #mention files, @call agents, run /commands"), "follow up");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(onQueue).toHaveBeenCalledWith({
      content: "follow up",
      images: undefined,
      options: { model: "claude:opus-4-7", planMode: false, thinkingLevel: "high" },
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
