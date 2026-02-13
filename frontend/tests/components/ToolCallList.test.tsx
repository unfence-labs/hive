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

  it("renders ExitPlanMode action and calls approval callback", async () => {
    const user = userEvent.setup();
    const onPlanApproval = vi.fn();

    render(
      <ToolCallList
        toolCalls={[tool({ name: "ExitPlanMode" })]}
        isInteractive
        onPlanApproval={onPlanApproval}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Approve Plan" }));

    expect(onPlanApproval).toHaveBeenCalledTimes(1);
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
    const onPlanApproval = vi.fn();
    render(
      <ToolCallList
        toolCalls={[
          tool({ name: "Read", input: JSON.stringify({ file_path: "/a.ts" }) }),
          tool({ name: "Grep", input: JSON.stringify({ pattern: "foo" }) }),
          tool({ name: "Bash", input: JSON.stringify({ command: "ls" }) }),
          tool({ name: "ExitPlanMode" }),
        ]}
        isInteractive
        onPlanApproval={onPlanApproval}
      />,
    );

    // Regular tools collapsed
    expect(screen.getByText("3 tool calls")).toBeInTheDocument();
    expect(screen.queryByText("Read")).not.toBeInTheDocument();

    // Interactive tool always visible
    expect(screen.getByRole("button", { name: "Approve Plan" })).toBeInTheDocument();
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

  it("keeps Task children and prompt collapsed by default, then reveals them on demand", async () => {
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

    expect(screen.queryByText("Read")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Prompt" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Task \(Explore\)/i }));

    expect(screen.getByText("Read")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Prompt" })).toBeInTheDocument();
    expect(screen.queryByText("Look into src/lib and summarize changes.")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Prompt" }));

    expect(screen.getByText("Look into src/lib and summarize changes.")).toBeInTheDocument();
  });

  it("renders nested Task trees recursively", async () => {
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

    expect(screen.getByRole("button", { name: /Task \(Explore\)/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Task \(Plan\)/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Task \(Explore\)/i }));

    expect(screen.getByRole("button", { name: /Task \(Plan\)/i })).toBeInTheDocument();
    expect(screen.queryByText("Bash")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Task \(Plan\)/i }));

    expect(screen.getByText("Bash")).toBeInTheDocument();
  });
});
