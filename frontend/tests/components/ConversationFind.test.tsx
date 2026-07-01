import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StickToBottom } from "use-stick-to-bottom";
import { ConversationFind } from "@/components/chat/ConversationFind";

/**
 * ConversationFind reads its scroll container from useStickToBottomContext, so it
 * must render inside <StickToBottom>. The searchable content lives in
 * <StickToBottom.Content> so it sits within scrollRef.current.
 *
 * We drive the input with fireEvent (synchronous) rather than userEvent: under
 * jsdom + fake timers, userEvent's internal timer pumping deadlocks against the
 * hook's debounce and StickToBottom's effects.
 */
function renderFind(switchCounter = 0) {
  return render(
    <StickToBottom>
      <StickToBottom.Content>
        <p data-find-content="">foo bar Foo</p>
        <div data-find-content="">
          <span>foo</span>
        </div>
      </StickToBottom.Content>
      <ConversationFind switchCounter={switchCounter} />
    </StickToBottom>,
  );
}

function pressFindShortcut() {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true }));
}

function typeQuery(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
  act(() => {
    vi.advanceTimersByTime(150);
  });
}

describe("ConversationFind", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing until opened", () => {
    renderFind();
    expect(screen.queryByPlaceholderText("Find in conversation")).toBeNull();
  });

  it("opens on Ctrl+F and shows a correct counter for a matching query", () => {
    renderFind();

    act(() => {
      pressFindShortcut();
    });

    const input = screen.getByPlaceholderText("Find in conversation");
    expect(input).toBeInTheDocument();

    typeQuery(input, "bar");

    // "bar" matches once: 1/1.
    expect(screen.getByText("1/1")).toBeInTheDocument();
    expect(input).not.toHaveAttribute("aria-invalid", "true");
  });

  it("shows 0/0 and marks the input invalid when there are no matches", () => {
    renderFind();

    act(() => {
      pressFindShortcut();
    });

    const input = screen.getByPlaceholderText("Find in conversation");
    typeQuery(input, "zzz");

    expect(screen.getByText("0/0")).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("disables Previous/Next buttons when there are no matches", () => {
    renderFind();

    act(() => {
      pressFindShortcut();
    });

    expect(screen.getByLabelText("Previous match")).toBeDisabled();
    expect(screen.getByLabelText("Next match")).toBeDisabled();
  });

  it("closes the bar when Escape is pressed in the input", () => {
    renderFind();

    act(() => {
      pressFindShortcut();
    });
    const input = screen.getByPlaceholderText("Find in conversation");
    expect(input).toBeInTheDocument();

    fireEvent.keyDown(input, { key: "Escape" });

    expect(screen.queryByPlaceholderText("Find in conversation")).toBeNull();
  });
});
