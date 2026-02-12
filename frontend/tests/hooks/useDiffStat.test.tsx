import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDiffStat } from "@/hooks/useDiffStat";
import { api } from "@/hooks/useApi";

vi.mock("@/hooks/useApi", () => ({
  api: {
    get: vi.fn(),
  },
}));

describe("useDiffStat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not fetch when workspace id is missing", async () => {
    const { result } = renderHook(() => useDiffStat(undefined));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(api.get).not.toHaveBeenCalled();
    expect(result.current.committed).toEqual([]);
    expect(result.current.uncommitted).toEqual([]);
    expect(result.current.totalCount).toBe(0);
    expect(result.current.error).toBeNull();
  });

  it("fetches committed/uncommitted stats and computes deduplicated total count", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      committed: [
        { file: "src/a.ts", additions: 2, deletions: 0, status: "added" },
      ],
      uncommitted: [
        { file: "src/a.ts", additions: 1, deletions: 1, status: "modified" },
        { file: "src/b.ts", additions: 0, deletions: 3, status: "deleted" },
      ],
    });

    const { result } = renderHook(() => useDiffStat("ws-1"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(api.get).toHaveBeenCalledWith("/api/workspaces/ws-1/diff/stat");
    expect(result.current.committed).toHaveLength(1);
    expect(result.current.uncommitted).toHaveLength(2);
    expect(result.current.totalCount).toBe(2);
    expect(result.current.error).toBeNull();
  });

  it("surfaces errors and clears them after a successful refresh", async () => {
    vi.mocked(api.get)
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({
        committed: [
          { file: "src/c.ts", additions: 1, deletions: 0, status: "added" },
        ],
        uncommitted: [],
      });

    const { result } = renderHook(() => useDiffStat("ws-1"));

    await waitFor(() => {
      expect(result.current.error).toBe("network down");
    });

    await act(async () => {
      await result.current.refresh();
    });

    await waitFor(() => {
      expect(result.current.error).toBeNull();
    });
    expect(result.current.committed).toHaveLength(1);
    expect(result.current.uncommitted).toEqual([]);
  });

  it("resets lists when workspace id becomes undefined", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      committed: [
        { file: "src/a.ts", additions: 1, deletions: 0, status: "added" },
      ],
      uncommitted: [],
    });

    const { result, rerender } = renderHook(
      ({ wsId }: { wsId: string | undefined }) => useDiffStat(wsId),
      { initialProps: { wsId: "ws-1" } },
    );

    await waitFor(() => {
      expect(result.current.totalCount).toBe(1);
    });

    rerender({ wsId: undefined });

    await waitFor(() => {
      expect(result.current.totalCount).toBe(0);
    });
    expect(result.current.committed).toEqual([]);
    expect(result.current.uncommitted).toEqual([]);
  });
});
