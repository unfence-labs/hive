import { describe, expect, it, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMosaicSessions, parseTileId } from "@/hooks/useMosaicSessions";

const STORAGE_KEY = "hive-mosaic-hidden-sessions";

describe("useMosaicSessions", () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
  });

  it("returns empty hiddenIds initially", () => {
    const { result } = renderHook(() => useMosaicSessions());
    expect(result.current.hiddenIds).toEqual([]);
  });

  it("toggleSession hides a session", () => {
    const { result } = renderHook(() => useMosaicSessions());
    act(() => result.current.toggleSession("ws-1:sess-1"));
    expect(result.current.hiddenIds).toEqual(["ws-1:sess-1"]);
    expect(result.current.isHidden("ws-1:sess-1")).toBe(true);
  });

  it("toggleSession shows a hidden session", () => {
    const { result } = renderHook(() => useMosaicSessions());
    act(() => result.current.toggleSession("ws-1:sess-1"));
    act(() => result.current.toggleSession("ws-1:sess-1"));
    expect(result.current.hiddenIds).toEqual([]);
    expect(result.current.isHidden("ws-1:sess-1")).toBe(false);
  });

  it("hideSession adds to hidden set", () => {
    const { result } = renderHook(() => useMosaicSessions());
    act(() => result.current.hideSession("ws-1:sess-1"));
    expect(result.current.hiddenIds).toEqual(["ws-1:sess-1"]);
  });

  it("hideSession is idempotent", () => {
    const { result } = renderHook(() => useMosaicSessions());
    act(() => result.current.hideSession("ws-1:sess-1"));
    act(() => result.current.hideSession("ws-1:sess-1"));
    expect(result.current.hiddenIds).toEqual(["ws-1:sess-1"]);
  });

  it("showSession removes from hidden set", () => {
    const { result } = renderHook(() => useMosaicSessions());
    act(() => result.current.hideSession("ws-1:sess-1"));
    act(() => result.current.showSession("ws-1:sess-1"));
    expect(result.current.hiddenIds).toEqual([]);
  });

  it("setHiddenIds bulk-updates", () => {
    const { result } = renderHook(() => useMosaicSessions());
    act(() => result.current.setHiddenIds(["ws-1:s1", "ws-2:s2"]));
    expect(result.current.hiddenIds).toEqual(["ws-1:s1", "ws-2:s2"]);
  });

  it("persists to localStorage", () => {
    const { result } = renderHook(() => useMosaicSessions());
    act(() => result.current.hideSession("ws-1:sess-1"));
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual(["ws-1:sess-1"]);
  });

  it("handles corrupt localStorage gracefully", () => {
    localStorage.setItem(STORAGE_KEY, "not-json");
    const { result } = renderHook(() => useMosaicSessions());
    expect(result.current.hiddenIds).toEqual([]);
  });

  it("multiple instances stay in sync", () => {
    const { result: a } = renderHook(() => useMosaicSessions());
    const { result: b } = renderHook(() => useMosaicSessions());
    act(() => a.current.hideSession("ws-1:sess-1"));
    expect(b.current.hiddenIds).toEqual(["ws-1:sess-1"]);
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
