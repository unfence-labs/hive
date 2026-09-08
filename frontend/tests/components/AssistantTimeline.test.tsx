import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import ChatConversation from "@/components/ChatConversation";
import ChatMessage from "@/components/ChatMessage";
import type { ChatMessage as Message } from "@/types";

vi.mock("@/components/ai-elements/message", () => ({
  MessageResponse: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/chat/ConversationFind", () => ({ ConversationFind: () => null }));
vi.mock("@/components/ai-elements/conversation", () => ({
  Conversation: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ConversationContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ConversationEmptyState: () => null,
  ConversationScrollButton: () => null,
  ConversationScrollLockReEngager: () => null,
  ConversationScrollTrigger: () => null,
}));

const turn: Message = {
  id: "turn-1", sessionId: "session-1", role: "assistant", timestamp: "2026-09-08T10:00:00Z",
  content: "BeforeAfter",
  timeline: [
    { type: "text", id: "a", text: "Before" },
    { type: "tool", id: "read" },
    { type: "reasoning", id: "thought" },
    { type: "text", id: "b", text: "After" },
    { type: "activity", id: "warning" },
    { type: "tool", id: "test" },
  ],
  reasoningSegments: [{ id: "thought:0", body: "Considering the result" }],
  toolCalls: [
    { id: "read", name: "Read", input: '{"file_path":"src/settings.ts"}', output: "read output" },
    { id: "test", name: "Bash", input: '{"command":"npm test"}', output: "test output", isError: true },
  ],
  agentActivities: [{ id: "warning", kind: "diagnostic", severity: "warning", title: "Check configuration", message: "Configuration is incomplete" }],
};

function before(first: Element, second: Element) {
  expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
}

describe("chronological assistant rendering", () => {
  it("keeps text, reasoning, diagnostics and consecutive action groups in order", async () => {
    const user = userEvent.setup();
    render(<ChatMessage message={turn} />);
    const groups = screen.getAllByRole("button", { name: /1 action/ });
    before(screen.getByText("Before"), groups[0]);
    before(groups[0], screen.getByRole("button", { name: "Reasoning" }));
    before(screen.getByRole("button", { name: "Reasoning" }), screen.getByText("After"));
    before(screen.getByText("After"), screen.getByText("Check configuration"));
    before(screen.getByText("Check configuration"), groups[1]);
    expect(screen.getByLabelText("Action failed")).toBeVisible();
    expect(screen.queryByText("Considering the result")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reasoning" }));
    expect(screen.getByText("Considering the result")).toBeVisible();
  });

  it("preserves opened group and tool details through live completion and REST replacement", async () => {
    const user = userEvent.setup();
    const props = {
      messages: [] as Message[], isStreaming: true, currentStreamingText: turn.content,
      currentTimeline: turn.timeline, streamingMessageId: turn.id,
      currentReasoningSegments: turn.reasoningSegments!, activeToolCalls: turn.toolCalls!,
      activeAgentActivities: turn.agentActivities!, switchCounter: 0,
    };
    const { rerender } = render(<ChatConversation {...props} />);
    await user.click(screen.getAllByRole("button", { name: /1 action/ })[0]);
    await user.click(screen.getByRole("button", { name: /Read.*settings.ts/ }));
    expect(screen.getByText(/Path: src\/settings.ts/)).toBeVisible();
    // Closing and reopening the group must also retain the nested tool toggle.
    await user.click(screen.getAllByRole("button", { name: /1 action/ })[0]);
    await user.click(screen.getAllByRole("button", { name: /1 action/ })[0]);
    expect(screen.getByText(/Path: src\/settings.ts/)).toBeVisible();
    rerender(<ChatConversation {...props} isStreaming={false} currentTimeline={undefined} messages={[turn]} />);
    expect(screen.getByText(/Path: src\/settings.ts/)).toBeVisible();
    rerender(<ChatConversation {...props} isStreaming={false} currentTimeline={undefined} messages={[structuredClone(turn)]} />);
    expect(screen.getByText(/Path: src\/settings.ts/)).toBeVisible();
    expect(screen.getAllByText("Before")).toHaveLength(1);
  });

  it("retains expanded content after an idle reconnect until REST supplies the finished turn", async () => {
    const user = userEvent.setup();
    const props = {
      messages: [] as Message[], isStreaming: true, currentStreamingText: turn.content,
      currentTimeline: turn.timeline, streamingMessageId: turn.id,
      currentReasoningSegments: turn.reasoningSegments!,
      activeToolCalls: turn.toolCalls!.map((tool) => ({ ...tool, output: undefined })),
      activeAgentActivities: turn.agentActivities!, switchCounter: 0,
    };
    const { rerender } = render(<ChatConversation {...props} />);
    await user.click(screen.getAllByRole("button", { name: /1 action/ })[0]);
    await user.click(screen.getByRole("button", { name: /Read.*settings.ts/ }));
    expect(screen.getByText(/Path: src\/settings.ts/)).toBeVisible();
    expect(screen.getByRole("button", { name: /1 action · Read/ })).toBeVisible();

    // The done frame was missed. Idle status stops animations before REST returns.
    rerender(<ChatConversation {...props} isStreaming={false} />);
    expect(screen.getByText(/Path: src\/settings.ts/)).toBeVisible();
    expect(screen.queryByRole("button", { name: /1 action · Read/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Agent thinking" })).not.toBeInTheDocument();

    // REST can populate the cache before the retained reducer slot is cleared.
    rerender(<ChatConversation {...props} isStreaming={false} messages={[turn]} />);
    expect(screen.getAllByText("Before")).toHaveLength(1);
    expect(screen.getByText(/Path: src\/settings.ts/)).toBeVisible();
    rerender(<ChatConversation {...props} isStreaming={false} messages={[turn]} currentTimeline={undefined} streamingMessageId={undefined} />);
    expect(screen.getByText(/Path: src\/settings.ts/)).toBeVisible();
  });

  it("keeps legacy messages in their previous aggregate layout", () => {
    render(<ChatMessage message={{ ...turn, timeline: undefined }} />);
    expect(screen.getByText("BeforeAfter")).toBeVisible();
    expect(screen.queryByRole("button", { name: /1 action/ })).not.toBeInTheDocument();
    before(screen.getByRole("button", { name: "Reasoning" }), screen.getByText("BeforeAfter"));
  });

  it("places questions and plans between action groups and resolves plan content across text boundaries", async () => {
    const message: Message = {
      ...turn,
      timeline: [
        { type: "tool", id: "write" }, { type: "text", id: "intro", text: "My proposal" },
        { type: "tool", id: "plan" }, { type: "tool", id: "question" }, { type: "tool", id: "test" },
      ],
      toolCalls: [
        { id: "write", name: "Write", input: JSON.stringify({ file_path: "/repo/.claude/plans/fix.md", content: "Implement the selected approach" }), output: "saved" },
        { id: "plan", name: "ExitPlanMode", input: "{}" },
        { id: "question", name: "AskUserQuestion", input: JSON.stringify({ questions: [{ question: "Which approach?", options: [{ label: "A" }] }] }) },
        turn.toolCalls![1],
      ],
    };
    render(<ChatMessage message={message} isInteractive />);
    expect(screen.getByText("Implement the selected approach")).toBeVisible();
    before(screen.getByText("My proposal"), screen.getByText("Proposed plan"));
    before(screen.getByText("Proposed plan"), screen.getByText("User input"));
    before(screen.getByText("User input"), screen.getAllByRole("button", { name: /1 action/ })[1]);
    expect(screen.queryByRole("button", { name: "Submit" })).not.toBeInTheDocument();
  });

  it("keeps child tool activity nested even when it arrives after intervening main-agent text", async () => {
    const user = userEvent.setup();
    const message: Message = {
      ...turn,
      timeline: [{ type: "tool", id: "parent" }, { type: "text", id: "after", text: "Meanwhile" }, { type: "tool", id: "child" }],
      toolCalls: [
        { id: "parent", name: "Task", input: JSON.stringify({ subagent_type: "Explore", description: "Review settings" }), output: "done" },
        { id: "child", parentToolUseId: "parent", name: "Read", input: '{"file_path":"src/settings.ts"}', output: "read" },
      ],
    };
    render(<ChatMessage message={message} />);
    expect(screen.getAllByRole("button", { name: /1 action/ })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: /1 action/ }));
    expect(screen.queryByText("settings.ts")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Explore.*Review settings/ }));
    before(screen.getByText("settings.ts"), screen.getByText("Meanwhile"));
  });

  it("groups consecutive tools and actions but keeps images and compaction at their position", async () => {
    const user = userEvent.setup();
    const message: Message = {
      ...turn,
      timeline: [
        { type: "tool", id: "read" }, { type: "activity", id: "command" },
        { type: "activity", id: "image" }, { type: "activity", id: "compaction" },
        { type: "tool", id: "test" },
      ],
      agentActivities: [
        { id: "command", kind: "command_execution", command: "pwd", status: "completed", output: "/repo" },
        { id: "image", kind: "image_view", path: "/repo/design.png", outsideWorkspace: true },
        { id: "compaction", kind: "context_compaction", status: "completed" },
      ],
    };
    render(<ChatMessage message={message} />);
    const firstGroup = screen.getByRole("button", { name: "2 actions" });
    before(firstGroup, screen.getByText("design.png"));
    before(screen.getByText("design.png"), screen.getByText("Context compacted"));
    before(screen.getByText("Context compacted"), screen.getByRole("button", { name: /1 action/ }));
    await user.click(firstGroup);
    before(screen.getByText("settings.ts"), screen.getByText("pwd"));
  });

  it("renders an activity alias once and keeps command failures visible while collapsed", async () => {
    const user = userEvent.setup();
    const message: Message = {
      ...turn, timeline: [{ type: "activity", id: "command" }],
      toolCalls: [{ id: "command", name: "Bash", input: '{"command":"false"}', output: "" }],
      agentActivities: [{ id: "command", kind: "command_execution", command: "false", exitCode: 1, status: "completed", output: "" }],
    };
    render(<ChatMessage message={message} />);
    expect(screen.getByLabelText("Action failed")).toBeVisible();
    await user.click(screen.getByRole("button", { name: /1 action/ }));
    expect(screen.getAllByRole("button", { name: /Bash.*false/ })).toHaveLength(1);
  });
});
