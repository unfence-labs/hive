import { renderHook, waitFor, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useBrainSave, useBrainStatus } from "@/hooks/useBrainGit";
import { api } from "@/hooks/useApi";
import { createWrapper } from "../test-utils";

vi.mock("@/hooks/useApi", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

describe("useBrainGit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches the pending status (badge source)", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      files: [{ path: "a.md", status: "modified" }],
      count: 1,
    });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useBrainStatus(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.get).toHaveBeenCalledWith("/api/brain/status");
    expect(result.current.data?.count).toBe(1);
  });

  it("save posts the message and invalidates status + parsed diff", async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ committed: true, pushed: true });
    const { wrapper, queryClient } = createWrapper();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useBrainSave(), { wrapper });

    let outcome;
    await act(async () => {
      outcome = await result.current.save("msg");
    });

    expect(api.post).toHaveBeenCalledWith("/api/brain/save", { message: "msg" });
    expect(outcome).toEqual({ committed: true, pushed: true });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["brain", "status"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["brain", "diff", "parsed"] });
  });
});
