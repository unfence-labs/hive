import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { ThinkingBlock } from "@/components/chat/ThinkingBlock";

vi.mock("@/components/ai-elements/message", () => ({
  MessageResponse: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

describe("ThinkingBlock", () => {
  it("renders typed phases in one accessible disclosure", async () => {
    const user = userEvent.setup();
    render(
      <ThinkingBlock
        segments={[
          { id: "visible-1", kind: "thinking", content: "Inspecting the repository" },
          { id: "hidden-1", kind: "redacted" },
          { id: "visible-2", kind: "thinking", content: "Checking the tests" },
        ]}
      />,
    );

    const trigger = screen.getByRole("button", { name: /Reasoning/ });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).not.toHaveTextContent("phase");
    expect(trigger).toHaveTextContent("1 hidden");
    expect(screen.queryByText("Inspecting the repository")).not.toBeInTheDocument();

    await user.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Inspecting the repository")).toBeInTheDocument();
    expect(screen.getByText("Checking the tests")).toBeInTheDocument();
    expect(screen.getByText("Reasoning hidden by provider")).toBeInTheDocument();
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
        segments={[{ id: "typed", kind: "thinking", content: "Typed reasoning" }]}
        legacyContent="Legacy reasoning"
      />,
    );

    expect(screen.getByText("Typed reasoning")).toBeInTheDocument();
    expect(screen.queryByText("Legacy reasoning")).not.toBeInTheDocument();
  });

  it("does not infer redaction from legacy text", async () => {
    const user = userEvent.setup();
    render(<ThinkingBlock legacyContent="[redacted]" />);

    await user.click(screen.getByRole("button", { name: /Reasoning/ }));

    expect(screen.getByText("[redacted]")).toBeInTheDocument();
    expect(screen.queryByText("Reasoning hidden by provider")).not.toBeInTheDocument();
  });

  it("hides contentless thinking phases entirely", async () => {
    const user = userEvent.setup();
    const { container, rerender } = render(
      <ThinkingBlock
        segments={[
          { id: "missing", kind: "thinking" },
          { id: "empty", kind: "thinking", content: "" },
        ]}
      />,
    );

    expect(container).toBeEmptyDOMElement();

    rerender(
      <ThinkingBlock
        segments={[
          { id: "missing", kind: "thinking" },
          { id: "visible", kind: "thinking", content: "Real thought" },
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Reasoning/ }));

    expect(screen.getByText("Real thought")).toBeInTheDocument();
    expect(screen.queryByText("Reasoning content unavailable")).not.toBeInTheDocument();
  });

  it("labels streaming reasoning with a reduced-motion-safe indicator", () => {
    render(
      <ThinkingBlock
        segments={[{ id: "streaming", kind: "thinking", content: "A long in-progress thought" }]}
        streaming
      />,
    );

    const trigger = screen.getByRole("button", { name: /Reasoning.*Thinking/ });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveClass("cursor-pointer");
    expect(screen.queryByText("A long in-progress thought")).not.toBeInTheDocument();
    expect(document.querySelector(".motion-safe\\:animate-pulse")).not.toBeNull();
    expect(screen.queryByText(/Thought for/)).not.toBeInTheDocument();
    expect(trigger).not.toHaveTextContent("phase");
  });

  it("auto-expands while streaming when defaultOpen is set", () => {
    render(
      <ThinkingBlock
        segments={[{ id: "streaming", kind: "thinking", content: "A long in-progress thought" }]}
        streaming
        defaultOpen
      />,
    );

    const trigger = screen.getByRole("button", { name: /Reasoning.*Thinking/ });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("A long in-progress thought")).toBeInTheDocument();
  });

  it("shows a bare Reasoning label at rest with no hidden phases", () => {
    render(
      <ThinkingBlock
        segments={[{ id: "visible-1", kind: "thinking", content: "Only thinking here" }]}
      />,
    );

    const trigger = screen.getByRole("button", { name: /Reasoning/ });
    expect(trigger).not.toHaveTextContent("phase");
    expect(trigger).not.toHaveTextContent("hidden");
  });
});
