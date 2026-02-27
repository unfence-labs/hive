import { render, screen, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PlanActionBar } from "@/components/chat/PlanActionBar";

const mocks = vi.hoisted(() => ({
  copyToClipboard: vi.fn(),
}));

vi.mock("@/lib/clipboard", () => ({
  copyToClipboard: mocks.copyToClipboard,
}));

describe("PlanActionBar", () => {
  it("calls approve and handoff callbacks with plan payload", async () => {
    const user = userEvent.setup();
    const onApprove = vi.fn();
    const onHandOff = vi.fn();

    render(
      <PlanActionBar
        planContent="Implementation steps"
        planPath=".claude/plans/feature.md"
        onApprove={onApprove}
        onHandOff={onHandOff}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Approve" }));
    expect(onApprove).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: /Hand off/i }));
    expect(onHandOff).toHaveBeenCalledWith("Implementation steps", ".claude/plans/feature.md");
  });

  it("passes empty content to handoff when plan content is unavailable", async () => {
    const user = userEvent.setup();
    const onHandOff = vi.fn();

    render(<PlanActionBar onApprove={vi.fn()} onHandOff={onHandOff} />);

    expect(screen.queryByRole("button", { name: "Copy" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Hand off/i }));
    expect(onHandOff).toHaveBeenCalledWith("", undefined);
  });

  it("copies plan content and shows transient success state", async () => {
    vi.useFakeTimers();
    mocks.copyToClipboard.mockResolvedValue(undefined);
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");

    render(
      <PlanActionBar
        planContent="copy me"
        onApprove={vi.fn()}
        onHandOff={vi.fn()}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    });
    await vi.waitFor(() => {
      expect(mocks.copyToClipboard).toHaveBeenCalledWith("copy me");
    });
    expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Function), 2000);

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    timeoutSpy.mockRestore();
    vi.useRealTimers();
  });
});
