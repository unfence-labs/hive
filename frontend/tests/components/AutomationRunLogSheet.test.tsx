import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import AutomationRunLogSheet from "@/components/AutomationRunLogSheet";
import type { AutomationRun, ChatMessage } from "@/types";

const mocks = vi.hoisted(() => ({
  useAutomationRunMessages: vi.fn(),
}));

vi.mock("@/hooks/useAutomations", () => ({
  useAutomationRunMessages: mocks.useAutomationRunMessages,
}));

vi.mock("@/components/ChatMessage", () => ({
  default: ({ message }: { message: ChatMessage }) => (
    <div data-testid="chat-message">{message.content}</div>
  ),
}));

vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({
    open,
    onOpenChange,
    children,
  }: {
    open: boolean;
    onOpenChange?: (open: boolean) => void;
    children: ReactNode;
  }) => (
    <div data-testid="sheet" data-open={String(open)}>
      <button type="button" onClick={() => onOpenChange?.(false)}>close-sheet</button>
      {children}
    </div>
  ),
  SheetContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

function makeRun(overrides: Partial<AutomationRun> = {}): AutomationRun {
  return {
    id: "run-1",
    automationId: "auto-1",
    status: "success",
    sessionId: "sess-1",
    startedAt: "2026-01-01T00:00:00Z",
    completedAt: "2026-01-01T00:01:00Z",
    durationMs: 60_000,
    ...overrides,
  };
}

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "msg-1",
    sessionId: "sess-1",
    role: "assistant",
    content: "Done.",
    timestamp: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("AutomationRunLogSheet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows empty state when a run has no messages", () => {
    mocks.useAutomationRunMessages.mockReturnValue({
      data: { messages: [] },
      isLoading: false,
    });

    render(
      <AutomationRunLogSheet automationId="auto-1" run={makeRun()} onClose={vi.fn()} />,
    );

    expect(screen.getByText("No messages recorded for this run.")).toBeInTheDocument();
  });

  it("renders run messages when available", () => {
    mocks.useAutomationRunMessages.mockReturnValue({
      data: { messages: [makeMessage(), makeMessage({ id: "msg-2", content: "Second" })] },
      isLoading: false,
    });

    render(
      <AutomationRunLogSheet automationId="auto-1" run={makeRun()} onClose={vi.fn()} />,
    );

    const rendered = screen.getAllByTestId("chat-message");
    expect(rendered).toHaveLength(2);
    expect(rendered[0]).toHaveTextContent("Done.");
    expect(screen.getByText("Second")).toBeInTheDocument();
  });

  it("shows and toggles persisted system prompt", async () => {
    const user = userEvent.setup();
    mocks.useAutomationRunMessages.mockReturnValue({
      data: {
        messages: [makeMessage()],
        systemPrompt: "You are a strict reviewer.",
      },
      isLoading: false,
    });

    render(
      <AutomationRunLogSheet automationId="auto-1" run={makeRun()} onClose={vi.fn()} />,
    );

    expect(screen.getByText("System Prompt")).toBeInTheDocument();
    expect(screen.queryByText("You are a strict reviewer.")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "System Prompt" }));
    expect(screen.getByText("You are a strict reviewer.")).toBeInTheDocument();
  });

  it("calls onClose when the sheet requests close", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    mocks.useAutomationRunMessages.mockReturnValue({
      data: { messages: [makeMessage()] },
      isLoading: false,
    });

    render(
      <AutomationRunLogSheet automationId="auto-1" run={makeRun()} onClose={onClose} />,
    );

    await user.click(screen.getByRole("button", { name: "close-sheet" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not query run messages when no run is selected", () => {
    mocks.useAutomationRunMessages.mockReturnValue({
      data: undefined,
      isLoading: false,
    });

    render(
      <AutomationRunLogSheet automationId="auto-1" run={null} onClose={vi.fn()} />,
    );

    expect(mocks.useAutomationRunMessages).toHaveBeenCalledWith(undefined, undefined);
    expect(screen.getByTestId("sheet")).toHaveAttribute("data-open", "false");
  });
});
