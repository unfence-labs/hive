import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ChatInput from "@/components/ChatInput";
import { useCompletions } from "@/hooks/useCompletions";
import { useModels } from "@/hooks/useModels";
import type { CompletionItem } from "@/types";

vi.mock("@/hooks/useCompletions", () => ({
  useCompletions: vi.fn(),
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
    capabilities: { thinking: true, planMode: true, blockingTools: true, completions: true },
    setSelectedModelId: vi.fn(),
    isLoading: false,
  })),
}));

function makeItem(
  name: string,
  type: CompletionItem["type"],
  source: CompletionItem["source"],
): CompletionItem {
  return {
    type,
    name,
    label: type === "agent" ? `@${name}` : `/${name}`,
    source,
  };
}

describe("ChatInput autocomplete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows slash-command suggestions for '/' trigger", async () => {
    vi.mocked(useCompletions).mockReturnValue([
      makeItem("help", "slash_command", "builtin"),
      makeItem("clear", "slash_command", "builtin"),
      makeItem("reviewer", "agent", "user_agent"),
    ]);

    const user = userEvent.setup();
    render(
      <ChatInput
        wsId="ws-1"
        onSend={vi.fn(() => true)}
        onStop={vi.fn()}
        disabled={false}
        isStreaming={false}
        connectionStatus="connected"
        messages={[]}
      />,
    );

    await user.type(screen.getByPlaceholderText("Send a message..."), "/he");

    expect(screen.getByRole("button", { name: /\/help/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /@reviewer/i })).not.toBeInTheDocument();
  });

  it("shows agent suggestions for '@' trigger", async () => {
    vi.mocked(useCompletions).mockReturnValue([
      makeItem("help", "slash_command", "builtin"),
      makeItem("reviewer", "agent", "user_agent"),
      makeItem("planner", "agent", "project_agent"),
    ]);

    const user = userEvent.setup();
    render(
      <ChatInput
        wsId="ws-1"
        onSend={vi.fn(() => true)}
        onStop={vi.fn()}
        disabled={false}
        isStreaming={false}
        connectionStatus="connected"
        messages={[]}
      />,
    );

    await user.type(screen.getByPlaceholderText("Send a message..."), "@re");

    expect(screen.getByRole("button", { name: /@reviewer/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /\/help/i })).not.toBeInTheDocument();
  });

  it("inserts selected completion on click and closes popup", async () => {
    vi.mocked(useCompletions).mockReturnValue([
      makeItem("help", "slash_command", "builtin"),
      makeItem("clear", "slash_command", "builtin"),
    ]);

    const user = userEvent.setup();
    render(
      <ChatInput
        wsId="ws-1"
        onSend={vi.fn(() => true)}
        onStop={vi.fn()}
        disabled={false}
        isStreaming={false}
        connectionStatus="connected"
        messages={[]}
      />,
    );

    const input = screen.getByPlaceholderText("Send a message...");
    await user.type(input, "please /he");
    await user.click(screen.getByRole("button", { name: /\/help/i }));

    expect(input).toHaveValue("please /help ");
    expect(screen.queryByRole("button", { name: /\/help/i })).not.toBeInTheDocument();
  });

  it("supports keyboard navigation and Enter selection", async () => {
    vi.mocked(useCompletions).mockReturnValue([
      makeItem("help", "slash_command", "builtin"),
      makeItem("hello", "slash_command", "builtin"),
    ]);

    const user = userEvent.setup();
    const onSend = vi.fn(() => true);

    render(
      <ChatInput
        wsId="ws-1"
        onSend={onSend}
        onStop={vi.fn()}
        disabled={false}
        isStreaming={false}
        connectionStatus="connected"
        messages={[]}
      />,
    );

    const input = screen.getByPlaceholderText("Send a message...");
    await user.type(input, "/");
    await user.keyboard("{ArrowDown}{Enter}");

    expect(input).toHaveValue("/hello ");
    expect(onSend).not.toHaveBeenCalled();
  });

  it("closes autocomplete on Escape", async () => {
    vi.mocked(useCompletions).mockReturnValue([
      makeItem("help", "slash_command", "builtin"),
      makeItem("clear", "slash_command", "builtin"),
    ]);

    const user = userEvent.setup();
    render(
      <ChatInput
        wsId="ws-1"
        onSend={vi.fn(() => true)}
        onStop={vi.fn()}
        disabled={false}
        isStreaming={false}
        connectionStatus="connected"
        messages={[]}
      />,
    );

    await user.type(screen.getByPlaceholderText("Send a message..."), "/h");
    expect(screen.getByRole("button", { name: /\/help/i })).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("button", { name: /\/help/i })).not.toBeInTheDocument();
  });

  it("does not trigger autocomplete when marker is not at word boundary", async () => {
    vi.mocked(useCompletions).mockReturnValue([
      makeItem("help", "slash_command", "builtin"),
    ]);

    const user = userEvent.setup();
    render(
      <ChatInput
        wsId="ws-1"
        onSend={vi.fn(() => true)}
        onStop={vi.fn()}
        disabled={false}
        isStreaming={false}
        connectionStatus="connected"
        messages={[]}
      />,
    );

    await user.type(screen.getByPlaceholderText("Send a message..."), "abc/help");

    expect(screen.queryByRole("button", { name: /\/help/i })).not.toBeInTheDocument();
  });

  it("suppresses autocomplete when provider does not support completions", async () => {
    vi.mocked(useModels).mockReturnValue({
      models: [],
      defaultModelId: "",
      selectedModelId: "codex:gpt-5.3-codex",
      selectedModel: undefined,
      capabilities: { thinking: "levels", planMode: false, blockingTools: false, completions: false },
      setSelectedModelId: vi.fn(),
      isLoading: false,
    });
    vi.mocked(useCompletions).mockReturnValue([
      makeItem("help", "slash_command", "builtin"),
      makeItem("clear", "slash_command", "builtin"),
    ]);

    const user = userEvent.setup();
    render(
      <ChatInput
        wsId="ws-1"
        onSend={vi.fn(() => true)}
        onStop={vi.fn()}
        disabled={false}
        isStreaming={false}
        connectionStatus="connected"
        messages={[]}
      />,
    );

    await user.type(screen.getByPlaceholderText("Send a message..."), "/he");

    expect(screen.queryByRole("button", { name: /\/help/i })).not.toBeInTheDocument();
  });
});
