import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MODEL_CATALOG_QUERY_KEY,
  prefetchModelCatalog,
  refreshModelCatalog,
  setCachedDefaultModelId,
  useModels,
} from "@/hooks/useModels";
import { api } from "@/hooks/useApi";
import type { ModelCatalogResponse } from "@/types";

vi.mock("@/hooks/useApi", () => ({
  api: { get: vi.fn() },
}));

const mockApi = vi.mocked(api);

const MOCK_CATALOG: ModelCatalogResponse = {
  models: [
    {
      id: "claude:opus-4-7",
      label: "Opus 4.7",
      provider: "claude",
      providerLabel: "Claude Code",
      isDefault: true,
      capabilities: { thinkingLevels: ["low", "medium", "high", "xhigh", "max"], planMode: true, blockingTools: true, completions: true, goals: false },
    },
    {
      id: "claude:sonnet-4-6",
      label: "Sonnet 4.6",
      provider: "claude",
      providerLabel: "Claude Code",
      capabilities: { thinkingLevels: ["low", "medium", "high", "xhigh", "max"], planMode: true, blockingTools: true, completions: true, goals: false },
    },
    {
      id: "codex:gpt-5.5",
      label: "GPT-5.5",
      provider: "codex",
      providerLabel: "Codex",
      isDefault: true,
      capabilities: { thinkingLevels: ["none", "minimal", "low", "medium", "high", "xhigh"], planMode: false, blockingTools: false, completions: true, goals: true },
    },
  ],
  defaultModelId: "codex:gpt-5.5",
};

function createQueryClient(retry: boolean | number = false) {
  return new QueryClient({
    defaultOptions: {
      queries: { retry, retryDelay: 0, gcTime: Infinity, staleTime: 5 * 60 * 1000 },
      mutations: { retry: false },
    },
  });
}

function wrapperFor(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    createElement(QueryClientProvider, { client: queryClient }, children)
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useModels", () => {
  it("loads the shared catalog and seeds the global default", async () => {
    mockApi.get.mockResolvedValue(MOCK_CATALOG);
    const queryClient = createQueryClient();
    const { result } = renderHook(() => useModels(), { wrapper: wrapperFor(queryClient) });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.selectedModelId).toBe("");

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockApi.get).toHaveBeenCalledWith("/api/models", { signal: expect.any(AbortSignal) });
    expect(result.current.models).toHaveLength(3);
    expect(result.current.selectedModelId).toBe("codex:gpt-5.5");
    expect(result.current.selectedModel?.label).toBe("GPT-5.5");
    expect(result.current.capabilities?.goals).toBe(true);
  });

  it("uses the QueryClient retry policy for transient failures", async () => {
    mockApi.get
      .mockRejectedValueOnce(new Error("temporary one"))
      .mockRejectedValueOnce(new Error("temporary two"))
      .mockResolvedValue(MOCK_CATALOG);
    const queryClient = createQueryClient(2);
    const { result } = renderHook(() => useModels(), { wrapper: wrapperFor(queryClient) });

    await waitFor(() => expect(result.current.models).toHaveLength(3));

    expect(mockApi.get).toHaveBeenCalledTimes(3);
    expect(result.current.isError).toBe(false);
  });

  it("prefetches once and seeds remounted composers synchronously from QueryClient", async () => {
    mockApi.get.mockResolvedValue(MOCK_CATALOG);
    const queryClient = createQueryClient();

    await prefetchModelCatalog(queryClient);
    const first = renderHook(() => useModels(undefined, "claude:sonnet-4-6"), {
      wrapper: wrapperFor(queryClient),
    });

    expect(first.result.current.isLoading).toBe(false);
    expect(first.result.current.selectedModelId).toBe("claude:sonnet-4-6");
    first.unmount();

    const second = renderHook(() => useModels(), { wrapper: wrapperFor(queryClient) });
    expect(second.result.current.models).toHaveLength(3);
    expect(mockApi.get).toHaveBeenCalledTimes(1);
  });

  it("seeds and enforces a locked provider", async () => {
    mockApi.get.mockResolvedValue(MOCK_CATALOG);
    const queryClient = createQueryClient();
    const { result, rerender } = renderHook(
      ({ provider }: { provider?: string }) =>
        useModels(provider, "claude:sonnet-4-6"),
      { initialProps: { provider: "claude" }, wrapper: wrapperFor(queryClient) },
    );

    await waitFor(() => expect(result.current.selectedModelId).toBe("claude:sonnet-4-6"));

    rerender({ provider: "codex" });
    await waitFor(() => expect(result.current.selectedModelId).toBe("codex:gpt-5.5"));
  });

  it("keeps a surviving local selection across catalog refreshes", async () => {
    mockApi.get.mockResolvedValue(MOCK_CATALOG);
    const queryClient = createQueryClient();
    const { result } = renderHook(() => useModels(), { wrapper: wrapperFor(queryClient) });
    await waitFor(() => expect(result.current.models).toHaveLength(3));

    act(() => result.current.setSelectedModelId("claude:sonnet-4-6"));
    const refreshed: ModelCatalogResponse = {
      ...MOCK_CATALOG,
      models: [...MOCK_CATALOG.models, {
        id: "kimi:k3",
        label: "K3",
        provider: "kimi",
        providerLabel: "Kimi",
        capabilities: { thinkingLevels: ["low", "high", "max"], planMode: true, blockingTools: true, completions: true, goals: false },
      }],
    };
    mockApi.get.mockResolvedValue(refreshed);

    await act(() => refreshModelCatalog(queryClient));

    await waitFor(() => expect(result.current.models).toHaveLength(4));
    expect(result.current.selectedModelId).toBe("claude:sonnet-4-6");
  });

  it("reseeds when a refresh removes the selected model", async () => {
    mockApi.get.mockResolvedValue(MOCK_CATALOG);
    const queryClient = createQueryClient();
    const { result } = renderHook(() => useModels(), { wrapper: wrapperFor(queryClient) });
    await waitFor(() => expect(result.current.models).toHaveLength(3));
    act(() => result.current.setSelectedModelId("claude:sonnet-4-6"));

    mockApi.get.mockResolvedValue({
      ...MOCK_CATALOG,
      models: MOCK_CATALOG.models.filter((model) => model.id !== "claude:sonnet-4-6"),
    });
    await act(() => refreshModelCatalog(queryClient));

    await waitFor(() => expect(result.current.selectedModelId).toBe("codex:gpt-5.5"));
  });

  it("retains stale models after a refresh failure and recovers on retry", async () => {
    mockApi.get.mockResolvedValue(MOCK_CATALOG);
    const queryClient = createQueryClient();
    const { result } = renderHook(() => useModels(), { wrapper: wrapperFor(queryClient) });
    await waitFor(() => expect(result.current.models).toHaveLength(3));

    mockApi.get.mockRejectedValue(new Error("catalog unavailable"));
    await act(() => refreshModelCatalog(queryClient));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.models).toEqual(MOCK_CATALOG.models);
    expect(result.current.selectedModel?.id).toBe("codex:gpt-5.5");

    mockApi.get.mockResolvedValue(MOCK_CATALOG);
    act(() => result.current.retry());

    await waitFor(() => expect(result.current.isError).toBe(false));
    expect(result.current.models).toEqual(MOCK_CATALOG.models);
  });

  it("patches the cached default for future composers", async () => {
    mockApi.get.mockResolvedValue(MOCK_CATALOG);
    const queryClient = createQueryClient();
    await prefetchModelCatalog(queryClient);

    setCachedDefaultModelId(queryClient, "claude:opus-4-7");

    expect(queryClient.getQueryData<ModelCatalogResponse>(MODEL_CATALOG_QUERY_KEY)?.defaultModelId)
      .toBe("claude:opus-4-7");
    const { result } = renderHook(() => useModels(), { wrapper: wrapperFor(queryClient) });
    expect(result.current.selectedModelId).toBe("claude:opus-4-7");
  });

  it("exposes an initial error and retries directly", async () => {
    mockApi.get.mockRejectedValue(new Error("offline"));
    const queryClient = createQueryClient();
    const { result } = renderHook(() => useModels(), { wrapper: wrapperFor(queryClient) });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.models).toEqual([]);

    mockApi.get.mockResolvedValue(MOCK_CATALOG);
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.models).toHaveLength(3));
  });

  it("drops the previous server catalog when the QueryClient is reset", async () => {
    mockApi.get.mockResolvedValue(MOCK_CATALOG);
    const queryClient = createQueryClient();
    const { result } = renderHook(() => useModels(), { wrapper: wrapperFor(queryClient) });
    await waitFor(() => expect(result.current.models).toHaveLength(3));

    const nextServerCatalog: ModelCatalogResponse = {
      models: [MOCK_CATALOG.models[0]],
      defaultModelId: "claude:opus-4-7",
    };
    mockApi.get.mockResolvedValue(nextServerCatalog);
    await act(() => queryClient.resetQueries());

    await waitFor(() => expect(result.current.models).toEqual(nextServerCatalog.models));
    expect(result.current.selectedModelId).toBe("claude:opus-4-7");
  });
});
