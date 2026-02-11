import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { api } from "@/hooks/useApi";
import { useResource } from "@/hooks/useResource";
import type { Workspace } from "@/types";

vi.mock("@/hooks/useApi", () => ({
  api: {
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("@/hooks/useResource", () => ({
  useResource: vi.fn(),
}));

function makeWorkspace(id: string): Workspace {
  return {
    id,
    name: `workspace-${id}`,
    branch: `workspace/${id}`,
    status: "idle",
    createdAt: "2026-02-11T00:00:00.000Z",
  };
}

describe("useWorkspaces", () => {
  const setData = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useResource).mockReturnValue({
      data: [makeWorkspace("w1")],
      loading: false,
      error: null,
      refresh: vi.fn(),
      setData,
    });
  });

  it("builds null URL when project id is missing", () => {
    renderHook(() => useWorkspaces(undefined));

    expect(useResource).toHaveBeenCalledWith(null);
  });

  it("creates workspace and appends it to local state", async () => {
    const created = makeWorkspace("w2");
    vi.mocked(api.post).mockResolvedValueOnce(created);

    const { result } = renderHook(() => useWorkspaces("p1"));
    const returned = await result.current.createWorkspace();

    expect(returned).toEqual(created);
    expect(api.post).toHaveBeenCalledWith("/api/projects/p1/workspaces");
    expect(setData).toHaveBeenCalledTimes(1);

    const updater = setData.mock.calls[0]?.[0] as (prev: Workspace[]) => Workspace[];
    expect(updater([makeWorkspace("w1")]).map((w) => w.id)).toEqual(["w1", "w2"]);
  });

  it("does not create workspace when project id is missing", async () => {
    const { result } = renderHook(() => useWorkspaces(undefined));
    const created = await result.current.createWorkspace();

    expect(created).toBeUndefined();
    expect(api.post).not.toHaveBeenCalled();
    expect(setData).not.toHaveBeenCalled();
  });

  it("deletes workspace and removes it from local state", async () => {
    const { result } = renderHook(() => useWorkspaces("p1"));
    await result.current.deleteWorkspace("w1");

    expect(api.delete).toHaveBeenCalledWith("/api/workspaces/w1");
    expect(setData).toHaveBeenCalledTimes(1);

    const updater = setData.mock.calls[0]?.[0] as (prev: Workspace[]) => Workspace[];
    expect(updater([makeWorkspace("w1"), makeWorkspace("w2")]).map((w) => w.id)).toEqual(["w2"]);
  });
});
