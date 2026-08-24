import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRef, type ComponentProps } from "react";
import ChatInput, { type ChatInputHandle } from "@/components/ChatInput";
import type { OutputStyle } from "@/types";

const modelMock = vi.hoisted(() => {
  const capabilities = { thinkingLevels: ["low", "medium", "high", "xhigh", "max"], planMode: true, blockingTools: true, completions: true, outputStyles: undefined as OutputStyle[] | undefined };
  const models = [
    { id: "claude:opus-4-7", modelId: "opus-4-7", label: "Opus 4.7", provider: "claude", providerLabel: "Claude Code", supportsFastMode: true, capabilities: { ...capabilities } },
    { id: "claude:sonnet-4-6", modelId: "sonnet-4-6", label: "Sonnet 4.6", provider: "claude", providerLabel: "Claude Code", capabilities: { ...capabilities } },
  ];
  return {
    models,
    availableModels: models,
    selectedModelId: "claude:opus-4-7",
    isLoading: false,
    isError: false,
    retry: vi.fn(),
    setSelectedModelId: vi.fn((id: string) => {
      modelMock.selectedModelId = id;
    }),
  };
});

vi.mock("@/hooks/useModels", () => ({
  useModels: () => ({
    models: modelMock.availableModels,
    defaultModelId: "claude:opus-4-7",
    selectedModelId: modelMock.selectedModelId,
    selectedModel: modelMock.availableModels.find((model) => model.id === modelMock.selectedModelId),
    capabilities: modelMock.availableModels.find((model) => model.id === modelMock.selectedModelId)?.capabilities,
    setSelectedModelId: modelMock.setSelectedModelId,
    isLoading: modelMock.isLoading,
    isError: modelMock.isError,
    retry: modelMock.retry,
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
    modelMock.availableModels = modelMock.models;
    modelMock.selectedModelId = "claude:opus-4-7";
    modelMock.isLoading = false;
    modelMock.isError = false;
    modelMock.setSelectedModelId.mockClear();
    modelMock.retry.mockClear();
    for (const model of modelMock.models) model.capabilities.outputStyles = undefined;
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

  it("keeps typing available but blocks sending while models load", async () => {
    modelMock.availableModels = [];
    modelMock.selectedModelId = "";
    modelMock.isLoading = true;
    const user = userEvent.setup();
    const { onSend } = renderChatInput();

    const input = screen.getByPlaceholderText("Send message, #mention files, @call agents, run /commands");
    expect(screen.getByRole("button", { name: "Loading models" })).toBeDisabled();
    expect(screen.getByText("Loading models…")).toHaveAttribute("aria-live", "polite");

    await user.type(input, "draft while loading{enter}");

    expect(input).toHaveValue("draft while loading");
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(onSend).not.toHaveBeenCalled();
  });

  it("offers a direct accessible retry when model loading fails", async () => {
    modelMock.availableModels = [];
    modelMock.selectedModelId = "";
    modelMock.isError = true;
    const user = userEvent.setup();
    renderChatInput();

    const retry = screen.getByRole("button", { name: "Retry models" });
    expect(screen.getByText("Retry models")).toHaveAttribute("aria-live", "polite");
    await user.click(retry);

    expect(modelMock.retry).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("surfaces a stale-catalog error and restores the selected model after recovery", async () => {
    modelMock.isError = true;
    const user = userEvent.setup();
    const { onSend, rerender } = renderChatInput();

    const input = screen.getByPlaceholderText("Send message, #mention files, @call agents, run /commands");
    await user.type(input, "draft with stale models");
    expect(screen.getByRole("button", { name: "Retry models" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).not.toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Retry models" }));
    expect(modelMock.retry).toHaveBeenCalledTimes(1);

    modelMock.isError = false;
    rerender();

    expect(screen.getByRole("button", { name: "Model: Opus 4.7" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).toHaveBeenCalledWith(
      "draft with stale models",
      undefined,
      { model: "claude:opus-4-7", planMode: false, thinkingLevel: "high" },
      undefined,
    );
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

    expect(onSend).toHaveBeenCalledWith("hello", undefined, { model: "claude:opus-4-7", planMode: false, thinkingLevel: "high" }, undefined);
  });

  it("sends message on Enter without Shift", async () => {
    const user = userEvent.setup();
    const { onSend } = renderChatInput();

    await user.type(screen.getByPlaceholderText("Send message, #mention files, @call agents, run /commands"), "hello{enter}");

    expect(onSend).toHaveBeenCalledWith("hello", undefined, { model: "claude:opus-4-7", planMode: false, thinkingLevel: "high" }, undefined);
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

    expect(onSend).toHaveBeenCalledWith("hello", undefined, { model: "claude:opus-4-7", planMode: true, thinkingLevel: "xhigh" }, undefined);
  });

  it("selects and sends a native output style", async () => {
    modelMock.models[0].capabilities.outputStyles = ["default", "proactive", "concise", "explanatory", "learning"];
    const user = userEvent.setup();
    const { onSend, rerender } = renderChatInput();
    rerender();

    await user.click(screen.getByRole("button", { name: "More options" }));
    await user.click(screen.getByRole("menuitem", { name: /^Output/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Explanatory" }));
    await user.type(screen.getByPlaceholderText("Send message, #mention files, @call agents, run /commands"), "hello");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(onSend).toHaveBeenCalledWith("hello", undefined, {
      model: "claude:opus-4-7",
      planMode: false,
      thinkingLevel: "high",
      outputStyle: "explanatory",
    }, undefined);
  });

  it("selects and sends a Codex personality label", async () => {
    const codexModel = {
      ...modelMock.models[0],
      id: "codex:gpt-5.5",
      modelId: "gpt-5.5",
      label: "GPT-5.5",
      provider: "codex",
      providerLabel: "Codex",
      supportsFastMode: undefined,
      capabilities: {
        ...modelMock.models[0].capabilities,
        planMode: false,
        outputStyles: ["default", "friendly", "pragmatic", "none"] as OutputStyle[],
      },
    };
    modelMock.availableModels = [...modelMock.models, codexModel];
    modelMock.selectedModelId = codexModel.id;
    const user = userEvent.setup();
    const { onSend } = renderChatInput();

    await user.click(screen.getByRole("button", { name: "More options" }));
    await user.click(screen.getByRole("menuitem", { name: /^Output/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Friendly" }));
    await user.type(screen.getByPlaceholderText("Send message, #mention files, @call agents, run /commands"), "hello");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(onSend).toHaveBeenCalledWith("hello", undefined, expect.objectContaining({
      model: "codex:gpt-5.5",
      outputStyle: "friendly",
    }), undefined);
  });

  it("hides output styles for Codex models without personality support", () => {
    const codexModel = {
      ...modelMock.models[0],
      id: "codex:gpt-5.6-sol",
      modelId: "gpt-5.6-sol",
      label: "GPT-5.6 Sol",
      provider: "codex",
      providerLabel: "Codex",
      supportsFastMode: undefined,
      capabilities: {
        ...modelMock.models[0].capabilities,
        planMode: false,
        outputStyles: undefined,
      },
    };
    modelMock.availableModels = [...modelMock.models, codexModel];
    modelMock.selectedModelId = codexModel.id;

    renderChatInput();

    expect(screen.queryByRole("button", { name: "More options" })).not.toBeInTheDocument();
  });

  it("resets an incompatible output style to Default after switching models", async () => {
    modelMock.models[0].capabilities.outputStyles = ["default", "explanatory"];
    modelMock.models[1].capabilities.outputStyles = ["default"];
    const user = userEvent.setup();
    const { onSend, rerender } = renderChatInput();
    rerender();

    await user.click(screen.getByRole("button", { name: "More options" }));
    await user.click(screen.getByRole("menuitem", { name: /^Output/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Explanatory" }));
    modelMock.selectedModelId = "claude:sonnet-4-6";
    rerender();
    await user.type(screen.getByPlaceholderText("Send message, #mention files, @call agents, run /commands"), "hello");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(onSend).toHaveBeenCalledWith("hello", undefined, {
      model: "claude:sonnet-4-6",
      planMode: false,
      thinkingLevel: "high",
      outputStyle: "default",
    }, undefined);
    await user.click(screen.getByRole("button", { name: "More options" }));
    expect(screen.getByRole("menuitem", { name: /^Output/ })).toHaveTextContent("Default");
  });

  it("restores and disables the output style without resending the locked value", async () => {
    modelMock.models[0].capabilities.outputStyles = ["default", "learning"];
    const user = userEvent.setup();
    const { onSend, rerender } = renderChatInput({
      lastRunOptions: { model: "claude:opus-4-7", outputStyle: "learning" },
      messages: [{
        id: "user-1",
        sessionId: "session-1",
        role: "user",
        content: "Hello",
        timestamp: "2026-08-22T00:00:00.000Z",
      }],
    });
    rerender();

    await user.click(screen.getByRole("button", { name: "More options" }));
    const lockedRow = screen.getByRole("menuitem", { name: /^Output/ });
    expect(lockedRow).toHaveTextContent("Learning");
    expect(lockedRow).toHaveAttribute("aria-disabled", "true");
    await user.keyboard("{Escape}");

    await user.type(
      screen.getByPlaceholderText("Send message, #mention files, @call agents, run /commands"),
      "Follow up",
    );
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(onSend).toHaveBeenCalledWith("Follow up", undefined, {
      model: "claude:opus-4-7",
      planMode: false,
      thinkingLevel: "high",
    }, undefined);
  });

  it("keeps the Fast row visible but inert for non-fast models of the provider", async () => {
    const user = userEvent.setup();
    const { rerender } = renderChatInput();

    await user.click(screen.getByRole("button", { name: "More options" }));
    expect(screen.getByRole("menuitem", { name: "Fast mode" })).toBeInTheDocument();
    await user.keyboard("{Escape}");

    modelMock.selectedModelId = "claude:sonnet-4-6";
    rerender();

    await user.click(screen.getByRole("button", { name: "More options" }));
    expect(screen.queryByRole("menuitem", { name: "Fast mode" })).not.toBeInTheDocument();
    expect(screen.getByText("Fast mode")).toBeInTheDocument();
  });

  it("sends fastMode only after the Opus Fast toggle is enabled", async () => {
    const user = userEvent.setup();
    const { onSend } = renderChatInput();

    await user.click(screen.getByRole("button", { name: "More options" }));
    await user.click(screen.getByRole("menuitem", { name: "Fast mode" }));
    await user.keyboard("{Escape}");
    await user.type(screen.getByPlaceholderText("Send message, #mention files, @call agents, run /commands"), "hello");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(onSend).toHaveBeenCalledWith("hello", undefined, {
      model: "claude:opus-4-7",
      planMode: false,
      thinkingLevel: "high",
      fastMode: true,
    }, undefined);
  });

  it("does not send fastMode for models that do not support it", async () => {
    modelMock.selectedModelId = "claude:sonnet-4-6";
    const user = userEvent.setup();
    const { onSend } = renderChatInput();

    await user.type(screen.getByPlaceholderText("Send message, #mention files, @call agents, run /commands"), "hello");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(onSend).toHaveBeenCalledWith("hello", undefined, {
      model: "claude:sonnet-4-6",
      planMode: false,
      thinkingLevel: "high",
    }, undefined);
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

    expect(onSend).toHaveBeenCalledWith("hello", undefined, { model: "claude:opus-4-7", planMode: false, thinkingLevel: "high" }, undefined);
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
    }, undefined);
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
    }, undefined);
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

    expect(onSend).toHaveBeenCalledWith("hello", undefined, { model: "claude:opus-4-7", planMode: false, thinkingLevel: "high" }, undefined);
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
