import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToolCallList } from "@/components/chat/ToolCallList";
import type { ToolCall } from "@/types";

let nextId = 0;
function tool(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    id: `tool-${++nextId}`,
    name: "Bash",
    input: "{}",
    ...overrides,
  };
}

describe("ToolCallList", () => {
  it("returns null when there are no tool calls", () => {
    const { container } = render(<ToolCallList toolCalls={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders generic tool usage with executing state", () => {
    render(
      <ToolCallList
        toolCalls={[tool({ name: "Bash", output: undefined })]}
        showExecutingState
      />,
    );

    expect(screen.getByText("Bash")).toBeInTheDocument();
  });

  it("renders ExitPlanMode as PlanProposal with inline tool-style header", async () => {
    const user = userEvent.setup();

    render(
      <ToolCallList
        toolCalls={[tool({ name: "ExitPlanMode", input: JSON.stringify({ plan: "Test plan content" }) })]}
        isInteractive
      />,
    );

    expect(screen.getByText("Proposed plan")).toBeInTheDocument();
    // Action buttons are no longer inside PlanProposal (moved to PlanActionBar above ChatInput)
    expect(screen.queryByRole("button", { name: "Accept" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hand off" })).not.toBeInTheDocument();

    // Interactive plan starts expanded — content visible immediately
    expect(screen.getByText("Test plan content")).toBeInTheDocument();

    // Click to collapse
    await user.click(screen.getByText("Proposed plan"));
    expect(screen.queryByText("Test plan content")).not.toBeInTheDocument();
  });

  it("renders PlanProposal header even when ExitPlanMode has no plan content", () => {
    render(
      <ToolCallList
        toolCalls={[tool({ name: "ExitPlanMode", input: "{}" })]}
        isInteractive
      />,
    );

    expect(screen.getByText("Proposed plan")).toBeInTheDocument();
    // No action buttons in inline view
    expect(screen.queryByRole("button", { name: "Accept" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hand off" })).not.toBeInTheDocument();
  });

  it("falls back to the last markdown Write tool when plan content is not in .claude/plans", () => {
    render(
      <ToolCallList
        toolCalls={[
          tool({
            id: "write-plan-md",
            name: "Write",
            input: JSON.stringify({
              file_path: "docs/plan.md",
              content: "## Plan from markdown file",
            }),
          }),
          tool({ name: "ExitPlanMode", input: "{}" }),
        ]}
        isInteractive
      />,
    );

    expect(screen.getByText("Plan from markdown file")).toBeInTheDocument();
    expect(screen.queryByText("Write")).not.toBeInTheDocument();
  });

  it("uses the last markdown Write tool when multiple markdown writes exist", () => {
    render(
      <ToolCallList
        toolCalls={[
          tool({
            id: "write-old",
            name: "Write",
            input: JSON.stringify({
              file_path: "docs/plan.md",
              content: "Old plan",
            }),
          }),
          tool({
            id: "write-new",
            name: "Write",
            input: JSON.stringify({
              file_path: "docs/plan.md",
              content: "New plan",
            }),
          }),
          tool({ name: "ExitPlanMode", input: "{}" }),
        ]}
        isInteractive
      />,
    );

    expect(screen.getByText("New plan")).toBeInTheDocument();
    expect(screen.queryByText("Old plan")).not.toBeInTheDocument();
  });

  it("renders AskUserQuestion as awaiting-response indicator in interactive mode", () => {
    const askTool = tool({
      id: "ask-1",
      name: "AskUserQuestion",
      input: JSON.stringify({
        questions: [
          {
            question: "Choose one",
            multiSelect: true,
            options: [
              { label: "Option A" },
              { label: "Option B" },
            ],
          },
        ],
      }),
    });

    render(
      <ToolCallList
        toolCalls={[askTool]}
        isInteractive
      />,
    );

    expect(screen.getByText("User input")).toBeInTheDocument();
    expect(screen.getByText("AWAITING RESPONSE")).toBeInTheDocument();
    expect(screen.queryByText("Choose one")).not.toBeInTheDocument();
  });

  // ── Collapse / Expand ────────────────────────────────────────────────

  it("shows tools individually when fewer than 3", () => {
    render(
      <ToolCallList
        toolCalls={[
          tool({ name: "Read", input: JSON.stringify({ file_path: "/a.ts" }) }),
          tool({ name: "Edit", input: JSON.stringify({ file_path: "/b.ts", old_string: "x", new_string: "y" }) }),
        ]}
      />,
    );

    expect(screen.getByText("Read")).toBeInTheDocument();
    expect(screen.getByText("Edit")).toBeInTheDocument();
    expect(screen.queryByText(/tool call/)).not.toBeInTheDocument();
  });

  it("collapses 3+ tools into summary and expands on click", async () => {
    const user = userEvent.setup();
    render(
      <ToolCallList
        toolCalls={[
          tool({ name: "Read", input: JSON.stringify({ file_path: "/a.ts" }) }),
          tool({ name: "Grep", input: JSON.stringify({ pattern: "foo" }) }),
          tool({ name: "Edit", input: JSON.stringify({ file_path: "/b.ts", old_string: "x", new_string: "y" }) }),
        ]}
      />,
    );

    // Collapsed: summary visible, individual tools hidden
    expect(screen.getByText("3 tool calls")).toBeInTheDocument();
    expect(screen.queryByText("Read")).not.toBeInTheDocument();
    expect(screen.queryByText("Grep")).not.toBeInTheDocument();
    expect(screen.queryByText("Edit")).not.toBeInTheDocument();

    // Expand
    await user.click(screen.getByText("3 tool calls"));

    expect(screen.getByText("Read")).toBeInTheDocument();
    expect(screen.getByText("Grep")).toBeInTheDocument();
    expect(screen.getByText("Edit")).toBeInTheDocument();

    // Collapse again
    await user.click(screen.getByText("3 tool calls"));

    expect(screen.queryByText("Read")).not.toBeInTheDocument();
  });

  it("separates subagent count in summary label", () => {
    render(
      <ToolCallList
        toolCalls={[
          tool({ name: "Read", input: JSON.stringify({ file_path: "/a.ts" }) }),
          tool({ name: "Task", input: JSON.stringify({ subagent_type: "Explore", description: "search", prompt: "find files" }) }),
          tool({ name: "Task", input: JSON.stringify({ subagent_type: "Plan", description: "plan", prompt: "design" }) }),
          tool({ name: "Edit", input: JSON.stringify({ file_path: "/b.ts", old_string: "x", new_string: "y" }) }),
        ]}
      />,
    );

    expect(screen.getByText("2 tool calls, 2 subagents")).toBeInTheDocument();
  });

  it("shows only subagent count when all tools are Task", () => {
    render(
      <ToolCallList
        toolCalls={[
          tool({ name: "Task", input: JSON.stringify({ subagent_type: "Explore", description: "a", prompt: "a" }) }),
          tool({ name: "Task", input: JSON.stringify({ subagent_type: "Plan", description: "b", prompt: "b" }) }),
          tool({ name: "Task", input: JSON.stringify({ subagent_type: "Bash", description: "c", prompt: "c" }) }),
        ]}
      />,
    );

    expect(screen.getByText("3 subagents")).toBeInTheDocument();
  });

  it("collapses during streaming when threshold is reached", () => {
    render(
      <ToolCallList
        toolCalls={[
          tool({ name: "Read", output: "done" }),
          tool({ name: "Grep", output: "done" }),
          tool({ name: "Edit", output: undefined }),
        ]}
        showExecutingState
      />,
    );

    const summary = screen.getByRole("button", { name: /3 tool calls/ });
    expect(summary).toBeInTheDocument();
    expect(summary.querySelector(".animate-pulse")).toBeTruthy();
    expect(screen.queryByText("Read")).not.toBeInTheDocument();
    expect(screen.queryByText("Grep")).not.toBeInTheDocument();
    expect(screen.queryByText("Edit")).not.toBeInTheDocument();
  });

  it("always shows interactive tools even when collapsed", () => {
    render(
      <ToolCallList
        toolCalls={[
          tool({ name: "Read", input: JSON.stringify({ file_path: "/a.ts" }) }),
          tool({ name: "Grep", input: JSON.stringify({ pattern: "foo" }) }),
          tool({ name: "Bash", input: JSON.stringify({ command: "ls" }) }),
          tool({ name: "ExitPlanMode", input: JSON.stringify({ plan: "Test plan" }) }),
        ]}
        isInteractive
      />,
    );

    // Regular tools collapsed
    expect(screen.getByText("3 tool calls")).toBeInTheDocument();
    expect(screen.queryByText("Read")).not.toBeInTheDocument();

    // PlanProposal always visible (inline tool header)
    expect(screen.getByText("Proposed plan")).toBeInTheDocument();
  });

  it("handles singular tool call label", () => {
    // 2 Task + 1 regular = "1 tool call, 2 subagents"
    render(
      <ToolCallList
        toolCalls={[
          tool({ name: "Bash", input: JSON.stringify({ command: "ls" }) }),
          tool({ name: "Task", input: JSON.stringify({ subagent_type: "Explore", description: "a", prompt: "a" }) }),
          tool({ name: "Task", input: JSON.stringify({ subagent_type: "Plan", description: "b", prompt: "b" }) }),
        ]}
      />,
    );

    expect(screen.getByText("1 tool call, 2 subagents")).toBeInTheDocument();
  });

  it("does not collapse when only child tools reach the threshold", () => {
    render(
      <ToolCallList
        toolCalls={[
          tool({
            id: "task-root",
            name: "Task",
            input: JSON.stringify({ subagent_type: "Explore", prompt: "Inspect the repo" }),
          }),
          tool({
            id: "child-read",
            name: "Read",
            parentToolUseId: "task-root",
            input: JSON.stringify({ file_path: "/a.ts" }),
          }),
          tool({
            id: "child-grep",
            name: "Grep",
            parentToolUseId: "task-root",
            input: JSON.stringify({ pattern: "TODO" }),
          }),
        ]}
      />,
    );

    expect(screen.getByText("Explore")).toBeInTheDocument();
    expect(screen.queryByText("1 subagent")).not.toBeInTheDocument();
    expect(screen.queryByText("Read")).not.toBeInTheDocument();
    expect(screen.queryByText("Grep")).not.toBeInTheDocument();
    expect(screen.queryByText("2 tool calls, 1 subagent")).not.toBeInTheDocument();
  });

  // ── SubAgentNode rendering ──────────────────────────────────────────

  it("renders Task tools as SubAgentNode with agent type and children collapsed by default", async () => {
    const user = userEvent.setup();
    render(
      <ToolCallList
        toolCalls={[
          tool({
            id: "task-root",
            name: "Task",
            input: JSON.stringify({
              subagent_type: "Explore",
              description: "Scan files",
              prompt: "Look into src/lib and summarize changes.",
            }),
          }),
          tool({
            id: "child-read",
            name: "Read",
            parentToolUseId: "task-root",
            input: JSON.stringify({ file_path: "/src/lib/index.ts" }),
          }),
        ]}
      />,
    );

    // SubAgentNode header shows agent type
    expect(screen.getByText("Explore")).toBeInTheDocument();
    expect(screen.getByText("Scan files")).toBeInTheDocument();

    // Children collapsed by default
    expect(screen.queryByText("Read")).not.toBeInTheDocument();
    expect(screen.queryByText("Prompt")).not.toBeInTheDocument();

    // Click header to expand
    await user.click(screen.getByText("Explore"));

    // Children and Prompt now visible
    expect(screen.getByText("Read")).toBeInTheDocument();
    expect(screen.getByText("Prompt")).toBeInTheDocument();
    expect(screen.queryByText("Look into src/lib and summarize changes.")).not.toBeInTheDocument();

    // Toggle prompt
    await user.click(screen.getByText("Prompt"));
    expect(screen.getByText("Look into src/lib and summarize changes.")).toBeInTheDocument();
  });

  it("renders nested SubAgentNodes recursively", async () => {
    const user = userEvent.setup();
    render(
      <ToolCallList
        showExecutingState
        toolCalls={[
          tool({
            id: "task-root",
            name: "Task",
            input: JSON.stringify({ subagent_type: "Explore", prompt: "Root prompt" }),
          }),
          tool({
            id: "task-child",
            name: "Task",
            parentToolUseId: "task-root",
            input: JSON.stringify({ subagent_type: "Plan", prompt: "Child prompt" }),
          }),
          tool({
            id: "bash-grandchild",
            name: "Bash",
            parentToolUseId: "task-child",
            input: JSON.stringify({ command: "ls -la" }),
          }),
        ]}
      />,
    );

    // Root card visible with agent type
    expect(screen.getByText("Explore")).toBeInTheDocument();
    // Nested card not visible yet
    expect(screen.queryByText("Plan")).not.toBeInTheDocument();

    // Expand root card — nested Plan card visible (with Bash in its peek row since Plan is running)
    await user.click(screen.getByText("Explore"));
    expect(screen.getByText("Plan")).toBeInTheDocument();

    // Expand nested card — Bash is now in the expanded body (may also be in peek row)
    await user.click(screen.getByText("Plan"));
    expect(screen.getByText("Bash")).toBeInTheDocument();
  });

  it("shows completed status badge on SubAgentNode when output exists", () => {
    render(
      <ToolCallList
        toolCalls={[
          tool({
            id: "task-done",
            name: "Task",
            input: JSON.stringify({ subagent_type: "Explore", description: "Search" }),
            output: "Found 5 files",
          }),
        ]}
      />,
    );

    expect(screen.getByText("Explore")).toBeInTheDocument();
    // Completed state shows a checkmark SVG (no "Done" text)
    const btn = screen.getByRole("button", { name: /Explore/i });
    const checkmark = btn.querySelector("svg polyline[points='20 6 9 17 4 12']");
    expect(checkmark).toBeTruthy();
  });

  it("shows shimmer animation on SubAgentNode during streaming", () => {
    render(
      <ToolCallList
        showExecutingState
        toolCalls={[
          tool({
            id: "task-running",
            name: "Task",
            input: JSON.stringify({ subagent_type: "Explore", description: "Searching" }),
            output: undefined,
          }),
        ]}
      />,
    );

    expect(screen.getByText("Explore")).toBeInTheDocument();
    expect(screen.getByText("Searching")).toBeInTheDocument();
    // Running state uses shimmer animation on the button (same as other executing tools)
    const btn = screen.getByRole("button", { name: /Explore/i });
    expect(btn).toHaveClass("animate-shimmer");
  });

  it("keeps Codex spawn sub-agents running when receiver state is still running", () => {
    render(
      <ToolCallList
        showExecutingState
        toolCalls={[
          tool({
            id: "codex-agent-running",
            name: "Agent",
            input: JSON.stringify({
              subagent_type: "Agent",
              description: "Inspect auth",
              run_in_background: true,
              tool: "spawnAgent",
              status: "inProgress",
            }),
            output: JSON.stringify([{
              type: "text",
              text: JSON.stringify({
                tool: "spawnAgent",
                status: "completed",
                agentsStates: {
                  "thread-child": { status: "running" },
                },
              }),
            }]),
          }),
        ]}
      />,
    );

    const btn = screen.getByRole("button", { name: /Agent/i });
    expect(btn).toHaveClass("animate-shimmer");
    expect(btn.querySelector("svg polyline[points='20 6 9 17 4 12']")).toBeNull();
  });

  it("shows failed Codex sub-agent output when expanded", async () => {
    const user = userEvent.setup();
    render(
      <ToolCallList
        showExecutingState
        toolCalls={[
          tool({
            id: "codex-agent-failed",
            name: "Agent",
            input: JSON.stringify({
              subagent_type: "Agent",
              description: "Inspect auth",
              run_in_background: true,
              tool: "spawnAgent",
              status: "inProgress",
            }),
            output: JSON.stringify([{
              type: "text",
              text: JSON.stringify({
                tool: "spawnAgent",
                status: "completed",
                agentsStates: {
                  "thread-child": { status: "errored", message: "Rate limited" },
                },
              }),
            }]),
          }),
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Agent/i }));

    expect(screen.getByText("Failure")).toBeInTheDocument();
    expect(screen.getByText(/Rate limited/)).toBeInTheDocument();
  });

  it("does not shimmer SubAgentNode when showExecutingState is false", () => {
    render(
      <ToolCallList
        toolCalls={[
          tool({
            id: "task-no-output",
            name: "Task",
            input: JSON.stringify({ subagent_type: "Explore", description: "Pending" }),
            output: undefined,
          }),
        ]}
      />,
    );

    const btn = screen.getByRole("button", { name: /Explore/i });
    expect(btn).not.toHaveClass("animate-shimmer");
  });

  it("shows tool count badge on completed SubAgentNode with children", async () => {
    const user = userEvent.setup();
    render(
      <ToolCallList
        toolCalls={[
          tool({
            id: "task-parent",
            name: "Task",
            input: JSON.stringify({ subagent_type: "Explore", description: "Search" }),
            output: "Found stuff",
          }),
          tool({ id: "c1", name: "Read", input: "{}", parentToolUseId: "task-parent", output: "ok" }),
          tool({ id: "c2", name: "Grep", input: "{}", parentToolUseId: "task-parent", output: "ok" }),
          tool({ id: "c3", name: "Edit", input: "{}", parentToolUseId: "task-parent", output: "ok" }),
        ]}
      />,
    );

    // Completed state shows checkmark SVG (no "Done" text)
    const btn = screen.getByRole("button", { name: /Explore/i });
    const checkmark = btn.querySelector("svg polyline[points='20 6 9 17 4 12']");
    expect(checkmark).toBeTruthy();
    const toolCount = screen.getByText(/3 tools/);
    expect(toolCount).toBeInTheDocument();
    expect(toolCount).toHaveClass("shrink-0", "whitespace-nowrap");
  });

  it("shows singular tool count on SubAgentNode with one child", () => {
    render(
      <ToolCallList
        toolCalls={[
          tool({
            id: "task-one",
            name: "Task",
            input: JSON.stringify({ subagent_type: "Plan", description: "Design" }),
            output: "Result",
          }),
          tool({ id: "c1", name: "Read", input: "{}", parentToolUseId: "task-one", output: "ok" }),
        ]}
      />,
    );

    // 2 tools: below collapse threshold, shown directly
    expect(screen.getByText(/· 1 tool$/)).toBeInTheDocument();
  });

  it("does not show tool count on running SubAgentNode even with children", () => {
    render(
      <ToolCallList
        showExecutingState
        toolCalls={[
          tool({
            id: "task-running-children",
            name: "Task",
            input: JSON.stringify({ subagent_type: "Explore", description: "Working" }),
            output: undefined,
          }),
          tool({ id: "c1", name: "Read", input: "{}", parentToolUseId: "task-running-children" }),
        ]}
      />,
    );

    // Running state shows pulse dot, not tool count
    expect(screen.queryByText(/· \d+ tools?$/)).not.toBeInTheDocument();
  });

  it("SubAgentNode shows result footer when expanded and done", async () => {
    const user = userEvent.setup();
    render(
      <ToolCallList
        toolCalls={[
          tool({
            id: "task-result",
            name: "Task",
            input: JSON.stringify({ subagent_type: "Explore", description: "Search" }),
            output: "The answer is 42",
          }),
        ]}
      />,
    );

    // Expand the card
    await user.click(screen.getByText("Explore"));

    // Result footer visible
    expect(screen.getByText("Result")).toBeInTheDocument();
    expect(screen.getByText("The answer is 42")).toBeInTheDocument();
  });

  it("SubAgentNode does not show an empty result footer", async () => {
    const user = userEvent.setup();
    render(
      <ToolCallList
        toolCalls={[
          tool({
            id: "task-empty-result",
            name: "Task",
            input: JSON.stringify({ subagent_type: "Explore", description: "Search" }),
            output: "",
          }),
        ]}
      />,
    );

    await user.click(screen.getByText("Explore"));

    expect(screen.queryByText("Result")).not.toBeInTheDocument();
  });

  it("SubAgentNode parses content blocks in output for result footer", async () => {
    const user = userEvent.setup();
    const contentBlocks = JSON.stringify([
      { type: "text", text: "Found the files." },
      { type: "text", text: "Analysis complete." },
    ]);
    render(
      <ToolCallList
        toolCalls={[
          tool({
            id: "task-blocks",
            name: "Task",
            input: JSON.stringify({ subagent_type: "Explore", description: "Analyze" }),
            output: contentBlocks,
          }),
        ]}
      />,
    );

    await user.click(screen.getByText("Explore"));
    expect(screen.getByText("Result")).toBeInTheDocument();
    // Content blocks parsed and rendered via MessageResponse
    expect(screen.getByText(/Found the files/)).toBeInTheDocument();
    expect(screen.getByText(/Analysis complete/)).toBeInTheDocument();
  });

  it("SubAgentNode falls back to raw output when content blocks parse fails", async () => {
    const user = userEvent.setup();
    render(
      <ToolCallList
        toolCalls={[
          tool({
            id: "task-raw",
            name: "Task",
            input: JSON.stringify({ subagent_type: "Explore", description: "Scan" }),
            output: "Just plain text",
          }),
        ]}
      />,
    );

    await user.click(screen.getByText("Explore"));
    expect(screen.getByText("Just plain text")).toBeInTheDocument();
  });

  it("SubAgentNode does not show prompt button when no prompt", async () => {
    const user = userEvent.setup();
    render(
      <ToolCallList
        toolCalls={[
          tool({
            id: "task-no-prompt",
            name: "Task",
            input: JSON.stringify({ subagent_type: "Explore", description: "No prompt" }),
          }),
        ]}
      />,
    );

    await user.click(screen.getByText("Explore"));
    expect(screen.queryByText("Prompt")).not.toBeInTheDocument();
  });

  it("SubAgentNode defaults to 'Agent' when subagent_type is missing", () => {
    render(
      <ToolCallList
        toolCalls={[
          tool({
            id: "task-default",
            name: "Task",
            input: JSON.stringify({ description: "Generic agent" }),
          }),
        ]}
      />,
    );

    expect(screen.getByText("Agent")).toBeInTheDocument();
    expect(screen.getByText("Generic agent")).toBeInTheDocument();
  });

  it("falls back to generic ChatToolUse when Task has malformed JSON", () => {
    render(
      <ToolCallList
        toolCalls={[
          tool({
            id: "task-bad",
            name: "Task",
            input: "not json at all",
          }),
        ]}
      />,
    );

    // Should still render something (generic tool use fallback)
    expect(screen.getByText("Task")).toBeInTheDocument();
  });

  it("TaskNodeFallback renders for non-Task tools with children", async () => {
    const user = userEvent.setup();
    render(
      <ToolCallList
        toolCalls={[
          tool({ id: "parent-bash", name: "Bash", input: '{"command":"ls"}', output: "ok" }),
          tool({ id: "child-read", name: "Read", input: '{"file_path":"/a"}', parentToolUseId: "parent-bash", output: "file content" }),
        ]}
      />,
    );

    // Parent rendered as ChatToolUse
    expect(screen.getByText("Bash")).toBeInTheDocument();
    // Child hidden initially
    expect(screen.queryByText("Read")).not.toBeInTheDocument();

    // Click to expand
    await user.click(screen.getByText("Bash"));
    expect(screen.getByText("Read")).toBeInTheDocument();
  });

  it("filters out TaskUpdate tools from display", () => {
    render(
      <ToolCallList
        toolCalls={[
          tool({ name: "Read", input: '{"file_path":"/a"}', output: "ok" }),
          tool({ name: "TaskUpdate", input: '{"taskId":"1","status":"completed"}', output: "ok" }),
        ]}
      />,
    );

    expect(screen.getByText("Read")).toBeInTheDocument();
    expect(screen.queryByText("TaskUpdate")).not.toBeInTheDocument();
  });

  it("SubAgentNode description shown as code element", () => {
    render(
      <ToolCallList
        toolCalls={[
          tool({
            id: "task-desc",
            name: "Task",
            input: JSON.stringify({ subagent_type: "Explore", description: "My description" }),
          }),
        ]}
      />,
    );

    const codeEl = screen.getByText("My description");
    expect(codeEl.tagName).toBe("CODE");
  });

  it("SubAgentNode hides description when empty", () => {
    render(
      <ToolCallList
        toolCalls={[
          tool({
            id: "task-no-desc",
            name: "Task",
            input: JSON.stringify({ subagent_type: "Explore", description: "" }),
          }),
        ]}
      />,
    );

    // No code element should be rendered for empty description
    const buttons = screen.getAllByRole("button");
    const agentBtn = buttons.find(b => b.textContent?.includes("Explore"));
    expect(agentBtn).toBeDefined();
    const codeEls = agentBtn!.querySelectorAll("code");
    expect(codeEls).toHaveLength(0);
  });
});
