import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  useCreateCustomAgent,
  useCreateCustomAgentCounterpart,
  useCustomAgent,
  useCustomAgents,
  useDeleteCustomAgentProvider,
  useUpdateCustomAgentProvider,
} from "@/hooks/useCustomAgents";
import { api } from "@/hooks/useApi";
import type { CustomAgentDetail, CustomAgentSummary } from "@/types";
import { createWrapper } from "../test-utils";

vi.mock("@/hooks/useApi", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

function makeAgent(overrides: Partial<CustomAgentSummary> = {}): CustomAgentSummary {
  return {
    id: "reviewer",
    name: "reviewer",
    description: "Review code",
    status: "claude_only",
    providers: {
      claude: { present: true, path: "/home/me/.claude/agents/reviewer.md", isSymlink: false },
      codex: { present: false, path: "/home/me/.codex/agents/reviewer.toml" },
    },
    ...overrides,
  };
}

function makeDetail(overrides: Partial<CustomAgentDetail> = {}): CustomAgentDetail {
  const summary = makeAgent(overrides);
  return {
    ...summary,
    contents: {
      claude: "---\nname: reviewer\n---\n# Reviewer\n",
    },
    manifests: {
      claude: {
        name: "reviewer",
        description: "Review code",
        developerInstructions: "# Reviewer",
      },
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useCustomAgents", () => {
  it("fetches custom agents from the settings API", async () => {
    const response = { agents: [makeAgent()] };
    vi.mocked(api.get).mockResolvedValueOnce(response);

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCustomAgents(), { wrapper });

    await waitFor(() => {
      expect(result.current.data).toEqual(response);
    });

    expect(api.get).toHaveBeenCalledWith("/api/settings/custom-agents");
  });
});

describe("useCustomAgent", () => {
  it("fetches one custom agent by id", async () => {
    const detail = makeDetail();
    vi.mocked(api.get).mockResolvedValueOnce(detail);

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCustomAgent("reviewer"), { wrapper });

    await waitFor(() => {
      expect(result.current.data).toEqual(detail);
    });

    expect(api.get).toHaveBeenCalledWith("/api/settings/custom-agents/reviewer");
  });
});

describe("useCreateCustomAgent", () => {
  it("posts a new provider-native custom agent", async () => {
    vi.mocked(api.post).mockResolvedValueOnce(makeDetail());

    const { wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useCreateCustomAgent(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        provider: "claude",
        content: "---\nname: reviewer\n---\n# Reviewer\n",
      });
    });

    expect(api.post).toHaveBeenCalledWith("/api/settings/custom-agents", {
      provider: "claude",
      content: "---\nname: reviewer\n---\n# Reviewer\n",
    });
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["settings", "custom-agents"] }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["completions"] }),
    );
  });
});

describe("useUpdateCustomAgentProvider", () => {
  it("keeps the old summary when renaming one provider from a two-provider agent", async () => {
    const existing = makeAgent({
      status: "both",
      providers: {
        claude: { present: true, path: "/home/me/.claude/agents/reviewer.md" },
        codex: { present: true, path: "/home/me/.codex/agents/reviewer.toml" },
      },
    });
    const renamed = makeDetail({
      id: "auditor",
      name: "auditor",
      status: "claude_only",
      providers: {
        claude: { present: true, path: "/home/me/.claude/agents/auditor.md" },
        codex: { present: false, path: "/home/me/.codex/agents/auditor.toml" },
      },
    });
    vi.mocked(api.put).mockResolvedValueOnce(renamed);

    const { wrapper, queryClient } = createWrapper();
    queryClient.setQueryData(["settings", "custom-agents"], { agents: [existing] });
    const { result } = renderHook(() => useUpdateCustomAgentProvider(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        id: "reviewer",
        provider: "claude",
        content: "---\nname: auditor\n---\n# Auditor\n",
      });
    });

    expect(api.put).toHaveBeenCalledWith(
      "/api/settings/custom-agents/reviewer/providers/claude",
      { content: "---\nname: auditor\n---\n# Auditor\n" },
    );
    expect(queryClient.getQueryData(["settings", "custom-agents"])).toEqual({
      agents: [
        expect.objectContaining({ id: "auditor", status: "claude_only" }),
        expect.objectContaining({
          id: "reviewer",
          status: "codex_only",
          providers: expect.objectContaining({
            claude: expect.objectContaining({ present: false }),
            codex: expect.objectContaining({ present: true }),
          }),
        }),
      ],
    });
  });
});

describe("useDeleteCustomAgentProvider", () => {
  it("keeps invalid status when deleting the valid side of an invalid two-provider agent", async () => {
    vi.mocked(api.delete).mockResolvedValueOnce(undefined);

    const { wrapper, queryClient } = createWrapper();
    queryClient.setQueryData(["settings", "custom-agents"], {
      agents: [
        makeAgent({
          status: "invalid",
          invalidReason: "developer_instructions is required",
          providers: {
            claude: { present: true, path: "/home/me/.claude/agents/reviewer.md" },
            codex: {
              present: true,
              path: "/home/me/.codex/agents/reviewer.toml",
              error: "developer_instructions is required",
            },
          },
        }),
      ],
    });
    const { result } = renderHook(() => useDeleteCustomAgentProvider(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ id: "reviewer", provider: "claude" });
    });

    expect(api.delete).toHaveBeenCalledWith("/api/settings/custom-agents/reviewer/providers/claude");
    expect(queryClient.getQueryData(["settings", "custom-agents"])).toEqual({
      agents: [
        expect.objectContaining({
          id: "reviewer",
          status: "invalid",
          invalidReason: "developer_instructions is required",
        }),
      ],
    });
  });
});

describe("useCreateCustomAgentCounterpart", () => {
  it("posts to the provider counterpart endpoint", async () => {
    vi.mocked(api.post).mockResolvedValueOnce(makeDetail({ status: "both" }));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCreateCustomAgentCounterpart(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ id: "reviewer", provider: "codex" });
    });

    expect(api.post).toHaveBeenCalledWith(
      "/api/settings/custom-agents/reviewer/providers/codex/counterpart",
    );
  });
});
