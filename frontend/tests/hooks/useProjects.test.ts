import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useProjects } from "@/hooks/useProjects";
import { api } from "@/hooks/useApi";
import { useResource } from "@/hooks/useResource";
import type { Project } from "@/types";

vi.mock("@/hooks/useApi", () => ({
  api: {
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("@/hooks/useResource", () => ({
  useResource: vi.fn(),
}));

function makeProject(id: string): Project {
  return {
    id,
    name: `project-${id}`,
    url: "https://github.com/acme/repo.git",
    createdAt: "2026-02-11T00:00:00.000Z",
    workspaces: [],
  };
}

describe("useProjects", () => {
  const setData = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useResource).mockReturnValue({
      data: [makeProject("p1")],
      loading: false,
      error: null,
      refresh: vi.fn(),
      setData,
    });
  });

  it("creates project and appends it to local state", async () => {
    const created = makeProject("p2");
    vi.mocked(api.post).mockResolvedValueOnce(created);

    const { result } = renderHook(() => useProjects());
    const returned = await result.current.createProject(created.url);

    expect(returned).toEqual(created);
    expect(api.post).toHaveBeenCalledWith("/api/projects", { url: created.url });
    expect(setData).toHaveBeenCalledTimes(1);

    const updater = setData.mock.calls[0]?.[0] as (prev: Project[]) => Project[];
    expect(updater([makeProject("p1")])).toEqual([makeProject("p1"), created]);
  });

  it("deletes project and removes it from local state", async () => {
    const { result } = renderHook(() => useProjects());
    await result.current.deleteProject("p1");

    expect(api.delete).toHaveBeenCalledWith("/api/projects/p1");
    expect(setData).toHaveBeenCalledTimes(1);

    const updater = setData.mock.calls[0]?.[0] as (prev: Project[]) => Project[];
    expect(updater([makeProject("p1"), makeProject("p2")]).map((p) => p.id)).toEqual(["p2"]);
  });
});
