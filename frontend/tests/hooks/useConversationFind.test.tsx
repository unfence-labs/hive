import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RefObject } from "react";
import { useConversationFind } from "@/hooks/useConversationFind";

/**
 * Build a detached-but-attached container holding `[data-find-content]` segments
 * and return a ref pointing at it. The hook walks text nodes inside these
 * segments, so the markup determines the match counts the assertions expect.
 */
function mountContent(html: string): {
  container: HTMLDivElement;
  scrollRef: RefObject<HTMLElement | null>;
} {
  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.appendChild(container);
  const scrollRef = { current: container } as RefObject<HTMLElement | null>;
  return { container, scrollRef };
}

function pressFindShortcut() {
  // Cmd/Ctrl+F is registered on `window`; dispatch a real KeyboardEvent there.
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true }));
}

const DEFAULT_HTML = `<p data-find-content="">foo bar Foo</p><div data-find-content=""><span>foo</span></div>`;

describe("useConversationFind", () => {
  let appended: HTMLElement[];

  beforeEach(() => {
    vi.useFakeTimers();
    appended = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    for (const el of appended) el.remove();
    vi.restoreAllMocks();
  });

  function setup(html: string = DEFAULT_HTML, switchCounter = 0) {
    const { container, scrollRef } = mountContent(html);
    appended.push(container);
    const view = renderHook(
      (props: { switchCounter: number }) =>
        useConversationFind({ scrollRef, switchCounter: props.switchCounter }),
      { initialProps: { switchCounter } },
    );
    return { ...view, scrollRef, container };
  }

  it("opens the find bar on Ctrl+F when scrollRef is populated", () => {
    const { result } = setup();
    expect(result.current.open).toBe(false);

    act(() => {
      pressFindShortcut();
    });

    expect(result.current.open).toBe(true);
  });

  it("does not open when scrollRef.current is null", () => {
    const scrollRef = { current: null } as RefObject<HTMLElement | null>;
    const { result } = renderHook(() =>
      useConversationFind({ scrollRef, switchCounter: 0 }),
    );

    act(() => {
      pressFindShortcut();
    });

    expect(result.current.open).toBe(false);
  });

  it("counts case-insensitive matches across all segments after the 150ms debounce", () => {
    const { result } = setup();

    act(() => {
      pressFindShortcut();
    });
    act(() => {
      result.current.setQuery("foo");
    });

    // Before the debounce elapses nothing is indexed yet.
    expect(result.current.matchCount).toBe(0);

    act(() => {
      vi.advanceTimersByTime(150);
    });

    // "foo", "Foo" in the first segment and "foo" in the span => 3 matches.
    expect(result.current.matchCount).toBe(3);
    expect(result.current.activeIndex).toBe(0);
  });

  it("wraps activeIndex with next() and prev()", () => {
    const { result } = setup();

    act(() => {
      pressFindShortcut();
    });
    act(() => {
      result.current.setQuery("foo");
    });
    act(() => {
      vi.advanceTimersByTime(150);
    });

    expect(result.current.matchCount).toBe(3);
    expect(result.current.activeIndex).toBe(0);

    act(() => {
      result.current.next();
    });
    expect(result.current.activeIndex).toBe(1);

    act(() => {
      result.current.next();
    });
    expect(result.current.activeIndex).toBe(2);

    // Wrap from the last match back to the first.
    act(() => {
      result.current.next();
    });
    expect(result.current.activeIndex).toBe(0);

    // Wrap from the first match back to the last.
    act(() => {
      result.current.prev();
    });
    expect(result.current.activeIndex).toBe(2);
  });

  it("reports no matches for a query with zero hits", () => {
    const { result } = setup();

    act(() => {
      pressFindShortcut();
    });
    act(() => {
      result.current.setQuery("zzz");
    });
    act(() => {
      vi.advanceTimersByTime(150);
    });

    expect(result.current.matchCount).toBe(0);
    expect(result.current.activeIndex).toBe(-1);
  });

  it("keeps matchCount at 0 for an empty query", () => {
    const { result } = setup();

    act(() => {
      pressFindShortcut();
    });
    act(() => {
      result.current.setQuery("");
    });
    act(() => {
      vi.advanceTimersByTime(150);
    });

    expect(result.current.matchCount).toBe(0);
    expect(result.current.activeIndex).toBe(-1);
  });

  it("does not flag noResults during the debounce window, only after the search runs", () => {
    const { result } = setup();

    act(() => {
      pressFindShortcut();
    });
    act(() => {
      result.current.setQuery("zzz"); // no matches
    });

    // During the debounce the search hasn't run yet, so we must NOT claim
    // "no results" — that is the premature red flash we are guarding against.
    expect(result.current.noResults).toBe(false);

    act(() => {
      vi.advanceTimersByTime(150);
    });

    // Now the search has completed and genuinely found nothing.
    expect(result.current.matchCount).toBe(0);
    expect(result.current.noResults).toBe(true);
  });

  it("never flags noResults for a query that has matches", () => {
    const { result } = setup();

    act(() => {
      pressFindShortcut();
    });
    act(() => {
      result.current.setQuery("foo");
    });
    expect(result.current.noResults).toBe(false); // during debounce
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(result.current.matchCount).toBe(3);
    expect(result.current.noResults).toBe(false); // after search
  });

  it("resets open/matchCount/activeIndex on close()", () => {
    const { result } = setup();

    act(() => {
      pressFindShortcut();
    });
    act(() => {
      result.current.setQuery("foo");
    });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(result.current.matchCount).toBe(3);

    act(() => {
      result.current.close();
    });

    expect(result.current.open).toBe(false);
    expect(result.current.matchCount).toBe(0);
    expect(result.current.activeIndex).toBe(-1);
  });

  it("resets query and closes when switchCounter changes", () => {
    const { result, rerender } = setup();

    act(() => {
      pressFindShortcut();
    });
    act(() => {
      result.current.setQuery("foo");
    });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(result.current.open).toBe(true);
    expect(result.current.query).toBe("foo");

    act(() => {
      rerender({ switchCounter: 1 });
    });

    expect(result.current.open).toBe(false);
    expect(result.current.query).toBe("");
    expect(result.current.matchCount).toBe(0);
    expect(result.current.activeIndex).toBe(-1);
  });

  it("prefills the query from a single-line window selection on open", () => {
    const { result } = setup();

    // jsdom does not produce a usable Selection from layout, so stub
    // window.getSelection to return a deterministic single-line string.
    const getSelectionSpy = vi
      .spyOn(window, "getSelection")
      .mockReturnValue({ toString: () => "bar" } as unknown as Selection);

    act(() => {
      pressFindShortcut();
    });

    expect(result.current.open).toBe(true);
    expect(result.current.query).toBe("bar");
    getSelectionSpy.mockRestore();
  });

  it("does not prefill when the selection spans multiple lines", () => {
    const { result } = setup();

    const getSelectionSpy = vi
      .spyOn(window, "getSelection")
      .mockReturnValue({ toString: () => "line one\nline two" } as unknown as Selection);

    act(() => {
      pressFindShortcut();
    });

    expect(result.current.open).toBe(true);
    expect(result.current.query).toBe("");
    getSelectionSpy.mockRestore();
  });
});
