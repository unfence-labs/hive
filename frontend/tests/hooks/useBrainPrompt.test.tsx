import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  useBrainPrompt,
  useUpdateBrainPrompt,
  useResetBrainPrompt,
} from "@/hooks/useBrainPrompt";
import {
  useBasePrompt,
  useUpdateBasePrompt,
  useResetBasePrompt,
} from "@/hooks/useBasePrompt";
import { api } from "@/hooks/useApi";
import type { BasePromptData } from "@/types";
import { createWrapper } from "../test-utils";

vi.mock("@/hooks/useApi", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

function makePromptData(overrides: Partial<BasePromptData> = {}): BasePromptData {
  return {
    content: "You are the Brain agent.",
    isDefault: true,
    defaultContent: "You are the Brain agent.",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useBrainPrompt", () => {
  it("fetches the brain prompt from the brain endpoint", async () => {
    const data = makePromptData();
    vi.mocked(api.get).mockResolvedValueOnce(data);

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useBrainPrompt(), { wrapper });

    await waitFor(() => {
      expect(result.current.data).toEqual(data);
    });

    expect(api.get).toHaveBeenCalledWith("/api/prompts/brain");
  });
});

describe("useUpdateBrainPrompt", () => {
  it("puts content to the brain endpoint and seeds the cache", async () => {
    const updated = makePromptData({ content: "Custom brain", isDefault: false });
    vi.mocked(api.put).mockResolvedValueOnce(updated);

    const { wrapper, queryClient } = createWrapper();
    const { result } = renderHook(() => useUpdateBrainPrompt(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync("Custom brain");
    });

    expect(api.put).toHaveBeenCalledWith("/api/prompts/brain", {
      content: "Custom brain",
    });
    expect(queryClient.getQueryData(["brain-prompt"])).toEqual(updated);
  });
});

describe("useResetBrainPrompt", () => {
  it("deletes the brain prompt and invalidates the query", async () => {
    vi.mocked(api.delete).mockResolvedValueOnce(undefined);

    const { wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useResetBrainPrompt(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync();
    });

    expect(api.delete).toHaveBeenCalledWith("/api/prompts/brain");
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["brain-prompt"] }),
    );
  });
});

describe("base prompt hooks (shared factory)", () => {
  it("base hooks still target the base endpoint", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(makePromptData());
    vi.mocked(api.put).mockResolvedValueOnce(makePromptData({ isDefault: false }));
    vi.mocked(api.delete).mockResolvedValueOnce(undefined);

    const { wrapper } = createWrapper();
    const { result: query } = renderHook(() => useBasePrompt(), { wrapper });
    await waitFor(() => expect(query.current.data).toBeDefined());
    expect(api.get).toHaveBeenCalledWith("/api/prompts/base");

    const { result: update } = renderHook(() => useUpdateBasePrompt(), { wrapper });
    await act(async () => {
      await update.current.mutateAsync("x");
    });
    expect(api.put).toHaveBeenCalledWith("/api/prompts/base", { content: "x" });

    const { result: reset } = renderHook(() => useResetBasePrompt(), { wrapper });
    await act(async () => {
      await reset.current.mutateAsync();
    });
    expect(api.delete).toHaveBeenCalledWith("/api/prompts/base");
  });
});
