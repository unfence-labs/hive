import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useTabs } from "@/hooks/useTabs";

describe("useTabs", () => {
  it("defaults active tab to the current session", () => {
    const { result } = renderHook(() => useTabs("s1"));
    expect(result.current.activeTabId).toBe("session:s1");
    expect(result.current.isFileTabActive).toBe(false);
    expect(result.current.openFile).toBeNull();
  });

  it("defaults to null when no session ID provided", () => {
    const { result } = renderHook(() => useTabs(undefined));
    expect(result.current.activeTabId).toBeNull();
    expect(result.current.isFileTabActive).toBe(false);
  });

  it("openFileTab activates file and stores path", () => {
    const { result } = renderHook(() => useTabs("s1"));
    act(() => result.current.openFileTab("src/index.ts"));
    expect(result.current.activeTabId).toBe("file:src/index.ts");
    expect(result.current.openFile).toBe("src/index.ts");
    expect(result.current.isFileTabActive).toBe(true);
  });

  it("openFileTab replaces existing file tab", () => {
    const { result } = renderHook(() => useTabs("s1"));
    act(() => result.current.openFileTab("a.ts"));
    act(() => result.current.openFileTab("b.ts"));
    expect(result.current.openFile).toBe("b.ts");
    expect(result.current.activeTabId).toBe("file:b.ts");
  });

  it("closeFileTab reverts to current session", () => {
    const { result } = renderHook(() => useTabs("s1"));
    act(() => result.current.openFileTab("a.ts"));
    expect(result.current.isFileTabActive).toBe(true);
    act(() => result.current.closeFileTab());
    expect(result.current.activeTabId).toBe("session:s1");
    expect(result.current.openFile).toBeNull();
    expect(result.current.isFileTabActive).toBe(false);
  });

  it("activateTab switches to any tab", () => {
    const { result } = renderHook(() => useTabs("s1"));
    act(() => result.current.openFileTab("a.ts"));
    // switch back to session
    act(() => result.current.activateTab("session:s1"));
    expect(result.current.activeTabId).toBe("session:s1");
    expect(result.current.isFileTabActive).toBe(false);
    // file is still open, just not active
    expect(result.current.openFile).toBe("a.ts");
  });

  it("tracks currentSessionId when on a session tab", () => {
    const { result, rerender } = renderHook(
      ({ sid }) => useTabs(sid),
      { initialProps: { sid: "s1" } },
    );
    expect(result.current.activeTabId).toBe("session:s1");
    rerender({ sid: "s2" });
    expect(result.current.activeTabId).toBe("session:s2");
  });

  it("does NOT disturb file tab when currentSessionId changes", () => {
    const { result, rerender } = renderHook(
      ({ sid }) => useTabs(sid),
      { initialProps: { sid: "s1" } },
    );
    act(() => result.current.openFileTab("a.ts"));
    expect(result.current.isFileTabActive).toBe(true);
    rerender({ sid: "s2" });
    // should still be on the file tab
    expect(result.current.activeTabId).toBe("file:a.ts");
    expect(result.current.isFileTabActive).toBe(true);
  });

  it("resetForWorkspace clears file tab and resets", () => {
    const { result, rerender } = renderHook(
      ({ sid }) => useTabs(sid),
      { initialProps: { sid: "s1" } },
    );
    act(() => result.current.openFileTab("a.ts"));
    act(() => result.current.resetForWorkspace());
    expect(result.current.openFile).toBeNull();
    // After reset, activeTabId is null until a new session triggers the sync effect
    expect(result.current.activeTabId).toBeNull();
    // Simulate workspace switch: new session ID triggers the effect
    rerender({ sid: "s2" });
    expect(result.current.activeTabId).toBe("session:s2");
    expect(result.current.isFileTabActive).toBe(false);
  });

  it("closeFileTab falls back to null when no session", () => {
    const { result } = renderHook(() => useTabs(undefined));
    act(() => result.current.openFileTab("a.ts"));
    act(() => result.current.closeFileTab());
    expect(result.current.activeTabId).toBeNull();
    expect(result.current.openFile).toBeNull();
  });
});
