import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ThinkingBlock } from "@/components/chat/ThinkingBlock";

describe("ThinkingBlock", () => {
  it("renders parsed thoughts in one accessible disclosure", async () => {
    const user = userEvent.setup();
    render(
      <ThinkingBlock
        segments={[
          { id: "t-1", headline: "Inspecting the repository" },
          { id: "t-2", body: "Checking the tests" },
        ]}
      />,
    );

    const trigger = screen.getByRole("button", { name: /Reasoning/ });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Inspecting the repository")).not.toBeInTheDocument();

    await user.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Inspecting the repository")).toBeInTheDocument();
    expect(screen.getByText("Checking the tests")).toBeInTheDocument();
    expect(trigger.getAttribute("aria-controls")).toBe(
      screen.getByText("Inspecting the repository").closest("[id]")?.id,
    );
  });

  it("renders a headline and its body on the same line", async () => {
    const user = userEvent.setup();
    render(
      <ThinkingBlock
        segments={[{ id: "t-1", headline: "Verifying branch", body: "Checking the diff is current" }]}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Reasoning/ }));

    expect(screen.getByText("Verifying branch")).toBeInTheDocument();
    expect(screen.getByText("Checking the diff is current")).toBeInTheDocument();
  });

  it("drops thoughts with neither headline nor body, and renders nothing when all are empty", () => {
    const { container, rerender } = render(
      <ThinkingBlock segments={[{ id: "empty-1" }, { id: "empty-2" }]} />,
    );

    expect(container).toBeEmptyDOMElement();

    rerender(<ThinkingBlock segments={[{ id: "empty-1" }, { id: "real", headline: "Real thought" }]} />);
    expect(screen.getByRole("button", { name: /Reasoning/ })).toBeInTheDocument();
  });

  it("stays collapsed and labels the header 'Reasoning…' while streaming", () => {
    render(
      <ThinkingBlock
        segments={[{ id: "s", headline: "A long in-progress thought" }]}
        streaming
      />,
    );

    const trigger = screen.getByRole("button", { name: /Reasoning/ });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveClass("cursor-pointer");
    expect(trigger).toHaveTextContent("Reasoning…");
    expect(screen.queryByText("A long in-progress thought")).not.toBeInTheDocument();
  });

  it("shows a bare 'Reasoning' label at rest", () => {
    render(<ThinkingBlock segments={[{ id: "t-1", headline: "Only thinking here" }]} />);

    const trigger = screen.getByRole("button", { name: /Reasoning/ });
    expect(trigger).toHaveTextContent("Reasoning");
    expect(trigger).not.toHaveTextContent("Reasoning…");
  });
});
