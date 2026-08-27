import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConversationErrorChip } from "@/components/chat/ConversationErrorChip";

describe("ConversationErrorChip", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("renders an accessible themed error and dismisses after five active seconds", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<ConversationErrorChip message="Connection lost" onDismiss={onDismiss} />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Connection lost");
    expect(alert).toHaveClass("bg-foreground", "text-background", "rounded-full");

    act(() => vi.advanceTimersByTime(4_999));
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onDismiss).toHaveBeenCalledWith("Connection lost");
  });

  it("can be dismissed immediately", () => {
    const onDismiss = vi.fn();
    render(<ConversationErrorChip message="Connection lost" onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss error" }));

    expect(onDismiss).toHaveBeenCalledWith("Connection lost");
  });

  it("pauses while hovered and resumes with the remaining time", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<ConversationErrorChip message="Connection lost" onDismiss={onDismiss} />);
    const alert = screen.getByRole("alert");

    act(() => vi.advanceTimersByTime(2_000));
    fireEvent.pointerEnter(alert);
    act(() => vi.advanceTimersByTime(10_000));
    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.pointerLeave(alert);
    act(() => vi.advanceTimersByTime(2_999));
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("pauses while focused", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<ConversationErrorChip message="Connection lost" onDismiss={onDismiss} />);
    const alert = screen.getByRole("alert");

    act(() => vi.advanceTimersByTime(2_000));
    fireEvent.focus(alert);
    act(() => vi.advanceTimersByTime(10_000));
    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.blur(alert, { relatedTarget: null });
    act(() => vi.advanceTimersByTime(3_000));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("does not extend an identical error but resets for a different one", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const { rerender } = render(
      <ConversationErrorChip message="First error" onDismiss={onDismiss} />,
    );

    act(() => vi.advanceTimersByTime(3_000));
    rerender(<ConversationErrorChip message="First error" onDismiss={onDismiss} />);
    act(() => vi.advanceTimersByTime(2_000));
    expect(onDismiss).toHaveBeenLastCalledWith("First error");

    onDismiss.mockClear();
    rerender(<ConversationErrorChip message="Second error" onDismiss={onDismiss} />);
    act(() => vi.advanceTimersByTime(4_999));
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onDismiss).toHaveBeenCalledWith("Second error");
  });

  it("pauses while the window is inactive", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<ConversationErrorChip message="Connection lost" onDismiss={onDismiss} />);

    act(() => vi.advanceTimersByTime(2_000));
    fireEvent.blur(window);
    act(() => vi.advanceTimersByTime(10_000));
    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.focus(window);
    act(() => vi.advanceTimersByTime(3_000));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("keeps the chip mounted for its short exit transition", () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <ConversationErrorChip message="Connection lost" onDismiss={vi.fn()} />,
    );

    rerender(<ConversationErrorChip message={undefined} onDismiss={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveClass("animate-out", "fill-mode-forwards");

    act(() => vi.advanceTimersByTime(199));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("expands a truncated message on click and pauses auto-dismiss while expanded", () => {
    vi.useFakeTimers();
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(300);
    const onDismiss = vi.fn();
    render(<ConversationErrorChip message="A very long error message" onDismiss={onDismiss} />);

    const expand = screen.getByRole("button", { name: "A very long error message" });
    expect(expand).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(expand);
    expect(expand).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("alert")).toHaveClass("rounded-2xl");
    act(() => vi.advanceTimersByTime(10_000));
    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.click(expand);
    act(() => vi.advanceTimersByTime(5_000));
    expect(onDismiss).toHaveBeenCalledWith("A very long error message");
  });

  it("resumes auto-dismiss after a mouse click leaves focus on the chip", () => {
    vi.useFakeTimers();
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(300);
    const onDismiss = vi.fn();
    render(<ConversationErrorChip message="A very long error message" onDismiss={onDismiss} />);

    const alert = screen.getByRole("alert");
    const expand = screen.getByRole("button", { name: "A very long error message" });

    // A mouse click focuses the button on pointerdown; that focus must not
    // pause the timer the way keyboard focus does.
    fireEvent.pointerDown(alert);
    fireEvent.focus(expand);
    fireEvent.pointerUp(alert);
    fireEvent.click(expand);
    fireEvent.click(expand);

    act(() => vi.advanceTimersByTime(5_000));
    expect(onDismiss).toHaveBeenCalledWith("A very long error message");
  });
});
