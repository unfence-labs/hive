import { describe, expect, it } from "vitest";
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
    expect(screen.getByText("Result")).toBeInTheDocument();
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
    expect(screen.queryByText("Result")).not.toBeInTheDocument();
    expect(
      screen.queryByText("this output must stay hidden"),
    ).not.toBeInTheDocument();
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

    expect(screen.getByText("Result")).toBeInTheDocument();
    expect(screen.getByText(/"agent result"/)).toBeInTheDocument();
  });
});
