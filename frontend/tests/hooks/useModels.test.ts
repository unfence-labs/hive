import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useModels } from "@/hooks/useModels";
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
      capabilities: { thinkingLevels: ["low", "medium", "high", "xhigh", "max"], planMode: true, blockingTools: true, completions: true },
    },
    {
      id: "claude:sonnet-4-6",
      label: "Sonnet 4.6",
      provider: "claude",
      providerLabel: "Claude Code",
      isNew: true,
      capabilities: { thinkingLevels: ["low", "medium", "high", "xhigh", "max"], planMode: true, blockingTools: true, completions: true },
    },
    {
      id: "codex:gpt-5.3-codex",
      label: "GPT-5.3-Codex",
      provider: "codex",
      providerLabel: "Codex",
      isDefault: true,
      capabilities: { thinkingLevels: ["none", "minimal", "low", "medium", "high", "xhigh"], planMode: false, blockingTools: false, completions: false },
    },
  ],
  defaultModelId: "claude:opus-4-7",
};

beforeEach(() => {
  vi.clearAllMocks();
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
    expect(result.current.defaultModelId).toBe("claude:opus-4-7");
    expect(result.current.selectedModelId).toBe("claude:opus-4-7");
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
    expect(result.current.selectedModelId).toBe("claude:opus-4-7");
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
    expect(result.current.selectedModel?.id).toBe("claude:opus-4-7");
    expect(result.current.selectedModel?.label).toBe("Opus 4.7");
  });

  it("returns capabilities of the selected model", async () => {
    mockApi.get.mockResolvedValue(MOCK_CATALOG);
    const { result } = renderHook(() => useModels());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.capabilities).toEqual({
      thinkingLevels: ["low", "medium", "high", "xhigh", "max"],
      planMode: true,
      blockingTools: true,
      completions: true,
    });

    act(() => {
      result.current.setSelectedModelId("codex:gpt-5.3-codex");
    });

    expect(result.current.capabilities).toEqual({
      thinkingLevels: ["none", "minimal", "low", "medium", "high", "xhigh"],
      planMode: false,
      blockingTools: false,
      completions: false,
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

    expect(result.current.selectedModelId).toBe("codex:gpt-5.3-codex");
    expect(result.current.selectedModel?.provider).toBe("codex");
  });

  it("falls back to global default when lockedProvider has no models", async () => {
    mockApi.get.mockResolvedValue(MOCK_CATALOG);
    const { result } = renderHook(() => useModels("unknown-provider"));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.selectedModelId).toBe("claude:opus-4-7");
  });
});
