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
});
