import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useModels, refreshModelCatalog, __resetModelCatalogCacheForTests } from "@/hooks/useModels";
import { api } from "@/hooks/useApi";
import type { ModelCatalogResponse } from "@/types";

vi.mock("@/hooks/useApi", () => ({
  api: {
    get: vi.fn(),
  },
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

beforeEach(() => {
  vi.clearAllMocks();
  __resetModelCatalogCacheForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useModels", () => {
  it("starts in loading state", () => {
    mockApi.get.mockReturnValue(new Promise(() => {})); // Never resolves
    const { result } = renderHook(() => useModels());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.models).toEqual([]);
    expect(result.current.defaultModelId).toBe("");
    expect(result.current.selectedModelId).toBe("");
  });

  it("loads models from API", async () => {
    mockApi.get.mockResolvedValue(MOCK_CATALOG);
    const { result } = renderHook(() => useModels());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.models).toHaveLength(3);
    expect(result.current.defaultModelId).toBe("codex:gpt-5.5");
    expect(result.current.selectedModelId).toBe("codex:gpt-5.5");
  });

  it("calls /api/models endpoint", async () => {
    mockApi.get.mockReturnValue(new Promise(() => {}));
    renderHook(() => useModels());

    await waitFor(() => expect(mockApi.get).toHaveBeenCalledWith("/api/models"));
  });

  it("sets selectedModelId to defaultModelId on first load", async () => {
    mockApi.get.mockResolvedValue(MOCK_CATALOG);
    const { result } = renderHook(() => useModels());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.selectedModelId).toBe("codex:gpt-5.5");
  });

  it("preserves previously selected model on re-fetch", async () => {
    mockApi.get.mockResolvedValue(MOCK_CATALOG);
    const { result } = renderHook(() => useModels());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.setSelectedModelId("claude:sonnet-4-6");
    });

    expect(result.current.selectedModelId).toBe("claude:sonnet-4-6");
  });

  it("resolves selectedModel from models list", async () => {
    mockApi.get.mockResolvedValue(MOCK_CATALOG);
    const { result } = renderHook(() => useModels());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.selectedModel).toBeDefined();
    expect(result.current.selectedModel?.id).toBe("codex:gpt-5.5");
    expect(result.current.selectedModel?.label).toBe("GPT-5.5");
  });

  it("returns capabilities of the selected model", async () => {
    mockApi.get.mockResolvedValue(MOCK_CATALOG);
    const { result } = renderHook(() => useModels());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.capabilities).toEqual({
      thinkingLevels: ["none", "minimal", "low", "medium", "high", "xhigh"],
      planMode: false,
      blockingTools: false,
      completions: true,
      goals: true,
    });

    act(() => {
      result.current.setSelectedModelId("codex:gpt-5.5");
    });

    expect(result.current.capabilities).toEqual({
      thinkingLevels: ["none", "minimal", "low", "medium", "high", "xhigh"],
      planMode: false,
      blockingTools: false,
      completions: true,
      goals: true,
    });
  });

  it("returns fallback capabilities when loading with no models", () => {
    mockApi.get.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useModels());

    // While loading, models is empty, should use fallback
    expect(result.current.capabilities).toEqual({
      thinkingLevels: ["low", "medium", "high", "xhigh", "max"],
      planMode: true,
      blockingTools: true,
      completions: true,
      goals: false,
    });
  });

  it("returns undefined capabilities when models loaded but selected model not found", async () => {
    mockApi.get.mockResolvedValue(MOCK_CATALOG);
    const { result } = renderHook(() => useModels());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.setSelectedModelId("nonexistent:model");
    });

    expect(result.current.selectedModel).toBeUndefined();
    expect(result.current.capabilities).toBeUndefined();
  });

  it("handles API error gracefully", async () => {
    mockApi.get.mockRejectedValue(new Error("Network error"));
    const { result } = renderHook(() => useModels());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.models).toEqual([]);
    expect(result.current.defaultModelId).toBe("");
  });

  it("setSelectedModelId updates the selected model", async () => {
    mockApi.get.mockResolvedValue(MOCK_CATALOG);
    const { result } = renderHook(() => useModels());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.setSelectedModelId("claude:sonnet-4-6");
    });

    expect(result.current.selectedModelId).toBe("claude:sonnet-4-6");
    expect(result.current.selectedModel?.label).toBe("Sonnet 4.6");
  });

  it("selects locked provider default when lockedProvider is set", async () => {
    mockApi.get.mockResolvedValue(MOCK_CATALOG);
    const { result } = renderHook(() => useModels("codex"));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.selectedModelId).toBe("codex:gpt-5.5");
    expect(result.current.selectedModel?.provider).toBe("codex");
  });

  it("falls back to global default when lockedProvider has no models", async () => {
    mockApi.get.mockResolvedValue(MOCK_CATALOG);
    const { result } = renderHook(() => useModels("unknown-provider"));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.selectedModelId).toBe("codex:gpt-5.5");
  });

  it("seeds preferredModelId when it exists in the catalog", async () => {
    mockApi.get.mockResolvedValue(MOCK_CATALOG);
    const { result } = renderHook(() => useModels(undefined, "claude:sonnet-4-6"));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.selectedModelId).toBe("claude:sonnet-4-6");
  });

  it("ignores preferredModelId that conflicts with lockedProvider", async () => {
    mockApi.get.mockResolvedValue(MOCK_CATALOG);
    // Prefer a claude model but the session is locked to codex.
    const { result } = renderHook(() => useModels("codex", "claude:sonnet-4-6"));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.selectedModelId).toBe("codex:gpt-5.5");
  });

  it("falls back to default when preferredModelId is not in the catalog", async () => {
    mockApi.get.mockResolvedValue(MOCK_CATALOG);
    const { result } = renderHook(() => useModels(undefined, "claude:removed-model"));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.selectedModelId).toBe("codex:gpt-5.5");
  });

  it("refreshModelCatalog pushes the refetched catalog to mounted hooks, keeping a surviving selection", async () => {
    mockApi.get.mockResolvedValue(MOCK_CATALOG);
    const { result } = renderHook(() => useModels());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.setSelectedModelId("claude:sonnet-4-6");
    });

    const refreshed: ModelCatalogResponse = {
      ...MOCK_CATALOG,
      models: [
        ...MOCK_CATALOG.models,
        {
          id: "kimi:k3",
          label: "K3",
          provider: "kimi",
          providerLabel: "Kimi",
          isDefault: true,
          capabilities: { thinkingLevels: ["low", "high", "max"], planMode: true, blockingTools: true, completions: true, goals: false },
        },
      ],
    };
    mockApi.get.mockResolvedValue(refreshed);
    await act(() => refreshModelCatalog());

    expect(mockApi.get).toHaveBeenCalledTimes(2);
    expect(result.current.models).toHaveLength(4);
    // The previous selection survives the refresh, so it is kept.
    expect(result.current.selectedModelId).toBe("claude:sonnet-4-6");
  });

  it("refreshModelCatalog reseeds the selection when it vanished from the catalog", async () => {
    mockApi.get.mockResolvedValue(MOCK_CATALOG);
    const { result } = renderHook(() => useModels());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.setSelectedModelId("claude:sonnet-4-6");
    });

    const refreshed: ModelCatalogResponse = {
      ...MOCK_CATALOG,
      models: MOCK_CATALOG.models.filter((m) => m.id !== "claude:sonnet-4-6"),
    };
    mockApi.get.mockResolvedValue(refreshed);
    await act(() => refreshModelCatalog());

    expect(result.current.selectedModelId).toBe("codex:gpt-5.5");
  });

  it("a stale in-flight initial load cannot overwrite a completed refresh", async () => {
    let resolveInitial!: (value: ModelCatalogResponse) => void;
    mockApi.get.mockReturnValueOnce(new Promise((resolve) => { resolveInitial = resolve; }));
    const { result } = renderHook(() => useModels());
    expect(result.current.isLoading).toBe(true);

    // The Kimi key was saved while the slow initial request was in flight:
    // the refresh fetches a newer catalog and completes first.
    const refreshed: ModelCatalogResponse = {
      ...MOCK_CATALOG,
      models: [
        ...MOCK_CATALOG.models,
        {
          id: "kimi:k3",
          label: "K3",
          provider: "kimi",
          providerLabel: "Kimi",
          capabilities: { thinkingLevels: ["low", "high", "max"], planMode: true, blockingTools: true, completions: true, goals: false },
        },
      ],
    };
    mockApi.get.mockResolvedValue(refreshed);
    await act(() => refreshModelCatalog());
    expect(result.current.models).toHaveLength(4);

    // The superseded initial request finally resolves with the stale catalog.
    await act(async () => { resolveInitial(MOCK_CATALOG); });

    // The fresh catalog wins in the mounted hook…
    expect(result.current.models).toHaveLength(4);
    // …and in the cache later mounts seed from (no third fetch).
    const second = renderHook(() => useModels());
    expect(second.result.current.models).toHaveLength(4);
    expect(mockApi.get).toHaveBeenCalledTimes(2);
  });

  it("stops receiving catalog refreshes after unmount", async () => {
    mockApi.get.mockResolvedValue(MOCK_CATALOG);
    const { result, unmount } = renderHook(() => useModels());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    unmount();

    const refreshed: ModelCatalogResponse = { ...MOCK_CATALOG, models: [] };
    mockApi.get.mockResolvedValue(refreshed);
    await act(() => refreshModelCatalog());

    // The unmounted hook kept its last render; no update (or React warning) fired.
    expect(result.current.models).toHaveLength(3);
  });

  it("seeds synchronously from the cache on a remount (no second fetch)", async () => {
    mockApi.get.mockResolvedValue(MOCK_CATALOG);
    const first = renderHook(() => useModels());
    await waitFor(() => expect(first.result.current.isLoading).toBe(false));
    expect(mockApi.get).toHaveBeenCalledTimes(1);

    // Simulate a fresh mount (e.g. ChatInput remounted on session switch).
    const second = renderHook(() => useModels(undefined, "claude:sonnet-4-6"));
    expect(second.result.current.isLoading).toBe(false);
    expect(second.result.current.selectedModelId).toBe("claude:sonnet-4-6");
    expect(mockApi.get).toHaveBeenCalledTimes(1); // still cached
  });
});
