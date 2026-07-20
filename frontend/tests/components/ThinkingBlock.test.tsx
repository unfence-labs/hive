import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { ThinkingBlock } from "@/components/chat/ThinkingBlock";

vi.mock("@/components/ai-elements/message", () => ({
  MessageResponse: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

describe("ThinkingBlock", () => {
  it("renders typed phases in one accessible disclosure and drops redacted ones", async () => {
    const user = userEvent.setup();
    render(
      <ThinkingBlock
        segments={[
          { id: "visible-1", content: "Inspecting the repository" },
          { id: "hidden-1" },
          { id: "visible-2", content: "Checking the tests" },
        ]}
      />,
    );

    const trigger = screen.getByRole("button", { name: /Reasoning/ });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).not.toHaveTextContent("phase");
    expect(trigger).not.toHaveTextContent("hidden");
    expect(screen.queryByText("Inspecting the repository")).not.toBeInTheDocument();

    await user.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Inspecting the repository")).toBeInTheDocument();
    expect(screen.getByText("Checking the tests")).toBeInTheDocument();
    expect(trigger.getAttribute("aria-controls")).toBe(
      screen.getByText("Inspecting the repository").closest("[id]")?.id,
    );
  });

  it("uses legacy content only when typed segments are absent", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ThinkingBlock legacyContent="Legacy reasoning" />);

    await user.click(screen.getByRole("button", { name: /Reasoning/ }));
    expect(screen.getByText("Legacy reasoning")).toBeInTheDocument();

    rerender(
      <ThinkingBlock
        segments={[{ id: "typed", content: "Typed reasoning" }]}
        legacyContent="Legacy reasoning"
      />,
    );

    expect(screen.getByText("Typed reasoning")).toBeInTheDocument();
    expect(screen.queryByText("Legacy reasoning")).not.toBeInTheDocument();
  });

  it("hides contentless thinking phases entirely", async () => {
    const user = userEvent.setup();
    const { container, rerender } = render(
      <ThinkingBlock
        segments={[
          { id: "missing" },
          { id: "empty", content: "" },
        ]}
      />,
    );

    expect(container).toBeEmptyDOMElement();

    rerender(
      <ThinkingBlock
        segments={[
          { id: "missing" },
          { id: "visible", content: "Real thought" },
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Reasoning/ }));

    expect(screen.getByText("Real thought")).toBeInTheDocument();
    expect(screen.queryByText("Reasoning content unavailable")).not.toBeInTheDocument();
  });

  it("stays collapsed and labels the header 'Reasoning…' while streaming", () => {
    render(
      <ThinkingBlock
        segments={[{ id: "streaming", content: "A long in-progress thought" }]}
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
    render(
      <ThinkingBlock
        segments={[{ id: "visible-1", content: "Only thinking here" }]}
      />,
    );

    const trigger = screen.getByRole("button", { name: /Reasoning/ });
    expect(trigger).toHaveTextContent("Reasoning");
    expect(trigger).not.toHaveTextContent("Reasoning…");
    expect(trigger).not.toHaveTextContent("phase");
  });
});
