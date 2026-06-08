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

  it("shows option descriptions below their labels", () => {
    render(
      <QuestionPanel
        pendingToolInputs={[
          askInput("ask-1", [
            {
              question: "Choose an implementation",
              options: [
                {
                  label: "Fast path",
                  description: "Use the existing component and keep the change local.",
                },
                {
                  label: "Larger refactor",
                  description: "Move shared rendering into a reusable helper first.",
                },
              ],
            },
          ]),
        ]}
        onBatchSubmit={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.getByText("Choose an implementation")).toBeInTheDocument();
    expect(screen.getByText("Fast path")).toBeInTheDocument();
    expect(
      screen.getByText("Use the existing component and keep the change local."),
    ).toBeInTheDocument();
    expect(screen.getByText("Larger refactor")).toBeInTheDocument();
    expect(screen.getByText("Move shared rendering into a reusable helper first.")).toBeInTheDocument();
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

    // Q1: pick option B
    await user.click(screen.getByRole("button", { name: /B/ }));
    // Navigate to Q2 via pagination dot
    await user.click(screen.getByRole("button", { name: "Question 2" }));

    // Q2: type custom text (in multi-select, typing clears any selected options)
    await user.type(screen.getByPlaceholderText("Type something..."), "extra choice");
    // Navigate to Q3 via pagination dot
    await user.click(screen.getByRole("button", { name: "Question 3" }));

    // Q3: type custom text
    await user.type(screen.getByPlaceholderText("Type something..."), "custom note");
    await user.click(screen.getByRole("button", { name: "Submit (3/3)" }));

    expect(onBatchSubmit).toHaveBeenCalledTimes(1);
    expect(onBatchSubmit).toHaveBeenCalledWith([
      {
        toolUseId: "ask-1",
        answers: [
          { questionIndex: 0, selectedOptions: [1], customText: undefined },
          { questionIndex: 1, selectedOptions: [], customText: "extra choice" },
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

  it("requires every question to be answered before submitting a multi-question block", async () => {
    const user = userEvent.setup();
    const onBatchSubmit = vi.fn();
    render(
      <QuestionPanel
        pendingToolInputs={[
          askInput("ask-1", [
            { question: "First question", options: [] },
            { question: "Second question", options: [] },
          ]),
        ]}
        onBatchSubmit={onBatchSubmit}
        onDismiss={vi.fn()}
      />,
    );

    await user.type(screen.getByPlaceholderText("Type something..."), "first answer");

    const partialSubmit = screen.getByRole("button", { name: "Submit (1/2)" });
    expect(partialSubmit).toBeDisabled();

    await user.keyboard("{Enter}");
    expect(onBatchSubmit).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Question 2" }));
    await user.type(screen.getByPlaceholderText("Type something..."), "second answer");
    await user.click(screen.getByRole("button", { name: "Submit (2/2)" }));

    expect(onBatchSubmit).toHaveBeenCalledWith([
      {
        toolUseId: "ask-1",
        answers: [
          { questionIndex: 0, selectedOptions: [], customText: "first answer" },
          { questionIndex: 1, selectedOptions: [], customText: "second answer" },
        ],
      },
    ]);
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

  it("typing custom text deselects options", async () => {
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
          ]),
        ]}
        onBatchSubmit={onBatchSubmit}
        onDismiss={vi.fn()}
      />,
    );

    // Select option A
    await user.click(screen.getByRole("button", { name: /A/ }));
    // Type custom text — should deselect option A
    await user.type(screen.getByPlaceholderText("Type something..."), "my answer");
    await user.click(screen.getByRole("button", { name: "Submit" }));

    expect(onBatchSubmit).toHaveBeenCalledWith([
      {
        toolUseId: "ask-1",
        answers: [
          { questionIndex: 0, selectedOptions: [], customText: "my answer" },
        ],
      },
    ]);
  });

  it("clicking option clears custom text", async () => {
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
          ]),
        ]}
        onBatchSubmit={onBatchSubmit}
        onDismiss={vi.fn()}
      />,
    );

    // Type custom text first
    await user.type(screen.getByPlaceholderText("Type something..."), "my answer");
    // Click option B — should clear custom text
    await user.click(screen.getByRole("button", { name: /B/ }));
    await user.click(screen.getByRole("button", { name: "Submit" }));

    expect(onBatchSubmit).toHaveBeenCalledWith([
      {
        toolUseId: "ask-1",
        answers: [
          { questionIndex: 0, selectedOptions: [1], customText: undefined },
        ],
      },
    ]);
  });
});
