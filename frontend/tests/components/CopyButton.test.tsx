import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CopyButton } from "@/components/chat/CopyButton";

const mocks = vi.hoisted(() => ({
  copyToClipboard: vi.fn(),
}));

vi.mock("@/lib/clipboard", () => ({
  copyToClipboard: mocks.copyToClipboard,
}));

describe("CopyButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mocks.copyToClipboard.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("copies message content and toggles aria label", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<CopyButton content="copied content" />);

    await user.click(screen.getByRole("button", { name: "Copy message" }));

    expect(mocks.copyToClipboard).toHaveBeenCalledWith("copied content");
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.getByRole("button", { name: "Copy message" })).toBeInTheDocument();
  });
});
