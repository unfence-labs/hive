import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ChatToolUse from "@/components/ChatToolUse";
import type { ToolCall } from "@/types";

function tool(overrides: Partial<ToolCall>): ToolCall {
  return {
    id: "tool-1",
    name: "Bash",
    input: "{}",
    output: "ok",
    ...overrides,
  };
}

describe("ChatToolUse", () => {
  it("shows fallback content when tool input is invalid JSON", async () => {
    const user = userEvent.setup();
    render(<ChatToolUse tool={tool({ input: "{not-json", output: "result" })} />);

    await user.click(screen.getByRole("button", { name: /bash/i }));

    expect(screen.getByText("{not-json")).toBeInTheDocument();
    expect(screen.getByText("Output")).toBeInTheDocument();
    expect(screen.getByText("result")).toBeInTheDocument();
  });

  it("renders inline edit diff and hides tool output for Edit", async () => {
    const user = userEvent.setup();
    render(
      <ChatToolUse
        tool={tool({
          name: "Edit",
          input: JSON.stringify({
            file_path: "src/app.ts",
            old_string: "before",
            new_string: "after",
          }),
          output: "this output must stay hidden",
        })}
      />,
    );

    await user.click(screen.getByRole("button", { name: /edit/i }));

    expect(screen.getByText("Path: src/app.ts")).toBeInTheDocument();
    expect(screen.getByText("before")).toBeInTheDocument();
    expect(screen.getByText("after")).toBeInTheDocument();
    expect(screen.queryByText("Output")).not.toBeInTheDocument();
    expect(
      screen.queryByText("this output must stay hidden"),
    ).not.toBeInTheDocument();
  });

  it("renders Codex unified diffs for Edit tools", async () => {
    const user = userEvent.setup();
    render(
      <ChatToolUse
        tool={tool({
          name: "Edit",
          input: JSON.stringify({
            filename: "src/app.ts",
            diff: "--- a/src/app.ts\n+++ b/src/app.ts\n@@\n-before\n+after",
          }),
          output: "--- a/src/app.ts\n+++ b/src/app.ts\n@@\n-before\n+after",
        })}
      />,
    );

    await user.click(screen.getByRole("button", { name: /edit/i }));

    expect(screen.getByText(/--- a\/src\/app\.ts/)).toBeInTheDocument();
    expect(screen.getByText("Path: src/app.ts")).toBeInTheDocument();
    expect(screen.getByText(/\+after/)).toHaveClass("text-green-400");
    expect(screen.getByText(/-before/)).toHaveClass("text-red-400");
    expect(screen.queryByText("Output")).not.toBeInTheDocument();
  });

  it("shows executing state and truncates long bash command in the summary", async () => {
    const user = userEvent.setup();
    const longCommand =
      "echo 123456789012345678901234567890123456789012345678901234";

    render(
      <ChatToolUse
        tool={tool({
          input: JSON.stringify({
            command: longCommand,
            description: "Run diagnostics",
          }),
        })}
        isExecuting
      />,
    );

    expect(
      screen.getByText(
        (text) => text.startsWith("echo 1234567890") && text.endsWith("..."),
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /bash/i }));
    expect(screen.getByText(/\$ echo 123456789012345678901234567890123456789012345678901234/)).toBeInTheDocument();
    expect(screen.getByText(/Run diagnostics/)).toBeInTheDocument();
  });

  it("renders bash exit metadata and failure indicator", async () => {
    const user = userEvent.setup();
    render(
      <ChatToolUse
        tool={tool({
          input: JSON.stringify({
            command: "npm test",
            cwd: "/tmp/project",
            status: "failed",
            exitCode: 1,
            durationMs: 2400,
          }),
          output: "failed\n",
        })}
      />,
    );

    expect(screen.getByText("Bash")).toBeInTheDocument();
    expect(screen.getByText("npm test")).toBeInTheDocument();
    expect(screen.queryByText("exit 1")).not.toBeInTheDocument();
    expect(screen.queryByText("2.4s")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Bash failed with exit code 1")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /bash/i }));

    expect(screen.getByText(/\$ npm test/)).toBeInTheDocument();
    expect(screen.getByText(/cwd: \/tmp\/project/)).toBeInTheDocument();
  });

  it("renders object output as JSON instead of crashing", async () => {
    const user = userEvent.setup();
    const objectOutput = { type: "text", text: "agent result" } as unknown as string;

    render(
      <ChatToolUse
        tool={tool({
          name: "Task",
          input: JSON.stringify({ subagent_type: "Explore", description: "search", prompt: "find files" }),
          output: objectOutput,
        })}
      />,
    );

    await user.click(screen.getByRole("button", { name: /task/i }));

    expect(screen.getByText("Output")).toBeInTheDocument();
    expect(screen.getByText(/"agent result"/)).toBeInTheDocument();
  });

  it("renders Task content blocks as formatted text output", async () => {
    const user = userEvent.setup();
    render(
      <ChatToolUse
        tool={tool({
          name: "Task",
          input: JSON.stringify({
            subagent_type: "Explore",
            description: "Inspect code",
            prompt: "Find issues",
          }),
          output: JSON.stringify([
            { type: "text", text: "First finding" },
            { type: "text", text: "Second finding" },
            { type: "image", url: "https://example.com/image.png" },
          ]),
        })}
      />,
    );

    await user.click(screen.getByRole("button", { name: /task/i }));

    expect(screen.getByText("Output")).toBeInTheDocument();
    expect(screen.getByText("First finding")).toBeInTheDocument();
    expect(screen.getByText("Second finding")).toBeInTheDocument();
  });

  it("renders TaskCreate with subject as detail badge", async () => {
    const user = userEvent.setup();
    render(
      <ChatToolUse
        tool={tool({
          name: "TaskCreate",
          input: JSON.stringify({ subject: "Fix login bug", description: "Auth fails on mobile" }),
          output: "Task #1 created successfully: Fix login bug",
        })}
      />,
    );

    expect(screen.getByText("TaskCreate")).toBeInTheDocument();
    expect(screen.getByText("Fix login bug")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /taskcreate/i }));
    expect(screen.getByText(/Auth fails on mobile/)).toBeInTheDocument();
  });

  it("renders TaskUpdate with task ID and status", async () => {
    render(
      <ChatToolUse
        tool={tool({
          name: "TaskUpdate",
          input: JSON.stringify({ taskId: "3", status: "in_progress" }),
          output: "Task #3 updated",
        })}
      />,
    );

    expect(screen.getByText("TaskUpdate")).toBeInTheDocument();
    expect(screen.getByText("#3 → in_progress")).toBeInTheDocument();
  });

  it("renders TaskList with static helper content", async () => {
    const user = userEvent.setup();
    render(
      <ChatToolUse
        tool={tool({
          name: "TaskList",
          input: "{}",
          output: "[]",
        })}
      />,
    );

    await user.click(screen.getByRole("button", { name: /tasklist/i }));
    expect(screen.getByText("Lists all active tasks")).toBeInTheDocument();
  });

  it("renders TaskGet fallback when taskId is missing", async () => {
    const user = userEvent.setup();
    render(
      <ChatToolUse
        tool={tool({
          name: "TaskGet",
          input: "{}",
        })}
      />,
    );

    await user.click(screen.getByRole("button", { name: /taskget/i }));
    expect(screen.getByText("No task ID specified")).toBeInTheDocument();
  });

  it("renders TaskGet detail when taskId is provided", () => {
    render(
      <ChatToolUse
        tool={tool({
          name: "TaskGet",
          input: JSON.stringify({ taskId: "9" }),
          output: "Task #9",
        })}
      />,
    );

    expect(screen.getByText("#9")).toBeInTheDocument();
  });

  it("delegates click handling when onClick is provided without toggling local expansion", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    render(
      <ChatToolUse
        tool={tool({
          name: "Read",
          input: JSON.stringify({ file_path: "src/main.ts" }),
          output: "file-content",
        })}
        onClick={onClick}
      />,
    );

    await user.click(screen.getByRole("button", { name: /read/i }));

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Path: src/main.ts")).not.toBeInTheDocument();
    expect(screen.queryByText("Output")).not.toBeInTheDocument();
  });
});
