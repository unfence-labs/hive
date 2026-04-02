import { describe, expect, it, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMosaicWorkspaces, MAX_MOSAIC } from "@/hooks/useMosaicWorkspaces";

const STORAGE_KEY = "hive-mosaic-workspaces";

describe("useMosaicWorkspaces", () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
  });

  it("returns empty array initially", () => {
    const { result } = renderHook(() => useMosaicWorkspaces());
    expect(result.current.selectedIds).toEqual([]);
  });

  it("exports MAX_MOSAIC = 4", () => {
    expect(MAX_MOSAIC).toBe(4);
  });

  it("setSelectedIds persists to localStorage", () => {
    const { result } = renderHook(() => useMosaicWorkspaces());
    act(() => result.current.setSelectedIds(["ws-1", "ws-2"]));
    expect(result.current.selectedIds).toEqual(["ws-1", "ws-2"]);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual(["ws-1", "ws-2"]);
  });

  it("setSelectedIds caps at MAX_MOSAIC", () => {
    const { result } = renderHook(() => useMosaicWorkspaces());
    act(() => result.current.setSelectedIds(["a", "b", "c", "d", "e"]));
    expect(result.current.selectedIds).toHaveLength(MAX_MOSAIC);
  });

  it("toggleId adds an ID", () => {
    const { result } = renderHook(() => useMosaicWorkspaces());
    act(() => result.current.toggleId("ws-1"));
    expect(result.current.selectedIds).toEqual(["ws-1"]);
  });

  it("toggleId removes an existing ID", () => {
    const { result } = renderHook(() => useMosaicWorkspaces());
    act(() => result.current.setSelectedIds(["ws-1", "ws-2"]));
    act(() => result.current.toggleId("ws-1"));
    expect(result.current.selectedIds).toEqual(["ws-2"]);
  });

  it("toggleId does not add beyond MAX_MOSAIC", () => {
    const { result } = renderHook(() => useMosaicWorkspaces());
    act(() => result.current.setSelectedIds(["a", "b", "c", "d"]));
    act(() => result.current.toggleId("e"));
    expect(result.current.selectedIds).toEqual(["a", "b", "c", "d"]);
  });

  it("removeId removes a specific ID", () => {
    const { result } = renderHook(() => useMosaicWorkspaces());
    act(() => result.current.setSelectedIds(["ws-1", "ws-2", "ws-3"]));
    act(() => result.current.removeId("ws-2"));
    expect(result.current.selectedIds).toEqual(["ws-1", "ws-3"]);
  });

  it("handles corrupt localStorage gracefully", () => {
    localStorage.setItem(STORAGE_KEY, "not-json");
    const { result } = renderHook(() => useMosaicWorkspaces());
    expect(result.current.selectedIds).toEqual([]);
  });

  it("multiple instances stay in sync", () => {
    const { result: a } = renderHook(() => useMosaicWorkspaces());
    const { result: b } = renderHook(() => useMosaicWorkspaces());
    act(() => a.current.setSelectedIds(["ws-1"]));
    expect(b.current.selectedIds).toEqual(["ws-1"]);
  });
});
