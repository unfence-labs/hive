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
    models: [],
    defaultModelId: "",
    selectedModelId: "",
    selectedModel: undefined,
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

    // One click cycles "high" -> "xhigh" -> shows "xHigh".
    await user.click(screen.getByRole("button", { name: /Thinking: High/i }));
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
});
