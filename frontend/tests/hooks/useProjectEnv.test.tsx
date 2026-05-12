import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { api } from "@/hooks/useApi";
import { useDeleteProjectEnv, useProjectEnv, useUpdateProjectEnv } from "@/hooks/useProjectEnv";
import { createWrapper } from "../test-utils";

vi.mock("@/hooks/useApi", () => ({
  api: {
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

describe("useProjectEnv", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads project environment content", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      exists: true,
      content: "API_KEY=secret\n",
    });

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useProjectEnv("proj-1"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.get).toHaveBeenCalledWith("/api/projects/proj-1/env");
    expect(result.current.data?.content).toBe("API_KEY=secret\n");
  });

  it("saves project environment content into the query cache", async () => {
    vi.mocked(api.put).mockResolvedValueOnce({
      exists: true,
      content: "API_KEY=updated\n",
    });

    const { queryClient, wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateProjectEnv("proj-1"), { wrapper });

    await act(async () => {
      await result.current.mutateAsync("API_KEY=updated\n");
    });

    expect(api.put).toHaveBeenCalledWith("/api/projects/proj-1/env", {
      content: "API_KEY=updated\n",
    });
    expect(queryClient.getQueryData(["project-env", "proj-1"])).toEqual({
      exists: true,
      content: "API_KEY=updated\n",
    });
  });

  it("clears project environment content from the query cache", async () => {
    vi.mocked(api.delete).mockResolvedValueOnce(undefined);

    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(["project-env", "proj-1"], {
      exists: true,
      content: "API_KEY=secret\n",
    });
    const { result } = renderHook(() => useDeleteProjectEnv("proj-1"), { wrapper });

    await act(async () => {
      await result.current.mutateAsync();
    });

    expect(api.delete).toHaveBeenCalledWith("/api/projects/proj-1/env");
    expect(queryClient.getQueryData(["project-env", "proj-1"])).toEqual({
      exists: false,
      content: "",
    });
  });
});
