import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useResource } from "@/hooks/useResource";
import { api } from "@/hooks/useApi";

vi.mock("@/hooks/useApi", () => ({
  api: {
    get: vi.fn(),
  },
}));

describe("useResource", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does nothing when URL is null", async () => {
    const { result } = renderHook(() => useResource<{ id: number }>(null));

    expect(result.current.loading).toBe(false);
    expect(result.current.data).toEqual([]);
    expect(api.get).not.toHaveBeenCalled();
  });

  it("fetches and stores data on mount", async () => {
    vi.mocked(api.get).mockResolvedValueOnce([{ id: 1 }]);

    const { result } = renderHook(() => useResource<{ id: number }>("/api/items"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(api.get).toHaveBeenCalledWith("/api/items");
    expect(result.current.data).toEqual([{ id: 1 }]);
    expect(result.current.error).toBeNull();
  });

  it("sets error state when fetch fails", async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error("boom"));

    const { result } = renderHook(() => useResource<{ id: number }>("/api/items"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe("boom");
    expect(result.current.data).toEqual([]);
  });

  it("supports manual refresh", async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce([{ id: 1 }])
      .mockResolvedValueOnce([{ id: 2 }]);

    const { result } = renderHook(() => useResource<{ id: number }>("/api/items"));

    await waitFor(() => {
      expect(result.current.data).toEqual([{ id: 1 }]);
    });

    await act(async () => {
      await result.current.refresh();
    });

    await waitFor(() => {
      expect(result.current.data).toEqual([{ id: 2 }]);
    });

    expect(api.get).toHaveBeenCalledTimes(2);
  });
});
