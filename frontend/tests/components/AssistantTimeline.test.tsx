import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import ChatConversation from "@/components/ChatConversation";
import ChatMessage from "@/components/ChatMessage";
import { AssistantTimeline } from "@/components/chat/AssistantTimeline";
import type { ChatMessage as Message, ToolCall } from "@/types";

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

const readTool: ToolCall = { id: "read", name: "Read", input: '{"file_path":"src/settings.ts"}', output: "read output" };
const testTool: ToolCall = { id: "test", name: "Bash", input: '{"command":"npm test"}', output: "test output", isError: true };

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
  reasoningSegments: [{ id: "thought:0", headline: "Weighing options", body: "Considering the result" }],
  toolCalls: [readTool, testTool],
  agentActivities: [{ id: "warning", kind: "diagnostic", severity: "warning", title: "Check configuration", message: "Configuration is incomplete" }],
};

const threeStepTurn: Message = {
  ...turn,
  timeline: [{ type: "tool", id: "read" }, { type: "tool", id: "edit" }, { type: "tool", id: "test" }],
  reasoningSegments: [],
  agentActivities: [],
  toolCalls: [
    readTool,
    { id: "edit", name: "Edit", input: '{"file_path":"src/app.ts","old_string":"a","new_string":"b\\nc"}', output: "edited" },
    testTool,
  ],
};

function before(first: Element, second: Element) {
  expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
}

/** Step lines start with the subject; run headers start with a verb or summary. */
const stepButton = (subject: string | RegExp) => screen.getByRole("button", { name: subject });

describe("AssistantTimeline", () => {
  it("keeps text, runs, reasoning and diagnostic steps in order", async () => {
    const user = userEvent.setup();
    render(<ChatMessage message={turn} />);
    await user.click(screen.getByRole("button", { name: /^2 tools used/ }));
    before(screen.getByText("Before"), stepButton(/^settings\.ts/));
    before(stepButton(/^settings\.ts/), stepButton(/^Weighing options/));
    before(stepButton(/^Weighing options/), screen.getByText("After"));
    before(screen.getByText("After"), stepButton(/^Check configuration/));
    before(stepButton(/^Check configuration/), stepButton(/^npm test/));
    expect(screen.getByLabelText("npm test failed")).toBeVisible();
    expect(screen.queryByText("Considering the result")).not.toBeInTheDocument();
  });

  it("renders a finished single-step run flat with the subject first and the verb pill after", () => {
    render(<AssistantTimeline message={{ ...turn, timeline: [{ type: "tool", id: "read" }] }} />);
    const line = stepButton(/^settings\.ts/);
    const subject = within(line).getByText("settings.ts");
    const pill = within(line).getByText("read");
    expect(subject.className).toContain("font-mono");
    before(subject, pill);
    expect(line).toHaveAccessibleName("settings.ts read read output");
    expect(screen.queryByTestId("live-line")).not.toBeInTheDocument();
  });

  it("separates subject, verb and stats in the accessible name", () => {
    render(<AssistantTimeline message={{ ...threeStepTurn, timeline: [{ type: "tool", id: "edit" }] }} />);
    expect(stepButton(/^app\.ts/)).toHaveAccessibleName("app.ts edited +2 \u22121");
  });

  it("collapses a finished run of three or more steps behind a verb summary", async () => {
    const user = userEvent.setup();
    render(<AssistantTimeline message={threeStepTurn} />);
    const header = screen.getByRole("button", { name: /3 tools used/ });
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByLabelText("1 failed")).toBeVisible();
    expect(screen.queryByRole("button", { name: /^settings\.ts/ })).not.toBeInTheDocument();
    await user.click(header);
    expect(header).toHaveAttribute("aria-expanded", "true");
    before(stepButton(/^settings\.ts/), stepButton(/^app\.ts/));
    before(stepButton(/^app\.ts/), stepButton(/^npm test/));
    expect(within(stepButton(/^app\.ts/)).getByText("+2")).toBeVisible();
    expect(within(stepButton(/^app\.ts/)).getByText("−1")).toBeVisible();
  });

  it("shows the running step as the live line and keeps a user expansion after the turn ends", async () => {
    const user = userEvent.setup();
    const live: Message = {
      ...threeStepTurn,
      toolCalls: threeStepTurn.toolCalls!.map((tool) => tool.id === "test" ? { ...tool, output: undefined, isError: undefined } : tool),
    };
    const { rerender } = render(<AssistantTimeline message={live} streaming />);
    const header = screen.getByTestId("live-line");
    expect(within(header).getByText("running")).toBeVisible();
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: /^settings\.ts/ })).not.toBeInTheDocument();
    await user.click(header);
    expect(stepButton(/^settings\.ts/)).toBeVisible();
    // The header owns the current step; it is not repeated at the end of the list.
    expect(screen.queryByRole("button", { name: /^npm test/ })).not.toBeInTheDocument();

    rerender(<AssistantTimeline message={threeStepTurn} streaming={false} />);
    expect(screen.queryByTestId("live-line")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /3 tools used/ })).toHaveAttribute("aria-expanded", "true");
    expect(stepButton(/^settings\.ts/)).toBeVisible();
    expect(screen.getByLabelText("1 failed")).toBeVisible();
  });

  it("shimmers only the live line, which owns the running step, never completed steps", async () => {
    const user = userEvent.setup();
    const live: Message = {
      ...threeStepTurn,
      toolCalls: threeStepTurn.toolCalls!.map((tool) => tool.id === "test" ? { ...tool, output: undefined, isError: undefined } : tool),
    };
    const { container, rerender } = render(<AssistantTimeline message={live} streaming />);
    expect(container.querySelectorAll(".step-live-text")).toHaveLength(1);
    await user.click(screen.getByTestId("live-line"));
    expect(container.querySelectorAll(".step-live-text")).toHaveLength(1);
    expect(stepButton(/^settings\.ts/).querySelector(".step-live-text")).toBeNull();
    expect(stepButton(/^app\.ts/).querySelector(".step-live-text")).toBeNull();
    expect(screen.queryByRole("button", { name: /^npm test/ })).not.toBeInTheDocument();

    rerender(<AssistantTimeline message={threeStepTurn} streaming={false} />);
    expect(container.querySelectorAll(".step-live-text")).toHaveLength(0);
  });

  it("keeps earlier runs of a streaming turn finished: only the last run is live", () => {
    const interleaved: Message = {
      ...threeStepTurn,
      timeline: [
        { type: "text", id: "a", text: "Before" }, { type: "tool", id: "read" }, { type: "tool", id: "edit" },
        { type: "text", id: "b", text: "After" }, { type: "tool", id: "test" },
      ],
      toolCalls: threeStepTurn.toolCalls!.map((tool) => tool.id === "test" ? { ...tool, output: undefined, isError: undefined } : tool),
    };
    const { container } = render(<AssistantTimeline message={interleaved} streaming />);
    const earlier = screen.getByRole("button", { name: /2 tools used/ });
    expect(earlier).not.toHaveAttribute("data-testid");
    expect(earlier.querySelector(".step-live-text")).toBeNull();
    expect(screen.getAllByTestId("live-line")).toHaveLength(1);
    expect(screen.getByTestId("live-line")).toHaveTextContent(/npm test/);
    expect(container.querySelectorAll(".step-live-text")).toHaveLength(1);
  });

  it("shows the latest step, failure mark included, as the live line without a counter", () => {
    render(<AssistantTimeline message={{ ...threeStepTurn, toolCalls: [readTool, testTool] }} streaming />);
    const header = screen.getByTestId("live-line");
    expect(header).toHaveTextContent(/^Current step: npm test ran/);
    expect(within(header).getByLabelText("npm test failed")).toBeVisible();
    expect(header).not.toHaveTextContent(/action/);
  });

  it("opens the detail panel on step click and closes it again", async () => {
    const user = userEvent.setup();
    render(<AssistantTimeline message={{ ...turn, timeline: [{ type: "tool", id: "read" }] }} />);
    expect(screen.queryByText(/Path: src\/settings.ts/)).not.toBeInTheDocument();
    await user.click(stepButton(/^settings\.ts/));
    expect(screen.getByText(/Path: src\/settings.ts/)).toBeVisible();
    expect(screen.getByText("Output")).toBeVisible();
    await user.click(stepButton(/^settings\.ts/));
    expect(screen.getByText(/Path: src\/settings.ts/)).not.toBeVisible();
  });

  it("opens reasoning details from the reasoning step", async () => {
    const user = userEvent.setup();
    render(<ChatMessage message={turn} />);
    await user.click(screen.getByRole("button", { name: /^2 tools used/ }));
    await user.click(stepButton(/^Weighing options/));
    expect(screen.getByText("Considering the result")).toBeVisible();
  });

  it("preserves opened run and step details through live completion and REST replacement", async () => {
    const user = userEvent.setup();
    const props = {
      messages: [] as Message[], isStreaming: true, currentStreamingText: turn.content,
      currentTimeline: turn.timeline, streamingMessageId: turn.id,
      currentReasoningSegments: turn.reasoningSegments!, activeToolCalls: turn.toolCalls!,
      activeAgentActivities: turn.agentActivities!, switchCounter: 0,
    };
    const { rerender } = render(<ChatConversation {...props} />);
    await user.click(screen.getByRole("button", { name: /2 tools used/ }));
    await user.click(stepButton(/^settings\.ts/));
    expect(screen.getByText(/Path: src\/settings.ts/)).toBeVisible();
    // Closing and reopening the run must retain the nested step toggle.
    await user.click(screen.getByRole("button", { name: /2 tools used/ }));
    expect(screen.getByText(/Path: src\/settings.ts/)).not.toBeVisible();
    await user.click(screen.getByRole("button", { name: /2 tools used/ }));
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
    await user.click(screen.getByRole("button", { name: /2 tools used/ }));
    expect(within(stepButton(/^settings\.ts/)).getByText("reading")).toBeVisible();
    await user.click(stepButton(/^settings\.ts/));
    expect(screen.getByText(/Path: src\/settings.ts/)).toBeVisible();

    // The done frame was missed. Idle status stops animations before REST returns.
    rerender(<ChatConversation {...props} isStreaming={false} />);
    expect(screen.getByText(/Path: src\/settings.ts/)).toBeVisible();
    expect(screen.queryByTestId("live-line")).not.toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Agent thinking" })).not.toBeInTheDocument();

    // REST can populate the cache before the retained reducer slot is cleared.
    rerender(<ChatConversation {...props} isStreaming={false} messages={[turn]} />);
    expect(screen.getAllByText("Before")).toHaveLength(1);
    expect(screen.getByText(/Path: src\/settings.ts/)).toBeVisible();
    rerender(<ChatConversation {...props} isStreaming={false} messages={[turn]} currentTimeline={undefined} streamingMessageId={undefined} />);
    expect(screen.getByText(/Path: src\/settings.ts/)).toBeVisible();
  });

  it("renders live content without a timeline through the same renderer", () => {
    render(
      <ChatConversation
        messages={[]} isStreaming currentStreamingText="Partial" streamingMessageId="live-1"
        currentReasoningSegments={[{ id: "r:0", headline: "Inspecting files" }]}
        activeToolCalls={[{ ...readTool, output: undefined }]} activeAgentActivities={[]} switchCounter={0}
      />,
    );
    before(stepButton(/Inspecting files/), screen.getByText("Partial"));
    before(screen.getByText("Partial"), screen.getByTestId("live-line"));
  });

  it("keeps legacy messages in reasoning, text, tools order", async () => {
    const user = userEvent.setup();
    render(<ChatMessage message={{ ...turn, timeline: undefined }} />);
    await user.click(screen.getByRole("button", { name: /^2 tools used/ }));
    before(stepButton(/^Weighing options/), screen.getByText("BeforeAfter"));
    before(screen.getByText("BeforeAfter"), stepButton(/^settings\.ts/));
    before(stepButton(/^settings\.ts/), stepButton(/^npm test/));
  });

  it("places questions and plans between runs and resolves plan content across text boundaries", () => {
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
        testTool,
      ],
    };
    render(<ChatMessage message={message} isInteractive />);
    expect(screen.getByText("Implement the selected approach")).toBeVisible();
    expect(screen.queryByRole("button", { name: /fix\.md/ })).not.toBeInTheDocument();
    before(screen.getByText("My proposal"), screen.getByText("Proposed plan"));
    before(screen.getByText("Proposed plan"), stepButton(/^Which approach\?/));
    before(stepButton(/^Which approach\?/), stepButton(/^npm test/));
    expect(screen.queryByRole("button", { name: "Submit" })).not.toBeInTheDocument();
  });

  it("keeps child tool activity out of the top-level rows even after intervening text", () => {
    const message: Message = {
      ...turn,
      timeline: [{ type: "tool", id: "parent" }, { type: "text", id: "after", text: "Meanwhile" }, { type: "tool", id: "child" }],
      toolCalls: [
        { id: "parent", name: "Task", input: JSON.stringify({ subagent_type: "Explore", description: "Review settings" }), output: "done" },
        { id: "child", parentToolUseId: "parent", name: "Read", input: '{"file_path":"src/settings.ts"}', output: "read" },
      ],
    };
    render(<ChatMessage message={message} />);
    expect(stepButton(/^Explore Review settings/)).toBeVisible();
    expect(screen.queryByText("settings.ts")).not.toBeInTheDocument();
    before(stepButton(/^Explore Review settings/), screen.getByText("Meanwhile"));
  });

  it("groups tools, images and compaction into one run in timeline order", async () => {
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
    await user.click(screen.getByRole("button", { name: /^5 tools used/ }));
    before(stepButton(/^settings\.ts/), stepButton(/^pwd/));
    before(stepButton(/^pwd/), stepButton(/^design\.png/));
    before(stepButton(/^design\.png/), stepButton(/^Context/));
    before(stepButton(/^Context/), stepButton(/^npm test/));
    expect(within(stepButton(/^Context/)).getByText("compacted")).toBeVisible();
    expect(stepButton(/^Context/)).not.toHaveAttribute("aria-expanded");
  });

  it("renders an activity alias once and keeps command failures visible", () => {
    const message: Message = {
      ...turn, timeline: [{ type: "activity", id: "command" }],
      toolCalls: [{ id: "command", name: "Bash", input: '{"command":"false"}', output: "" }],
      agentActivities: [{ id: "command", kind: "command_execution", command: "false", exitCode: 1, status: "completed", output: "" }],
    };
    render(<ChatMessage message={message} />);
    expect(screen.getAllByRole("button", { name: /^false/ })).toHaveLength(1);
    expect(screen.getByLabelText("false failed")).toBeVisible();
  });
});

describe("tool details", () => {
  const single = (tool: ToolCall): Message => ({ ...turn, timeline: [{ type: "tool", id: tool.id }], reasoningSegments: [], agentActivities: [], toolCalls: [tool] });

  it("renders the edit diff and hides the raw output for Claude and Codex edits", async () => {
    const user = userEvent.setup();
    const claude: ToolCall = { id: "edit", name: "Edit", input: '{"file_path":"src/app.ts","old_string":"before","new_string":"after"}', output: "this output must stay hidden" };
    const { unmount } = render(<AssistantTimeline message={single(claude)} />);
    await user.click(stepButton(/^app\.ts/));
    expect(screen.getByText("before")).toBeVisible();
    expect(screen.getByText("after")).toBeVisible();
    expect(screen.queryByText("Output")).not.toBeInTheDocument();
    expect(screen.queryByText("this output must stay hidden")).not.toBeInTheDocument();
    unmount();

    const codex: ToolCall = { id: "edit", name: "Edit", input: JSON.stringify({ filename: "src/app.ts", diff: "--- a/src/app.ts\n+++ b/src/app.ts\n@@\n-before\n+after" }), output: "raw diff" };
    render(<AssistantTimeline message={single(codex)} />);
    const line = stepButton(/^app\.ts/);
    expect(within(line).getByText("+1")).toBeVisible();
    await user.click(line);
    expect(screen.getByText("-before")).toBeVisible();
    expect(screen.getByText("+after")).toBeVisible();
    expect(screen.queryByText("Output")).not.toBeInTheDocument();
  });

  it("shows command, cwd, exit code and duration for a failed Bash tool", async () => {
    const user = userEvent.setup();
    const bash: ToolCall = { id: "bash", name: "Bash", input: JSON.stringify({ command: "npm test", description: "Run the suite", cwd: "/tmp/project", status: "failed", exitCode: 1, durationMs: 2400 }), output: "failed\n" };
    render(<AssistantTimeline message={single(bash)} />);
    expect(screen.getByLabelText("npm test failed")).toBeVisible();
    await user.click(stepButton(/^npm test/));
    expect(screen.getByText(/\$ npm test/)).toBeVisible();
    expect(screen.getByText(/Run the suite/)).toBeVisible();
    expect(screen.getByText(/cwd: \/tmp\/project/)).toBeVisible();
    expect(screen.getByText(/exit 1/)).toBeVisible();
    expect(screen.getByText(/2\.4s/)).toBeVisible();
    expect(screen.getByText("Output")).toBeVisible();
  });

  it("shows the streamed output of a Codex command activity", async () => {
    const user = userEvent.setup();
    const message: Message = {
      ...turn, timeline: [{ type: "activity", id: "cmd" }], reasoningSegments: [], toolCalls: [],
      agentActivities: [{ id: "cmd", kind: "command_execution", command: "npm test", cwd: "/tmp/project", status: "completed", output: "ok\n", exitCode: 0, durationMs: 1200 }],
    };
    render(<AssistantTimeline message={message} />);
    await user.click(stepButton(/^npm test/));
    expect(screen.getByText(/\$ npm test/)).toBeVisible();
    expect(screen.getByText(/cwd: \/tmp\/project/)).toBeVisible();
    expect(screen.getByText("Output").nextElementSibling).toHaveTextContent("ok");
  });

  it("shows the raw input and the output when the input is not JSON", async () => {
    const user = userEvent.setup();
    render(<AssistantTimeline message={single({ id: "bad", name: "Bash", input: "{not-json", output: "result" })} />);
    await user.click(stepButton(/^Bash/));
    expect(screen.getByText("{not-json")).toBeVisible();
    expect(screen.getByText("Output").nextElementSibling).toHaveTextContent("result");
  });
});
