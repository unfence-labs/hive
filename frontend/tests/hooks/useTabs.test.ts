import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useTabs, _resetSnapshotCache } from "@/hooks/useTabs";

afterEach(() => _resetSnapshotCache());

describe("useTabs", () => {
  it("defaults active tab to the current session", () => {
    const { result } = renderHook(() => useTabs("s1", "ws1"));
    expect(result.current.activeTabId).toBe("session:s1");
    expect(result.current.isFileTabActive).toBe(false);
    expect(result.current.openFile).toBeNull();
  });

  it("defaults to null when no session ID provided", () => {
    const { result } = renderHook(() => useTabs(undefined, "ws1"));
    expect(result.current.activeTabId).toBeNull();
    expect(result.current.isFileTabActive).toBe(false);
  });

  it("openFileTab activates file and stores path", () => {
    const { result } = renderHook(() => useTabs("s1", "ws1"));
    act(() => result.current.openFileTab("src/index.ts"));
    expect(result.current.activeTabId).toBe("file:src/index.ts");
    expect(result.current.openFile).toBe("src/index.ts");
    expect(result.current.isFileTabActive).toBe(true);
  });

  it("openFileTab replaces existing file tab", () => {
    const { result } = renderHook(() => useTabs("s1", "ws1"));
    act(() => result.current.openFileTab("a.ts"));
    act(() => result.current.openFileTab("b.ts"));
    expect(result.current.openFile).toBe("b.ts");
    expect(result.current.activeTabId).toBe("file:b.ts");
  });

  it("closeFileTab reverts to current session", () => {
    const { result } = renderHook(() => useTabs("s1", "ws1"));
    act(() => result.current.openFileTab("a.ts"));
    expect(result.current.isFileTabActive).toBe(true);
    act(() => result.current.closeFileTab());
    expect(result.current.activeTabId).toBe("session:s1");
    expect(result.current.openFile).toBeNull();
    expect(result.current.isFileTabActive).toBe(false);
  });

  it("activateTab switches to any tab", () => {
    const { result } = renderHook(() => useTabs("s1", "ws1"));
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
      ({ sid, ws }) => useTabs(sid, ws),
      { initialProps: { sid: "s1", ws: "ws1" } },
    );
    expect(result.current.activeTabId).toBe("session:s1");
    rerender({ sid: "s2", ws: "ws1" });
    expect(result.current.activeTabId).toBe("session:s2");
  });

  it("does NOT disturb file tab when currentSessionId changes", () => {
    const { result, rerender } = renderHook(
      ({ sid, ws }) => useTabs(sid, ws),
      { initialProps: { sid: "s1", ws: "ws1" } },
    );
    act(() => result.current.openFileTab("a.ts"));
    expect(result.current.isFileTabActive).toBe(true);
    rerender({ sid: "s2", ws: "ws1" });
    // should still be on the file tab
    expect(result.current.activeTabId).toBe("file:a.ts");
    expect(result.current.isFileTabActive).toBe(true);
  });

  it("closeFileTab falls back to null when no session", () => {
    const { result } = renderHook(() => useTabs(undefined, "ws1"));
    act(() => result.current.openFileTab("a.ts"));
    act(() => result.current.closeFileTab());
    expect(result.current.activeTabId).toBeNull();
    expect(result.current.openFile).toBeNull();
  });

  // ---- workspace switch persistence ----

  it("restores file tab when switching back to a workspace", () => {
    const { result, rerender } = renderHook(
      ({ sid, ws }) => useTabs(sid, ws),
      { initialProps: { sid: "s1", ws: "ws1" } },
    );
    // Open a file in ws1
    act(() => result.current.openFileTab("a.ts"));
    expect(result.current.openFile).toBe("a.ts");
    expect(result.current.isFileTabActive).toBe(true);

    // Switch to ws2 — state should reset
    rerender({ sid: "s3", ws: "ws2" });
    expect(result.current.openFile).toBeNull();
    expect(result.current.activeTabId).toBe("session:s3");

    // Switch back to ws1 — file tab should be restored
    rerender({ sid: "s1", ws: "ws1" });
    expect(result.current.openFile).toBe("a.ts");
    expect(result.current.activeTabId).toBe("file:a.ts");
    expect(result.current.isFileTabActive).toBe(true);
  });

  it("restores session tab when switching back with no file open", () => {
    const { result, rerender } = renderHook(
      ({ sid, ws }) => useTabs(sid, ws),
      { initialProps: { sid: "s1", ws: "ws1" } },
    );
    // No file opened — just on session tab
    expect(result.current.activeTabId).toBe("session:s1");

    // Switch to ws2
    rerender({ sid: "s3", ws: "ws2" });
    // Switch back to ws1
    rerender({ sid: "s1", ws: "ws1" });
    expect(result.current.activeTabId).toBe("session:s1");
    expect(result.current.openFile).toBeNull();
  });

  it("resets cleanly for a workspace with no cached state", () => {
    const { result, rerender } = renderHook(
      ({ sid, ws }) => useTabs(sid, ws),
      { initialProps: { sid: "s1", ws: "ws1" } },
    );
    act(() => result.current.openFileTab("a.ts"));

    // Switch to ws2 (never visited)
    rerender({ sid: "s3", ws: "ws2" });
    expect(result.current.openFile).toBeNull();
    // session sync effect sets it
    expect(result.current.activeTabId).toBe("session:s3");
  });
});
