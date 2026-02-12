import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parsePatchFiles } from "@pierre/diffs";
import { useDiff } from "@/hooks/useDiff";
import { api } from "@/hooks/useApi";

vi.mock("@/hooks/useApi", () => ({
  api: {
    get: vi.fn(),
  },
}));

vi.mock("@pierre/diffs", () => ({
  parsePatchFiles: vi.fn(),
}));

describe("useDiff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does nothing when workspace id is undefined", async () => {
    const { result } = renderHook(() => useDiff(undefined));

    await act(async () => {
      await result.current.fetchDiff();
    });

    expect(api.get).not.toHaveBeenCalled();
    expect(result.current.patchFiles).toEqual([]);
    expect(result.current.rawDiff).toBe("");
    expect(result.current.error).toBeNull();
  });

  it("fetches diff and parses patch files", async () => {
    const parsed = [{ files: [] }] as never[];
    vi.mocked(api.get).mockResolvedValueOnce({ diff: "patch-content" });
    vi.mocked(parsePatchFiles).mockReturnValueOnce(parsed);

    const { result } = renderHook(() => useDiff("ws-1"));

    await act(async () => {
      await result.current.fetchDiff();
    });

    expect(api.get).toHaveBeenCalledWith("/api/workspaces/ws-1/diff");
    expect(parsePatchFiles).toHaveBeenCalledWith("patch-content");
    expect(result.current.rawDiff).toBe("patch-content");
    expect(result.current.patchFiles).toBe(parsed);
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it("stores empty parsed files when server returns empty diff", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ diff: "" });

    const { result } = renderHook(() => useDiff("ws-1"));

    await act(async () => {
      await result.current.fetchDiff();
    });

    expect(parsePatchFiles).not.toHaveBeenCalled();
    expect(result.current.patchFiles).toEqual([]);
    expect(result.current.rawDiff).toBe("");
  });

  it("sets fallback error when fetch fails with non-Error value", async () => {
    vi.mocked(api.get).mockRejectedValueOnce("boom");

    const { result } = renderHook(() => useDiff("ws-1"));

    await act(async () => {
      await result.current.fetchDiff();
    });

    expect(result.current.error).toBe("Failed to fetch diff");
    expect(result.current.loading).toBe(false);
  });
});
