import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import QuestionPanel from "@/components/chat/QuestionPanel";
import type { PendingToolInput } from "@/hooks/useConversation";

function askInput(toolUseId: string, questions: unknown[]): PendingToolInput {
  return {
    requestId: `req-${toolUseId}`,
    toolName: "AskUserQuestion",
    toolUseId,
    input: { questions },
  };
}

describe("QuestionPanel", () => {
  it("returns null when there are no AskUserQuestion inputs", () => {
    const { container } = render(
      <QuestionPanel
        pendingToolInputs={[
          {
            requestId: "req-1",
            toolName: "ExitPlanMode",
            toolUseId: "tool-1",
            input: {},
          },
        ]}
        onBatchSubmit={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("groups and submits answered questions by toolUseId", async () => {
    const user = userEvent.setup();
    const onBatchSubmit = vi.fn();
    render(
      <QuestionPanel
        pendingToolInputs={[
          askInput("ask-1", [
            {
              question: "Pick one",
              options: [{ label: "A" }, { label: "B" }],
            },
            {
              question: "Pick many",
              multiSelect: true,
              options: [{ label: "One" }, { label: "Two" }],
            },
          ]),
          askInput("ask-2", [
            {
              question: "Anything else?",
              options: [],
            },
          ]),
        ]}
        onBatchSubmit={onBatchSubmit}
        onDismiss={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /2B/ }));
    await user.click(screen.getByRole("button", { name: "Next" }));

    await user.click(screen.getByRole("button", { name: /One/ }));
    await user.click(screen.getByRole("button", { name: /Two/ }));
    await user.type(screen.getByPlaceholderText("Type something..."), "  extra choice  ");
    await user.click(screen.getByRole("button", { name: "Next" }));

    await user.type(screen.getByPlaceholderText("Type something..."), "  custom note  ");
    await user.click(screen.getByRole("button", { name: "Submit (3/3)" }));

    expect(onBatchSubmit).toHaveBeenCalledTimes(1);
    expect(onBatchSubmit).toHaveBeenCalledWith([
      {
        toolUseId: "ask-1",
        answers: [
          { questionIndex: 0, selectedOptions: [1], customText: undefined },
          { questionIndex: 1, selectedOptions: [0, 1], customText: "extra choice" },
        ],
      },
      {
        toolUseId: "ask-2",
        answers: [
          { questionIndex: 0, selectedOptions: [], customText: "custom note" },
        ],
      },
    ]);
  });

  it("keeps submit disabled until at least one non-empty answer exists", async () => {
    const user = userEvent.setup();
    render(
      <QuestionPanel
        pendingToolInputs={[
          askInput("ask-1", [{ question: "Comment", options: [] }]),
        ]}
        onBatchSubmit={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    const submit = screen.getByRole("button", { name: "Submit" });
    expect(submit).toBeDisabled();

    await user.type(screen.getByPlaceholderText("Type something..."), "   ");
    expect(submit).toBeDisabled();

    await user.type(screen.getByPlaceholderText("Type something..."), "ok");
    expect(submit).toBeEnabled();
  });

  it("calls dismiss handler", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(
      <QuestionPanel
        pendingToolInputs={[
          askInput("ask-1", [{ question: "Pick one", options: [{ label: "A" }] }]),
        ]}
        onBatchSubmit={vi.fn()}
        onDismiss={onDismiss}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Dismiss questions" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
