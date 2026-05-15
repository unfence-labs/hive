import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  useCreateSkill,
  useDeleteSkill,
  useSkill,
  useSkills,
  useSyncMissingSkills,
  useSyncSkill,
  useUpdateSkill,
} from "@/hooks/useSkills";
import { api } from "@/hooks/useApi";
import type { SkillDetail, SkillSummary } from "@/types";
import { createWrapper } from "../test-utils";

vi.mock("@/hooks/useApi", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

function makeSkill(overrides: Partial<SkillSummary> = {}): SkillSummary {
  return {
    id: "reviewer",
    name: "reviewer",
    folderName: "reviewer",
    description: "Review code",
    userInvocable: true,
    syncStatus: "linked",
    providers: {
      claude: { present: true, path: "/home/me/.claude/skills/reviewer", isSymlink: true },
      codex: { present: true, path: "/home/me/.agents/skills/reviewer", isSymlink: false },
    },
    ...overrides,
  };
}

function makeDetail(overrides: Partial<SkillDetail> = {}): SkillDetail {
  const summary = makeSkill(overrides);
  return {
    ...summary,
    content: "---\nname: reviewer\n---\n# Reviewer\n",
    contentProvider: "codex",
    providerContents: {
      codex: "---\nname: reviewer\n---\n# Reviewer\n",
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useSkills", () => {
  it("fetches skills from the settings API", async () => {
    const response = { skills: [makeSkill()] };
    vi.mocked(api.get).mockResolvedValueOnce(response);

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useSkills(), { wrapper });

    await waitFor(() => {
      expect(result.current.data).toEqual(response);
    });

    expect(api.get).toHaveBeenCalledWith("/api/settings/skills");
  });
});

describe("useSkill", () => {
  it("fetches one skill by id", async () => {
    const detail = makeDetail();
    vi.mocked(api.get).mockResolvedValueOnce(detail);

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useSkill("reviewer"), { wrapper });

    await waitFor(() => {
      expect(result.current.data).toEqual(detail);
    });

    expect(api.get).toHaveBeenCalledWith("/api/settings/skills/reviewer");
  });
});

describe("useUpdateSkill", () => {
  it("puts updated content and invalidates the skills list", async () => {
    vi.mocked(api.put).mockResolvedValueOnce(makeDetail({ content: "# New" }));

    const { wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useUpdateSkill(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ id: "reviewer", content: "# New" });
    });

    expect(api.put).toHaveBeenCalledWith("/api/settings/skills/reviewer", { content: "# New" });
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["settings", "skills"] }),
    );
  });
});

describe("useCreateSkill", () => {
  it("posts a new skill and invalidates the skills list", async () => {
    vi.mocked(api.post).mockResolvedValueOnce(makeDetail());

    const { wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useCreateSkill(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ content: "# New" });
    });

    expect(api.post).toHaveBeenCalledWith("/api/settings/skills", { content: "# New" });
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["settings", "skills"] }),
    );
  });
});

describe("useSyncSkill", () => {
  it("posts to the single-skill sync endpoint", async () => {
    vi.mocked(api.post).mockResolvedValueOnce(makeDetail());

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useSyncSkill(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync("reviewer");
    });

    expect(api.post).toHaveBeenCalledWith("/api/settings/skills/reviewer/sync");
  });
});

describe("useDeleteSkill", () => {
  it("deletes a skill and invalidates the skills list", async () => {
    vi.mocked(api.delete).mockResolvedValueOnce(undefined);

    const { wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useDeleteSkill(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync("reviewer");
    });

    expect(api.delete).toHaveBeenCalledWith("/api/settings/skills/reviewer");
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["settings", "skills"] }),
    );
  });
});

describe("useSyncMissingSkills", () => {
  it("posts to the bulk missing sync endpoint", async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ skills: [makeSkill()], syncedCount: 1 });

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useSyncMissingSkills(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync();
    });

    expect(api.post).toHaveBeenCalledWith("/api/settings/skills/sync-missing");
  });
});
