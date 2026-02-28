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

  it("does not collapse during streaming (showExecutingState)", () => {
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

    // No summary — all tools shown individually
    expect(screen.queryByText(/tool call/)).not.toBeInTheDocument();
    expect(screen.getByText("Read")).toBeInTheDocument();
    expect(screen.getByText("Grep")).toBeInTheDocument();
    expect(screen.getByText("Edit")).toBeInTheDocument();
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

  it("counts only root tools in collapsed summary when sub-tools are nested under a Task", () => {
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

    expect(screen.getByText("1 subagent")).toBeInTheDocument();
    expect(screen.queryByText("2 tool calls, 1 subagent")).not.toBeInTheDocument();
  });

  // ── SubAgentCard rendering ──────────────────────────────────────────

  it("renders Task tools as SubAgentCard with agent type and children collapsed by default", async () => {
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

    // SubAgentCard header shows agent type
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

  it("renders nested SubAgentCards recursively", async () => {
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

  it("shows completed status badge on SubAgentCard when output exists", () => {
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
    expect(screen.getByText("Done")).toBeInTheDocument();
  });

  it("shows shimmer animation on SubAgentCard during streaming", () => {
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
});
