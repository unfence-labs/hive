import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { usePrStatus, useBulkPrStatus, usePrStatusMap, prStatusKey } from "@/hooks/usePrStatus";
import { api } from "@/hooks/useApi";
import type { PrStatusResponse, PullRequestInfo } from "@/types";
import { createWrapper } from "../test-utils";

vi.mock("@/hooks/useApi", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

function makePr(overrides: Partial<PullRequestInfo> = {}): PullRequestInfo {
  return {
    number: 42,
    url: "https://github.com/acme/widget/pull/42",
    state: "open",
    mergeable: null,
    mergeableState: "unknown",
    checksStatus: "success",
    checksPassed: null,
    checksTotal: null,
    reviewStatus: null,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("usePrStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns defaults and does not fetch when workspace id is missing", () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePrStatus(undefined), { wrapper });

    expect(result.current).toEqual({
      pr: null,
      error: null,
      loading: false,
    });
    expect(api.get).not.toHaveBeenCalled();
  });

  it("reads a seeded cache entry without standalone fetch", async () => {
    const { wrapper, queryClient } = createWrapper();
    queryClient.setQueryData(prStatusKey("ws-1"), {
      pr: makePr({ number: 7 }),
    } satisfies PrStatusResponse);

    const { result } = renderHook(() => usePrStatus("ws-1"), { wrapper });

    await waitFor(() => {
      expect(result.current.pr?.number).toBe(7);
    });

    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(api.get).not.toHaveBeenCalled();
  });

  it("exposes seeded error payloads", async () => {
    const { wrapper, queryClient } = createWrapper();
    queryClient.setQueryData(prStatusKey("ws-1"), {
      pr: null,
      error: "gh not authenticated — run `gh auth login`",
    } satisfies PrStatusResponse);

    const { result } = renderHook(() => usePrStatus("ws-1"), { wrapper });

    await waitFor(() => {
      expect(result.current.error).toContain("gh not authenticated");
    });

    expect(result.current.pr).toBeNull();
    expect(api.get).not.toHaveBeenCalled();
  });

  it("reports loading=true while the shared bulk poll is in flight", async () => {
    const pending = deferred<{ results: Record<string, PrStatusResponse> }>();
    vi.mocked(api.post).mockReturnValueOnce(pending.promise);

    const { wrapper } = createWrapper();
    renderHook(() => useBulkPrStatus(["ws-1"]), { wrapper });
    const { result } = renderHook(() => usePrStatus("ws-1"), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(true);
    });

    await act(async () => {
      pending.resolve({ results: { "ws-1": { pr: makePr({ number: 99 }) } } });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.pr?.number).toBe(99);
    });
    expect(api.get).not.toHaveBeenCalled();
  });

  it("updates when workspace id changes and cache is already seeded", async () => {
    const { wrapper, queryClient } = createWrapper();
    queryClient.setQueryData(prStatusKey("ws-1"), {
      pr: makePr({ number: 1 }),
    } satisfies PrStatusResponse);
    queryClient.setQueryData(prStatusKey("ws-2"), {
      pr: makePr({ number: 2 }),
    } satisfies PrStatusResponse);

    const { result, rerender } = renderHook(
      ({ wsId }: { wsId: string | undefined }) => usePrStatus(wsId),
      {
        initialProps: { wsId: "ws-1" },
        wrapper,
      },
    );

    await waitFor(() => {
      expect(result.current.pr?.number).toBe(1);
    });

    rerender({ wsId: "ws-2" });

    await waitFor(() => {
      expect(result.current.pr?.number).toBe(2);
    });
    expect(api.get).not.toHaveBeenCalled();
  });
});

describe("usePrStatusMap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns statuses from shared per-workspace cache", async () => {
    const { wrapper, queryClient } = createWrapper();
    queryClient.setQueryData(prStatusKey("ws-1"), {
      pr: makePr({ number: 11 }),
    } satisfies PrStatusResponse);
    queryClient.setQueryData(prStatusKey("ws-2"), {
      pr: null,
      error: "Failed to fetch PR status",
    } satisfies PrStatusResponse);

    const { result } = renderHook(() => usePrStatusMap(["ws-1", "ws-2"]), { wrapper });

    await waitFor(() => {
      expect(result.current["ws-1"]?.pr?.number).toBe(11);
    });
    expect(result.current["ws-2"]?.error).toBe("Failed to fetch PR status");
  });
});

describe("useBulkPrStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty results when wsIds is empty", () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useBulkPrStatus([]), { wrapper });

    expect(result.current.results).toEqual({});
    expect(result.current.loading).toBe(false);
    expect(api.post).not.toHaveBeenCalled();
  });

  it("posts to bulk endpoint with workspace IDs", async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      results: {
        "ws-1": { pr: makePr({ number: 1 }) },
        "ws-2": { pr: null },
      },
    });

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useBulkPrStatus(["ws-1", "ws-2"]), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.results["ws-1"]?.pr?.number).toBe(1);
    });

    expect(api.post).toHaveBeenCalledWith("/api/workspaces/pr-status/bulk", {
      workspaceIds: ["ws-1", "ws-2"],
    });
    expect(result.current.results["ws-2"]).toEqual({ pr: null });
    expect(result.current.loading).toBe(false);
  });

  it("reports loading=true while request is in flight", async () => {
    const pending = deferred<{ results: Record<string, unknown> }>();
    vi.mocked(api.post).mockReturnValueOnce(pending.promise);

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useBulkPrStatus(["ws-1"]), { wrapper });

    expect(result.current.loading).toBe(true);

    await act(async () => {
      pending.resolve({ results: { "ws-1": { pr: makePr() } } });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
  });

  it("uses stable query key regardless of wsIds order", async () => {
    vi.mocked(api.post).mockResolvedValue({
      results: { "ws-1": { pr: null }, "ws-2": { pr: null } },
    });

    const { wrapper } = createWrapper();
    const { result, rerender } = renderHook(
      ({ ids }: { ids: string[] }) => useBulkPrStatus(ids),
      {
        initialProps: { ids: ["ws-2", "ws-1"] },
        wrapper,
      },
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    rerender({ ids: ["ws-1", "ws-2"] });

    // Should not trigger a second fetch — same sorted key
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it("keeps previous results while refetching after wsIds changes", async () => {
    const pending = deferred<{ results: Record<string, unknown> }>();
    vi.mocked(api.post)
      .mockResolvedValueOnce({
        results: { "ws-1": { pr: makePr({ number: 1 }) } },
      })
      .mockReturnValueOnce(pending.promise);

    const { wrapper } = createWrapper();
    const { result, rerender } = renderHook(
      ({ ids }: { ids: string[] }) => useBulkPrStatus(ids),
      {
        initialProps: { ids: ["ws-1"] },
        wrapper,
      },
    );

    await waitFor(() => {
      expect(result.current.results["ws-1"]?.pr?.number).toBe(1);
    });

    rerender({ ids: ["ws-2"] });

    // keepPreviousData should preserve old data until the new key resolves.
    expect(result.current.results["ws-1"]?.pr?.number).toBe(1);
    expect(result.current.loading).toBe(false);

    await act(async () => {
      pending.resolve({ results: { "ws-2": { pr: makePr({ number: 2 }) } } });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.results["ws-2"]?.pr?.number).toBe(2);
    });
  });

  it("seeds per-workspace cache entries after bulk fetch", async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      results: {
        "ws-1": { pr: makePr({ number: 10 }) },
        "ws-2": { pr: null, error: "gh not authenticated" },
      },
    });

    const { wrapper, queryClient } = createWrapper();
    renderHook(() => useBulkPrStatus(["ws-1", "ws-2"]), { wrapper });

    await waitFor(() => {
      const ws1 = queryClient.getQueryData(prStatusKey("ws-1")) as
        | PrStatusResponse
        | undefined;
      expect(ws1?.pr?.number).toBe(10);
    });

    const ws2 = queryClient.getQueryData(prStatusKey("ws-2")) as
      | PrStatusResponse
      | undefined;
    expect(ws2?.pr).toBeNull();
    expect(ws2?.error).toBe("gh not authenticated");
  });
});

describe("usePrStatus reads bulk-seeded cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns data seeded by bulk without making a standalone request", async () => {
    const { wrapper, queryClient } = createWrapper();

    // Pre-seed the per-workspace cache as if bulk had populated it
    queryClient.setQueryData(prStatusKey("ws-1"), {
      pr: makePr({ number: 77 }),
    } satisfies PrStatusResponse);

    const { result } = renderHook(() => usePrStatus("ws-1"), { wrapper });

    await waitFor(() => {
      expect(result.current.pr?.number).toBe(77);
    });

    // No standalone GET request should have fired
    expect(api.get).not.toHaveBeenCalled();
  });
});
