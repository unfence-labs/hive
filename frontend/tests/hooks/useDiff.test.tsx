import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parsePatchFiles } from "@pierre/diffs";
import { useDiff } from "@/hooks/useDiff";
import { api } from "@/hooks/useApi";
import { createWrapper } from "../test-utils";

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
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDiff(undefined), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(api.get).not.toHaveBeenCalled();
    expect(result.current.patchFiles).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("does nothing when enabled is false", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDiff("ws-1", "combined", false), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(api.get).not.toHaveBeenCalled();
    expect(result.current.patchFiles).toEqual([]);
  });

  it("fetches diff and parses patch files when enabled", async () => {
    const parsed = [{ files: [] }] as never[];
    vi.mocked(api.get).mockResolvedValueOnce({ diff: "patch-content" });
    vi.mocked(parsePatchFiles).mockReturnValueOnce(parsed);
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useDiff("ws-1", "uncommitted", true), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(api.get).toHaveBeenCalledWith("/api/workspaces/ws-1/diff?scope=uncommitted");
    expect(parsePatchFiles).toHaveBeenCalledWith("patch-content");
    expect(result.current.patchFiles).toBe(parsed);
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it("stores empty parsed files when server returns empty diff", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ diff: "" });
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useDiff("ws-1", "combined", true), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(parsePatchFiles).not.toHaveBeenCalled();
    expect(result.current.patchFiles).toEqual([]);
  });

  it("sets error when fetch fails", async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error("boom"));
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useDiff("ws-1", "combined", true), { wrapper });

    await waitFor(() => {
      expect(result.current.error).toBe("boom");
    });

    expect(result.current.loading).toBe(false);
  });

  it("surfaces parser errors when diff content is invalid", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ diff: "broken-patch" });
    vi.mocked(parsePatchFiles).mockImplementationOnce(() => {
      throw new Error("invalid patch");
    });
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useDiff("ws-1", "combined", true), { wrapper });

    await waitFor(() => {
      expect(result.current.error).toBe("invalid patch");
    });

    expect(result.current.loading).toBe(false);
  });
});
