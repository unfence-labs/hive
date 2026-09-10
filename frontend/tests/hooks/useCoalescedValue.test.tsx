import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCoalescedValue } from "@/hooks/useCoalescedValue";

describe("useCoalescedValue", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function renderCoalesced(initial: string) {
    return renderHook(({ value }) => useCoalescedValue(value, 200), { initialProps: { value: initial } });
  }

  it("shows a change immediately when the previous change is older than the window", () => {
    const { result, rerender } = renderCoalesced("a");
    expect(result.current).toBe("a");
    act(() => vi.advanceTimersByTime(250));
    rerender({ value: "b" });
    expect(result.current).toBe("b");
  });

  it("holds rapid changes and shows the latest value at the end of the window", () => {
    const { result, rerender } = renderCoalesced("a");
    act(() => vi.advanceTimersByTime(250));
    rerender({ value: "b" });
    expect(result.current).toBe("b");
    act(() => vi.advanceTimersByTime(50));
    rerender({ value: "c" });
    expect(result.current).toBe("b");
    act(() => vi.advanceTimersByTime(50));
    rerender({ value: "d" });
    expect(result.current).toBe("b");
    act(() => vi.advanceTimersByTime(99));
    expect(result.current).toBe("b");
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe("d");
  });

  it("treats the mount as an accepted change", () => {
    const { result, rerender } = renderCoalesced("a");
    rerender({ value: "b" });
    expect(result.current).toBe("a");
    act(() => vi.advanceTimersByTime(200));
    expect(result.current).toBe("b");
  });
});
