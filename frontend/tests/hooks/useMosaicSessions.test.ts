import { describe, expect, it, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMosaicSessions, parseTileId } from "@/hooks/useMosaicSessions";

const STORAGE_KEY = "hive-mosaic-workspaces";

describe("useMosaicSessions", () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
  });

  it("returns empty selectedIds initially", () => {
    const { result } = renderHook(() => useMosaicSessions());
    expect(result.current.selectedIds).toEqual([]);
  });

  it("toggleSession selects a session", () => {
    const { result } = renderHook(() => useMosaicSessions());
    act(() => result.current.toggleSession("ws-1:sess-1"));
    expect(result.current.selectedIds).toEqual(["ws-1:sess-1"]);
    expect(result.current.isSelected("ws-1:sess-1")).toBe(true);
  });

  it("toggleSession deselects a selected session", () => {
    const { result } = renderHook(() => useMosaicSessions());
    act(() => result.current.toggleSession("ws-1:sess-1"));
    act(() => result.current.toggleSession("ws-1:sess-1"));
    expect(result.current.selectedIds).toEqual([]);
    expect(result.current.isSelected("ws-1:sess-1")).toBe(false);
  });

  it("selectSession adds to selected set", () => {
    const { result } = renderHook(() => useMosaicSessions());
    act(() => result.current.selectSession("ws-1:sess-1"));
    expect(result.current.selectedIds).toEqual(["ws-1:sess-1"]);
  });

  it("selectSession is idempotent", () => {
    const { result } = renderHook(() => useMosaicSessions());
    act(() => result.current.selectSession("ws-1:sess-1"));
    act(() => result.current.selectSession("ws-1:sess-1"));
    expect(result.current.selectedIds).toEqual(["ws-1:sess-1"]);
  });

  it("deselectSession removes from selected set", () => {
    const { result } = renderHook(() => useMosaicSessions());
    act(() => result.current.selectSession("ws-1:sess-1"));
    act(() => result.current.deselectSession("ws-1:sess-1"));
    expect(result.current.selectedIds).toEqual([]);
  });

  it("setSelectedIds bulk-updates", () => {
    const { result } = renderHook(() => useMosaicSessions());
    act(() => result.current.setSelectedIds(["ws-1:s1", "ws-2:s2"]));
    expect(result.current.selectedIds).toEqual(["ws-1:s1", "ws-2:s2"]);
  });

  it("persists to localStorage", () => {
    const { result } = renderHook(() => useMosaicSessions());
    act(() => result.current.selectSession("ws-1:sess-1"));
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual(["ws-1:sess-1"]);
  });

  it("handles corrupt localStorage gracefully", () => {
    localStorage.setItem(STORAGE_KEY, "not-json");
    const { result } = renderHook(() => useMosaicSessions());
    expect(result.current.selectedIds).toEqual([]);
  });

  it("multiple instances stay in sync", () => {
    const { result: a } = renderHook(() => useMosaicSessions());
    const { result: b } = renderHook(() => useMosaicSessions());
    act(() => a.current.selectSession("ws-1:sess-1"));
    expect(b.current.selectedIds).toEqual(["ws-1:sess-1"]);
  });

  it("enforces max 4 selected sessions", () => {
    const { result } = renderHook(() => useMosaicSessions());
    act(() => result.current.setSelectedIds(["a", "b", "c", "d"]));
    expect(result.current.atMax).toBe(true);
    act(() => result.current.selectSession("e"));
    expect(result.current.selectedIds).toEqual(["a", "b", "c", "d"]);
  });

  it("toggleSession does not add past max", () => {
    const { result } = renderHook(() => useMosaicSessions());
    act(() => result.current.setSelectedIds(["a", "b", "c", "d"]));
    act(() => result.current.toggleSession("e"));
    expect(result.current.selectedIds).toEqual(["a", "b", "c", "d"]);
  });

  it("setSelectedIds caps at 4", () => {
    const { result } = renderHook(() => useMosaicSessions());
    act(() => result.current.setSelectedIds(["a", "b", "c", "d", "e"]));
    expect(result.current.selectedIds).toEqual(["a", "b", "c", "d"]);
  });
});

describe("parseTileId", () => {
  it("parses composite tile ID", () => {
    expect(parseTileId("ws-1:sess-1")).toEqual({ wsId: "ws-1", sessionId: "sess-1" });
  });

  it("parses bare workspace ID", () => {
    expect(parseTileId("ws-1")).toEqual({ wsId: "ws-1" });
  });
});
