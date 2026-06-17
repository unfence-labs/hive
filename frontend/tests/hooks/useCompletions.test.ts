import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useCompletions } from "@/hooks/useCompletions";
import { api } from "@/hooks/useApi";
import type { CompletionItem } from "@/types";
import { createWrapper } from "../test-utils";

vi.mock("@/hooks/useApi", () => ({
  api: {
    get: vi.fn(),
  },
}));

function makeItem(name: string, source: CompletionItem["source"]): CompletionItem {
  return {
    type: "slash_command",
    name,
    label: `/${name}`,
    source,
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

describe("useCompletions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty list and skips fetch when workspace id is missing", () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCompletions(undefined, "claude"), { wrapper });

    expect(result.current).toEqual([]);
    expect(api.get).not.toHaveBeenCalled();
  });

  it("returns empty list and skips fetch when completions are disabled", () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCompletions("ws-1", "codex", false), { wrapper });

    expect(result.current).toEqual([]);
    expect(api.get).not.toHaveBeenCalled();
  });

  it("fetches completions for workspace and exposes items", async () => {
    const items = [makeItem("help", "builtin"), makeItem("deploy", "user_skill")];
    vi.mocked(api.get).mockResolvedValueOnce({ items });

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCompletions("ws-1", "claude"), { wrapper });

    await waitFor(() => {
      expect(result.current).toEqual(items);
    });

    expect(api.get).toHaveBeenCalledWith("/api/workspaces/ws-1/completions?provider=claude");
  });

  it("re-fetches when workspace id changes", async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({ items: [makeItem("help", "builtin")] })
      .mockResolvedValueOnce({ items: [makeItem("local", "project_skill")] });

    const { wrapper } = createWrapper();
    const { result, rerender } = renderHook(({ wsId }: { wsId: string | undefined }) => useCompletions(wsId, "claude"), {
      initialProps: { wsId: "ws-1" },
      wrapper,
    });

    await waitFor(() => {
      expect(result.current).toEqual([makeItem("help", "builtin")]);
    });

    rerender({ wsId: "ws-2" });

    await waitFor(() => {
      expect(result.current).toEqual([makeItem("local", "project_skill")]);
    });

    expect(api.get).toHaveBeenNthCalledWith(1, "/api/workspaces/ws-1/completions?provider=claude");
    expect(api.get).toHaveBeenNthCalledWith(2, "/api/workspaces/ws-2/completions?provider=claude");
  });

  it("resets to empty list when workspace id becomes undefined", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ items: [makeItem("help", "builtin")] });

    const { wrapper } = createWrapper();
    const { result, rerender } = renderHook(({ wsId }: { wsId: string | undefined }) => useCompletions(wsId, "claude"), {
      initialProps: { wsId: "ws-1" },
      wrapper,
    });

    await waitFor(() => {
      expect(result.current).toEqual([makeItem("help", "builtin")]);
    });

    rerender({ wsId: undefined });

    await waitFor(() => {
      expect(result.current).toEqual([]);
    });
  });

  it("returns empty list when fetch fails for new workspace", async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({ items: [makeItem("help", "builtin")] })
      .mockRejectedValueOnce(new Error("network"));

    const { wrapper } = createWrapper();
    const { result, rerender } = renderHook(({ wsId }: { wsId: string | undefined }) => useCompletions(wsId, "claude"), {
      initialProps: { wsId: "ws-1" },
      wrapper,
    });

    await waitFor(() => {
      expect(result.current).toEqual([makeItem("help", "builtin")]);
    });

    rerender({ wsId: "ws-2" });

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledTimes(2);
    });

    // React Query caches per key — ws-2 has no data after failure
    expect(result.current).toEqual([]);
  });

  it("ignores stale responses when workspace changes quickly", async () => {
    const first = deferred<{ items: CompletionItem[] }>();
    const second = deferred<{ items: CompletionItem[] }>();

    vi.mocked(api.get)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const { wrapper } = createWrapper();
    const { result, rerender } = renderHook(({ wsId }: { wsId: string | undefined }) => useCompletions(wsId, "claude"), {
      initialProps: { wsId: "ws-1" },
      wrapper,
    });

    rerender({ wsId: "ws-2" });

    await act(async () => {
      first.resolve({ items: [makeItem("stale", "user_skill")] });
      await Promise.resolve();
    });

    expect(result.current).toEqual([]);

    await act(async () => {
      second.resolve({ items: [makeItem("fresh", "project_skill")] });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current).toEqual([makeItem("fresh", "project_skill")]);
    });
  });

  it("fetches provider-specific completions", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ items: [makeItem("review", "builtin")] });

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCompletions("ws-1", "codex"), { wrapper });

    await waitFor(() => {
      expect(result.current).toEqual([makeItem("review", "builtin")]);
    });

    expect(api.get).toHaveBeenCalledWith("/api/workspaces/ws-1/completions?provider=codex");
  });
});
