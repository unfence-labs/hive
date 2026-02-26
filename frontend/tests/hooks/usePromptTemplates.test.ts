import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  usePromptTemplates,
  useCreatePromptTemplate,
  useUpdatePromptTemplate,
  useDeletePromptTemplate,
} from "@/hooks/usePromptTemplates";
import { api } from "@/hooks/useApi";
import type { PromptTemplate } from "@/types";
import { createWrapper } from "../test-utils";

vi.mock("@/hooks/useApi", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

function makeTemplate(overrides: Partial<PromptTemplate> = {}): PromptTemplate {
  return {
    id: "tpl-1",
    name: "Test Template",
    type: "system",
    content: "You are helpful.",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("usePromptTemplates", () => {
  it("fetches templates from the API", async () => {
    const templates = [makeTemplate(), makeTemplate({ id: "tpl-2", name: "User Prompt", type: "user" })];
    vi.mocked(api.get).mockResolvedValueOnce(templates);

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePromptTemplates(), { wrapper });

    await waitFor(() => {
      expect(result.current.data).toEqual(templates);
    });

    expect(api.get).toHaveBeenCalledWith("/api/prompt-templates");
  });

  it("returns undefined while loading", () => {
    vi.mocked(api.get).mockReturnValueOnce(new Promise(() => {}));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePromptTemplates(), { wrapper });

    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(true);
  });

  it("handles empty template list", async () => {
    vi.mocked(api.get).mockResolvedValueOnce([]);

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePromptTemplates(), { wrapper });

    await waitFor(() => {
      expect(result.current.data).toEqual([]);
    });
  });
});

describe("useCreatePromptTemplate", () => {
  it("posts to the templates endpoint", async () => {
    const created = makeTemplate();
    vi.mocked(api.post).mockResolvedValueOnce(created);

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCreatePromptTemplate(), { wrapper });

    const payload = { name: "New", type: "user" as const, content: "Do something" };
    await act(async () => {
      await result.current.mutateAsync(payload);
    });

    expect(api.post).toHaveBeenCalledWith("/api/prompt-templates", payload);
  });

  it("invalidates prompt-templates query on success", async () => {
    vi.mocked(api.post).mockResolvedValueOnce(makeTemplate());

    const { wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useCreatePromptTemplate(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ name: "X", type: "system" as const, content: "y" });
    });

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["prompt-templates"] }),
    );
  });
});

describe("useUpdatePromptTemplate", () => {
  it("puts to the correct endpoint", async () => {
    vi.mocked(api.put).mockResolvedValueOnce(makeTemplate({ name: "Renamed" }));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdatePromptTemplate(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ id: "tpl-1", name: "Renamed" });
    });

    expect(api.put).toHaveBeenCalledWith("/api/prompt-templates/tpl-1", { name: "Renamed" });
  });

  it("invalidates prompt-templates query on success", async () => {
    vi.mocked(api.put).mockResolvedValueOnce(makeTemplate());

    const { wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useUpdatePromptTemplate(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ id: "tpl-1", content: "new" });
    });

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["prompt-templates"] }),
    );
  });
});

describe("useDeletePromptTemplate", () => {
  it("sends DELETE to the correct endpoint", async () => {
    vi.mocked(api.delete).mockResolvedValueOnce(undefined);

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDeletePromptTemplate(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync("tpl-1");
    });

    expect(api.delete).toHaveBeenCalledWith("/api/prompt-templates/tpl-1");
  });

  it("invalidates prompt-templates query on success", async () => {
    vi.mocked(api.delete).mockResolvedValueOnce(undefined);

    const { wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useDeletePromptTemplate(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync("tpl-1");
    });

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["prompt-templates"] }),
    );
  });

  it("handles API error gracefully", async () => {
    vi.mocked(api.delete).mockRejectedValueOnce(new Error("409: Referenced by automation"));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDeletePromptTemplate(), { wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync("tpl-1")).rejects.toThrow("409");
    });
  });
});
