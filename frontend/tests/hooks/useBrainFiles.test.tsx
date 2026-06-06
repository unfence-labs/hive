import { renderHook, waitFor, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  useBrainFileMutations,
  useBrainFileTree,
} from "@/hooks/useBrainFiles";
import { api } from "@/hooks/useApi";
import { createWrapper } from "../test-utils";

vi.mock("@/hooks/useApi", () => ({
  api: {
    get: vi.fn(),
    put: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

describe("useBrainFiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches the file tree", async () => {
    vi.mocked(api.get).mockResolvedValueOnce([{ name: "a.md", path: "a.md", type: "file" }]);
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useBrainFileTree(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.get).toHaveBeenCalledWith("/api/brain/files");
    expect(result.current.data).toHaveLength(1);
  });

  it("upsert writes to disk and invalidates tree + status", async () => {
    vi.mocked(api.put).mockResolvedValueOnce({ path: "a.md", content: "body" });
    const { wrapper, queryClient } = createWrapper();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useBrainFileMutations(), { wrapper });

    await act(async () => {
      await result.current.upsertFile("a.md", "body");
    });

    expect(api.put).toHaveBeenCalledWith("/api/brain/file", { path: "a.md", content: "body" });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["brain", "files"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["brain", "status"] });
  });
});
