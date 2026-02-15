import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useProjects } from "@/hooks/useProjects";
import { api } from "@/hooks/useApi";
import { useResource } from "@/hooks/useResource";
import type { Project, Workspace } from "@/types";

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

function makeWorkspace(id: string): Workspace {
  return {
    id,
    name: `ws-${id}`,
    branch: `workspace/ws-${id}`,
    status: "idle",
    createdAt: "2026-02-11T00:00:00.000Z",
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

  it("creates workspace and appends it to the project state", async () => {
    const created = makeWorkspace("w1");
    vi.mocked(api.post).mockResolvedValueOnce(created);

    const { result } = renderHook(() => useProjects());
    const returned = await result.current.createWorkspace("p1");

    expect(returned).toEqual(created);
    expect(api.post).toHaveBeenCalledWith("/api/projects/p1/workspaces");
    expect(setData).toHaveBeenCalledTimes(1);

    const updater = setData.mock.calls[0]?.[0] as (prev: Project[]) => Project[];
    const updated = updater([makeProject("p1"), makeProject("p2")]);
    expect(updated[0]?.workspaces).toEqual([created]);
    expect(updated[1]?.workspaces).toEqual([]);
  });

  it("creates project and workspace in one flow", async () => {
    const createdProject = makeProject("p2");
    const createdWorkspace = makeWorkspace("w2");
    vi.mocked(api.post)
      .mockResolvedValueOnce(createdProject)
      .mockResolvedValueOnce(createdWorkspace);

    const { result } = renderHook(() => useProjects());
    const returned = await result.current.createProjectWithWorkspace(createdProject.url);

    expect(returned).toEqual(createdWorkspace);
    expect(api.post).toHaveBeenNthCalledWith(1, "/api/projects", { url: createdProject.url });
    expect(api.post).toHaveBeenNthCalledWith(2, "/api/projects/p2/workspaces");
    expect(setData).toHaveBeenCalledTimes(2);

    const appendProject = setData.mock.calls[0]?.[0] as (prev: Project[]) => Project[];
    const appendWorkspace = setData.mock.calls[1]?.[0] as (prev: Project[]) => Project[];
    const withProject = appendProject([makeProject("p1")]);
    const withWorkspace = appendWorkspace(withProject);

    expect(withProject).toEqual([makeProject("p1"), createdProject]);
    expect(withWorkspace[1]?.workspaces).toEqual([createdWorkspace]);
  });

  it("archives workspace and removes it from project state", async () => {
    vi.mocked(api.post).mockResolvedValueOnce(undefined);

    const project = makeProject("p1");
    project.workspaces = [makeWorkspace("w1"), makeWorkspace("w2")];
    vi.mocked(useResource).mockReturnValue({
      data: [project],
      loading: false,
      error: null,
      refresh: vi.fn(),
      setData,
    });

    const { result } = renderHook(() => useProjects());
    await result.current.archiveWorkspace("w1");

    expect(api.post).toHaveBeenCalledWith("/api/workspaces/w1/archive");
    expect(setData).toHaveBeenCalledTimes(1);

    const updater = setData.mock.calls[0]?.[0] as (prev: Project[]) => Project[];
    const updated = updater([project]);
    expect(updated[0]?.workspaces).toHaveLength(1);
    expect(updated[0]?.workspaces[0]?.id).toBe("w2");
  });

  it("archive only removes workspace from its parent project", async () => {
    vi.mocked(api.post).mockResolvedValueOnce(undefined);

    const p1 = makeProject("p1");
    p1.workspaces = [makeWorkspace("w1")];
    const p2 = makeProject("p2");
    p2.workspaces = [makeWorkspace("w2")];

    const { result } = renderHook(() => useProjects());
    await result.current.archiveWorkspace("w1");

    const updater = setData.mock.calls[0]?.[0] as (prev: Project[]) => Project[];
    const updated = updater([p1, p2]);
    expect(updated[0]?.workspaces).toHaveLength(0);
    expect(updated[1]?.workspaces).toHaveLength(1);
  });

  it("rolls back project when workspace creation fails", async () => {
    const createdProject = makeProject("p2");
    const createWorkspaceError = new Error("workspace failed");
    vi.mocked(api.post)
      .mockResolvedValueOnce(createdProject)
      .mockRejectedValueOnce(createWorkspaceError);
    vi.mocked(api.delete).mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useProjects());

    await expect(result.current.createProjectWithWorkspace(createdProject.url)).rejects.toThrow(
      "workspace failed",
    );
    expect(api.post).toHaveBeenNthCalledWith(1, "/api/projects", { url: createdProject.url });
    expect(api.post).toHaveBeenNthCalledWith(2, "/api/projects/p2/workspaces");
    expect(api.delete).toHaveBeenCalledWith("/api/projects/p2");
    expect(setData).toHaveBeenCalledTimes(2);

    const appendProject = setData.mock.calls[0]?.[0] as (prev: Project[]) => Project[];
    const rollbackProject = setData.mock.calls[1]?.[0] as (prev: Project[]) => Project[];
    const withProject = appendProject([makeProject("p1")]);
    const rolledBack = rollbackProject(withProject);

    expect(withProject).toEqual([makeProject("p1"), createdProject]);
    expect(rolledBack).toEqual([makeProject("p1")]);
  });
});
