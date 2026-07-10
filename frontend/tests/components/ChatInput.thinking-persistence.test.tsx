import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ChatInput from "@/components/ChatInput";

vi.mock("@/hooks/useCompletions", () => ({
  useCompletions: () => [],
}));

vi.mock("@/hooks/useFileCompletions", () => ({
  useFileCompletions: () => [],
}));

vi.mock("@/hooks/useModels", () => ({
  useModels: vi.fn(() => ({
    models: [
      {
        id: "claude:opus-4-7",
        modelId: "opus-4-7",
        label: "Opus 4.7",
        provider: "claude",
        providerLabel: "Claude Code",
        supportsFastMode: true,
        capabilities: { thinkingLevels: ["low", "medium", "high", "xhigh", "max"], planMode: true, blockingTools: true, completions: true },
      },
    ],
    defaultModelId: "claude:opus-4-7",
    selectedModelId: "claude:opus-4-7",
    selectedModel: {
      id: "claude:opus-4-7",
      modelId: "opus-4-7",
      label: "Opus 4.7",
      provider: "claude",
      providerLabel: "Claude Code",
      supportsFastMode: true,
      capabilities: { thinkingLevels: ["low", "medium", "high", "xhigh", "max"], planMode: true, blockingTools: true, completions: true },
    },
    capabilities: { thinkingLevels: ["low", "medium", "high", "xhigh", "max"], planMode: true, blockingTools: true, completions: true },
    setSelectedModelId: vi.fn(),
    isLoading: false,
  })),
}));

describe("ChatInput thinking-level persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("restores the thinking level across remount for the same session", async () => {
    const user = userEvent.setup();

    const { unmount } = render(
      <ChatInput
        wsId="ws-1"
        sessionId="sess-persist-A"
        onSend={vi.fn(() => true)}
        onStop={vi.fn()}
        disabled={false}
        isStreaming={false}
        connectionStatus="connected"
        messages={[]}
      />,
    );

    // Default seed is "high" → "High".
    expect(screen.getByRole("button", { name: /Thinking: High/i })).toBeInTheDocument();

    // Select xHigh from the thinking dropdown.
    await user.click(screen.getByRole("button", { name: /Thinking: High/i }));
    await user.click(screen.getByRole("menuitem", { name: "xHigh" }));
    expect(screen.getByRole("button", { name: /Thinking: xHigh/i })).toBeInTheDocument();

    unmount();

    render(
      <ChatInput
        wsId="ws-1"
        sessionId="sess-persist-A"
        onSend={vi.fn(() => true)}
        onStop={vi.fn()}
        disabled={false}
        isStreaming={false}
        connectionStatus="connected"
        messages={[]}
      />,
    );

    // Persisted across remount for the same session.
    expect(screen.getByRole("button", { name: /Thinking: xHigh/i })).toBeInTheDocument();
  });

  it("does not leak the persisted level into a different session", () => {
    render(
      <ChatInput
        wsId="ws-1"
        sessionId="sess-persist-B"
        onSend={vi.fn(() => true)}
        onStop={vi.fn()}
        disabled={false}
        isStreaming={false}
        connectionStatus="connected"
        messages={[]}
      />,
    );

    expect(screen.getByRole("button", { name: /Thinking: High/i })).toBeInTheDocument();
  });

  it("restores plan and fast mode across remount for the same session", async () => {
    const user = userEvent.setup();

    const firstSend = vi.fn(() => true);
    const { unmount } = render(
      <ChatInput
        wsId="ws-1"
        sessionId="sess-compose-options-A"
        onSend={firstSend}
        onStop={vi.fn()}
        disabled={false}
        isStreaming={false}
        connectionStatus="connected"
        messages={[]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Toggle plan mode" }));
    await user.click(screen.getByRole("button", { name: "Toggle fast mode (faster Opus, higher cost)" }));

    unmount();

    const secondSend = vi.fn(() => true);
    render(
      <ChatInput
        wsId="ws-1"
        sessionId="sess-compose-options-A"
        onSend={secondSend}
        onStop={vi.fn()}
        disabled={false}
        isStreaming={false}
        connectionStatus="connected"
        messages={[]}
      />,
    );

    await user.type(screen.getByPlaceholderText("Send message, #mention files, @call agents, run /commands"), "hello");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(secondSend).toHaveBeenCalledWith("hello", undefined, {
      model: "claude:opus-4-7",
      planMode: true,
      thinkingLevel: "high",
      fastMode: true,
    }, undefined);
  });

  it("isolates plan and fast mode by workspace for the same session id", async () => {
    const user = userEvent.setup();
    const sessionId = "sess-compose-options-shared";

    const { unmount } = render(
      <ChatInput
        wsId="ws-compose-A"
        sessionId={sessionId}
        onSend={vi.fn(() => true)}
        onStop={vi.fn()}
        disabled={false}
        isStreaming={false}
        connectionStatus="connected"
        messages={[]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Toggle plan mode" }));
    await user.click(screen.getByRole("button", { name: "Toggle fast mode (faster Opus, higher cost)" }));

    unmount();

    const workspaceBSend = vi.fn(() => true);
    render(
      <ChatInput
        wsId="ws-compose-B"
        sessionId={sessionId}
        onSend={workspaceBSend}
        onStop={vi.fn()}
        disabled={false}
        isStreaming={false}
        connectionStatus="connected"
        messages={[]}
      />,
    );

    await user.type(screen.getByPlaceholderText("Send message, #mention files, @call agents, run /commands"), "hello");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(workspaceBSend).toHaveBeenCalledWith("hello", undefined, {
      model: "claude:opus-4-7",
      planMode: false,
      thinkingLevel: "high",
    }, undefined);
  });
});
