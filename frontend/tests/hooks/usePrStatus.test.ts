import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { usePrStatus } from "@/hooks/usePrStatus";
import { api } from "@/hooks/useApi";
import type { PullRequestInfo } from "@/types";
import { createWrapper } from "../test-utils";

vi.mock("@/hooks/useApi", () => ({
  api: {
    get: vi.fn(),
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

  it("fetches PR status for the workspace", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ pr: makePr({ number: 7 }) });

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePrStatus("ws-1"), { wrapper });

    await waitFor(() => {
      expect(result.current.pr?.number).toBe(7);
    });

    expect(api.get).toHaveBeenCalledWith("/api/workspaces/ws-1/pr-status");
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it("exposes backend error messages", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      pr: null,
      error: "gh not authenticated — run `gh auth login`",
    });

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePrStatus("ws-1"), { wrapper });

    await waitFor(() => {
      expect(result.current.error).toContain("gh not authenticated");
    });

    expect(result.current.pr).toBeNull();
  });

  it("reports loading=true while the request is in flight", async () => {
    const pending = deferred<{ pr: PullRequestInfo | null; error?: string }>();
    vi.mocked(api.get).mockReturnValueOnce(pending.promise);

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePrStatus("ws-1"), { wrapper });

    expect(result.current.loading).toBe(true);

    await act(async () => {
      pending.resolve({ pr: makePr({ number: 99 }) });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.pr?.number).toBe(99);
  });

  it("refetches when workspace id changes", async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({ pr: makePr({ number: 1 }) })
      .mockResolvedValueOnce({ pr: makePr({ number: 2 }) });

    const { wrapper } = createWrapper();
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

    expect(api.get).toHaveBeenNthCalledWith(1, "/api/workspaces/ws-1/pr-status");
    expect(api.get).toHaveBeenNthCalledWith(2, "/api/workspaces/ws-2/pr-status");
  });
});
