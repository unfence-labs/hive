import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  useDeleteInstructions,
  useInstructions,
  useSyncInstructions,
  useUpdateInstructions,
} from "@/hooks/useInstructions";
import { api } from "@/hooks/useApi";
import type { InstructionDetail } from "@/types";
import { createWrapper } from "../test-utils";

vi.mock("@/hooks/useApi", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

function makeInstructions(overrides: Partial<InstructionDetail> = {}): InstructionDetail {
  return {
    content: "# Global\n",
    contentProvider: "codex",
    syncStatus: "linked",
    providers: {
      claude: { present: true, path: "/home/me/.claude/CLAUDE.md", isSymlink: true },
      codex: { present: true, path: "/home/me/.codex/AGENTS.md", isSymlink: false },
    },
    providerContents: {
      codex: "# Global\n",
    },
    override: {
      present: false,
      active: false,
      path: "/home/me/.codex/AGENTS.override.md",
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useInstructions", () => {
  it("fetches global instructions from the settings API", async () => {
    const response = makeInstructions();
    vi.mocked(api.get).mockResolvedValueOnce(response);

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useInstructions(), { wrapper });

    await waitFor(() => {
      expect(result.current.data).toEqual(response);
    });

    expect(api.get).toHaveBeenCalledWith("/api/settings/instructions");
  });
});

describe("useUpdateInstructions", () => {
  it("puts updated content and invalidates instructions", async () => {
    vi.mocked(api.put).mockResolvedValueOnce(makeInstructions({ content: "# New\n" }));

    const { wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useUpdateInstructions(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ content: "# New\n" });
    });

    expect(api.put).toHaveBeenCalledWith("/api/settings/instructions", { content: "# New\n" });
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["settings", "instructions"] }),
    );
  });
});

describe("useSyncInstructions", () => {
  it("posts to the instructions sync endpoint", async () => {
    vi.mocked(api.post).mockResolvedValueOnce(makeInstructions());

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useSyncInstructions(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync();
    });

    expect(api.post).toHaveBeenCalledWith("/api/settings/instructions/sync");
  });
});

describe("useDeleteInstructions", () => {
  it("deletes instructions and invalidates the query", async () => {
    vi.mocked(api.delete).mockResolvedValueOnce(undefined);

    const { wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useDeleteInstructions(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync();
    });

    expect(api.delete).toHaveBeenCalledWith("/api/settings/instructions");
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["settings", "instructions"] }),
    );
  });
});
