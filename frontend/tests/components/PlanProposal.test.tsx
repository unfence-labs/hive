import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PlanProposal } from "@/components/chat/PlanProposal";

vi.mock("@/components/ai-elements/message", () => ({
  MessageResponse: ({ children }: { children: string }) => <div data-testid="plan-content">{children}</div>,
}));

describe("PlanProposal", () => {
  it("starts expanded in interactive mode and toggles on click", async () => {
    const user = userEvent.setup();
    render(<PlanProposal status="interactive" planContent="## Plan body" />);

    expect(screen.getByTestId("plan-content")).toHaveTextContent("## Plan body");
    await user.click(screen.getByRole("button", { name: /Proposed plan/i }));
    expect(screen.queryByTestId("plan-content")).not.toBeInTheDocument();
  });

  it("starts collapsed for approved and revised states with matching badge", () => {
    const { rerender } = render(<PlanProposal status="approved" planContent="Approved plan" />);
    expect(screen.queryByTestId("plan-content")).not.toBeInTheDocument();
    expect(screen.getByText("Approved")).toBeInTheDocument();

    rerender(<PlanProposal status="revised" planContent="Revised plan" />);
    expect(screen.queryByTestId("plan-content")).not.toBeInTheDocument();
    expect(screen.getByText("Revised")).toBeInTheDocument();
  });

  it("auto-collapses when status leaves interactive", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<PlanProposal status="interactive" planContent="Plan V1" />);

    expect(screen.getByTestId("plan-content")).toHaveTextContent("Plan V1");
    await user.click(screen.getByRole("button", { name: /Proposed plan/i }));
    expect(screen.queryByTestId("plan-content")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Proposed plan/i }));
    expect(screen.getByTestId("plan-content")).toHaveTextContent("Plan V1");

    rerender(<PlanProposal status="approved" planContent="Plan V1" />);
    expect(screen.queryByTestId("plan-content")).not.toBeInTheDocument();
  });

  it("does not toggle open when plan content is missing", async () => {
    const user = userEvent.setup();
    render(<PlanProposal status="interactive" />);

    await user.click(screen.getByRole("button", { name: /Proposed plan/i }));
    expect(screen.queryByTestId("plan-content")).not.toBeInTheDocument();
  });
});
