import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { usePrStatus, usePrStatusMap, useSyncPrWorkspaces, prStatusKey } from "@/hooks/usePrStatus";
import { wsTransport } from "@/lib/ws-transport";
import type { PrStatusResponse, PullRequestInfo } from "@/types";
import { createWrapper } from "../test-utils";

vi.mock("@/lib/ws-transport", () => ({
  wsTransport: {
    syncPrWorkspaces: vi.fn(),
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

describe("usePrStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    renderHook(() => useSyncPrWorkspaces([]), { wrapper: createWrapper().wrapper });
  });

  it("returns defaults when workspace id is missing", () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePrStatus(undefined), { wrapper });

    expect(result.current).toEqual({
      pr: null,
      error: null,
      loading: false,
    });
  });

  it("reads a seeded cache entry", async () => {
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
  });

  it("exposes seeded error payloads", async () => {
    const { wrapper, queryClient } = createWrapper();
    queryClient.setQueryData(prStatusKey("ws-1"), {
      pr: null,
      error: "gh not authenticated - run `gh auth login`",
    } satisfies PrStatusResponse);

    const { result } = renderHook(() => usePrStatus("ws-1"), { wrapper });

    await waitFor(() => {
      expect(result.current.error).toContain("gh not authenticated");
    });
    expect(result.current.pr).toBeNull();
  });

  it("reports loading while an interested workspace has no cached status", async () => {
    const { wrapper } = createWrapper();
    renderHook(() => useSyncPrWorkspaces(["ws-1"]), { wrapper });
    const { result } = renderHook(() => usePrStatus("ws-1"), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(true);
    });
    expect(wsTransport.syncPrWorkspaces).toHaveBeenCalledWith(["ws-1"]);
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
  });
});

describe("usePrStatusMap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns statuses from per-workspace cache", async () => {
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
