import { renderHook, waitFor, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  useBrainFileContent,
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

  it("does not fetch file content when no path is selected", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useBrainFileContent(null), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(api.get).not.toHaveBeenCalled();
  });

  it("fetches file content for a selected path", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ path: "notes/x.md", content: "hi" });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useBrainFileContent("notes/x.md"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.get).toHaveBeenCalledWith("/api/brain/file?path=notes%2Fx.md");
    expect(result.current.data?.content).toBe("hi");
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

  it("delete calls the delete endpoint", async () => {
    vi.mocked(api.delete).mockResolvedValueOnce(undefined);
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useBrainFileMutations(), { wrapper });

    await act(async () => {
      await result.current.deleteFile("notes/x.md");
    });
    expect(api.delete).toHaveBeenCalledWith("/api/brain/file?path=notes%2Fx.md");
  });

  it("rename calls the rename endpoint", async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ path: "b.md", content: "" });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useBrainFileMutations(), { wrapper });

    await act(async () => {
      await result.current.renameFile({ from: "a.md", to: "b.md" });
    });
    expect(api.post).toHaveBeenCalledWith("/api/brain/file/rename", { from: "a.md", to: "b.md" });
  });
});
