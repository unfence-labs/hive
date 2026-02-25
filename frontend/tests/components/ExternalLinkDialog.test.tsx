import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExternalLinkDialog } from "@/components/ExternalLinkDialog";

const mocks = vi.hoisted(() => ({
  copyToClipboard: vi.fn(),
}));

vi.mock("@/lib/clipboard", () => ({
  copyToClipboard: mocks.copyToClipboard,
}));

describe("ExternalLinkDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mocks.copyToClipboard.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("copies the URL without closing the dialog", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();
    const onConfirm = vi.fn();

    render(
      <ExternalLinkDialog
        url="https://example.com/docs"
        open
        onClose={onClose}
        onConfirm={onConfirm}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Copy link" }));

    expect(mocks.copyToClipboard).toHaveBeenCalledWith("https://example.com/docs");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.getByRole("button", { name: "Copy link" })).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("calls onConfirm when opening the link", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();
    const onConfirm = vi.fn();

    render(
      <ExternalLinkDialog
        url="https://example.com"
        open
        onClose={onClose}
        onConfirm={onConfirm}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Open link" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("swallows clipboard errors and keeps copy button label unchanged", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mocks.copyToClipboard.mockRejectedValueOnce(new Error("clipboard denied"));

    render(
      <ExternalLinkDialog
        url="https://example.com"
        open
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Copy link" }));

    expect(screen.getByRole("button", { name: "Copy link" })).toBeInTheDocument();
  });
});
