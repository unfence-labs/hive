import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToolCallList } from "@/components/chat/ToolCallList";
import type { ToolCall } from "@/types";

function tool(overrides: Partial<ToolCall>): ToolCall {
  return {
    id: "tool-1",
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
    expect(screen.getByText("Running...")).toBeInTheDocument();
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

  it("renders AskUserQuestion and submits selected answer", async () => {
    const user = userEvent.setup();
    const onQuestionAnswer = vi.fn();
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
        onQuestionAnswer={onQuestionAnswer}
      />,
    );

    await user.click(screen.getByLabelText("Option B"));
    await user.click(screen.getByRole("button", { name: /submit/i }));

    expect(onQuestionAnswer).toHaveBeenCalledWith("ask-1", [
      {
        questionIndex: 0,
        selectedOptions: [1],
        customText: undefined,
      },
    ]);
  });
});
