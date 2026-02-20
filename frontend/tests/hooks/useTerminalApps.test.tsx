import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTerminalApps } from "@/hooks/useTerminalApps";

const mocks = vi.hoisted(() => ({
  detectTerminals: vi.fn(),
}));

vi.mock("@/lib/terminal", () => ({
  detectTerminals: mocks.detectTerminals,
}));

describe("useTerminalApps", () => {
  beforeEach(() => {
    mocks.detectTerminals.mockReset();
  });

  it("returns detected terminals after mount", async () => {
    mocks.detectTerminals.mockResolvedValue([
      { id: "terminal_app", name: "Terminal" },
      { id: "iterm2", name: "iTerm" },
    ]);

    const { result } = renderHook(() => useTerminalApps());

    await waitFor(() => {
      expect(result.current).toEqual([
        { id: "terminal_app", name: "Terminal" },
        { id: "iterm2", name: "iTerm" },
      ]);
    });
  });

  it("returns empty array when detection returns nothing", async () => {
    mocks.detectTerminals.mockResolvedValue([]);

    const { result } = renderHook(() => useTerminalApps());

    await waitFor(() => {
      expect(mocks.detectTerminals).toHaveBeenCalled();
    });

    expect(result.current).toEqual([]);
  });

  it("starts with empty array before detection completes", () => {
    mocks.detectTerminals.mockReturnValue(new Promise(() => {})); // never resolves

    const { result } = renderHook(() => useTerminalApps());

    expect(result.current).toEqual([]);
  });

  it("calls detectTerminals exactly once on mount", async () => {
    mocks.detectTerminals.mockResolvedValue([]);

    renderHook(() => useTerminalApps());

    await waitFor(() => {
      expect(mocks.detectTerminals).toHaveBeenCalledTimes(1);
    });
  });

  it("does not re-detect on rerender", async () => {
    mocks.detectTerminals.mockResolvedValue([{ id: "terminal_app", name: "Terminal" }]);

    const { result, rerender } = renderHook(() => useTerminalApps());

    await waitFor(() => {
      expect(result.current).toHaveLength(1);
    });

    rerender();
    rerender();

    expect(mocks.detectTerminals).toHaveBeenCalledTimes(1);
  });

  it("keeps empty array when detectTerminals resolves with empty (simulates internal error handling)", async () => {
    // detectTerminals handles its own errors and returns []. This test confirms
    // the hook stays stable when the detection layer resolves with nothing.
    mocks.detectTerminals.mockResolvedValue([]);

    const { result } = renderHook(() => useTerminalApps());

    await waitFor(() => {
      expect(mocks.detectTerminals).toHaveBeenCalled();
    });

    expect(result.current).toEqual([]);
  });
});
