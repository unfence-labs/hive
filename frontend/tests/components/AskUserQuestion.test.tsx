import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AskUserQuestion } from "@/components/chat/AskUserQuestion";
import type { ToolCall } from "@/types";

function askTool(input: unknown): ToolCall {
  return {
    id: "tool-ask",
    name: "AskUserQuestion",
    input: typeof input === "string" ? input : JSON.stringify(input),
  };
}

describe("AskUserQuestion", () => {
  it("shows compact awaiting state when interactive", () => {
    render(
      <AskUserQuestion
        tool={askTool({
          questions: [{ question: "Pick one", options: [{ label: "A" }, { label: "B" }] }],
        })}
        isInteractive
      />,
    );

    expect(screen.getByText("User input")).toBeInTheDocument();
    expect(screen.getByText("AWAITING RESPONSE")).toBeInTheDocument();
    expect(screen.queryByText("Pick one")).not.toBeInTheDocument();
  });

  it("shows answered summary and expands historical question details", async () => {
    const user = userEvent.setup();
    render(
      <AskUserQuestion
        tool={askTool({
          questions: [
            {
              question: "Choose language",
              options: [
                { label: "TypeScript", description: "Strict by default" },
                { label: "JavaScript" },
              ],
            },
            {
              question: "Choose runtime",
              options: [{ label: "Node.js" }],
            },
          ],
        })}
      />,
    );

    expect(screen.getByText("ANSWERED")).toBeInTheDocument();
    expect(screen.getByText("2 questions")).toBeInTheDocument();
    expect(screen.queryByText("Choose language")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /user input/i }));

    expect(screen.getByText("Choose language")).toBeInTheDocument();
    expect(screen.getByText("TypeScript")).toBeInTheDocument();
    expect(screen.getByText(/Strict by default/)).toBeInTheDocument();
    expect(screen.getByText("Choose runtime")).toBeInTheDocument();
  });

  it("returns null when payload has no questions", () => {
    const { container } = render(<AskUserQuestion tool={askTool("{bad json")} />);
    expect(container).toBeEmptyDOMElement();
  });
});
