import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { toast } from "sonner";
import { useProjects } from "@/hooks/useProjects";
import { api } from "@/hooks/useApi";
import { createWrapper } from "../test-utils";
import type { Project, Workspace } from "@/types";

vi.mock("@/hooks/useApi", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

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
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("fetches projects on mount", async () => {
    vi.mocked(api.get).mockResolvedValueOnce([makeProject("p1")]);
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useProjects(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.projects).toEqual([makeProject("p1")]);
    expect(result.current.ready).toBe(true);
    expect(api.get).toHaveBeenCalledWith(
      "/api/projects",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  // Regression: consumers that do destructive work against `projects` (e.g.
  // sidebar-folder sanitize) must gate on `ready`, not on `!loading`. A failed
  // first fetch leaves `loading=false` with `projects=[]` — treating that as
  // "ready" wipes every folder.projectIds downstream.
  it("ready stays false when the initial fetch fails", async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error("boom"));
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useProjects(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.projects).toEqual([]);
    expect(result.current.ready).toBe(false);
  });

  it("retries automatically after an initial fetch failure", async () => {
    vi.useFakeTimers();
    vi.mocked(api.get)
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce([makeProject("p1")]);

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useProjects(), { wrapper });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(result.current.errorMessage).toBe("boom");
    expect(result.current.unavailable).toBe(true);

    await act(async () => {
      for (let i = 0; i < 5 && !result.current.ready; i += 1) {
        await vi.advanceTimersByTimeAsync(1_000);
      }
    });

    expect(result.current.ready).toBe(true);
    expect(result.current.projects).toEqual([makeProject("p1")]);
  });

  it("times out a hung initial fetch and marks projects as unavailable", async () => {
    vi.useFakeTimers();
    vi.mocked(api.get).mockImplementation(
      () => new Promise<Project[]>(() => {}),
    );

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useProjects(), { wrapper });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      for (let i = 0; i < 12 && !result.current.unavailable; i += 1) {
        await vi.advanceTimersByTimeAsync(1_000);
      }
    });

    vi.useRealTimers();
    await waitFor(() => expect(result.current.unavailable).toBe(true));
    expect(result.current.errorMessage).toBe("The server took too long to respond.");
    expect(result.current.ready).toBe(false);
  });

  it("creates workspace and appends it to the project cache", async () => {
    vi.mocked(api.get).mockResolvedValueOnce([makeProject("p1")]);
    const created = makeWorkspace("w1");
    vi.mocked(api.post).mockResolvedValueOnce(created);

    const { queryClient, wrapper } = createWrapper();
    const { result } = renderHook(() => useProjects(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.createWorkspace("p1");
    });

    expect(api.post).toHaveBeenCalledWith("/api/projects/p1/workspaces");
    const cached = queryClient.getQueryData<Project[]>(["projects"]);
    expect(cached?.[0]?.workspaces).toEqual([created]);
  });

  it("deletes project and removes it from cache", async () => {
    vi.mocked(api.get).mockResolvedValueOnce([makeProject("p1"), makeProject("p2")]);
    vi.mocked(api.delete).mockResolvedValueOnce(undefined);

    const { queryClient, wrapper } = createWrapper();
    const { result } = renderHook(() => useProjects(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.deleteProject("p1");
    });

    expect(api.delete).toHaveBeenCalledWith("/api/projects/p1");
    const cached = queryClient.getQueryData<Project[]>(["projects"]);
    expect(cached?.map((p) => p.id)).toEqual(["p2"]);
  });

  it("creates project and workspace in one flow", async () => {
    vi.mocked(api.get).mockResolvedValueOnce([makeProject("p1")]);
    const createdProject = makeProject("p2");
    const createdWorkspace = makeWorkspace("w2");
    vi.mocked(api.post)
      .mockResolvedValueOnce(createdProject)
      .mockResolvedValueOnce(createdWorkspace);

    const { queryClient, wrapper } = createWrapper();
    const { result } = renderHook(() => useProjects(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    let returned: Workspace | undefined;
    await act(async () => {
      returned = await result.current.createProjectWithWorkspace(createdProject.url);
    });

    expect(returned).toEqual(createdWorkspace);
    expect(api.post).toHaveBeenNthCalledWith(1, "/api/projects", { url: createdProject.url });
    expect(api.post).toHaveBeenNthCalledWith(2, "/api/projects/p2/workspaces");

    const cached = queryClient.getQueryData<Project[]>(["projects"]);
    expect(cached).toHaveLength(2);
    expect(cached?.[1]?.workspaces).toEqual([createdWorkspace]);
  });

  it("archives workspace and keeps it out of the cache once the POST resolves", async () => {
    const project = makeProject("p1");
    project.workspaces = [makeWorkspace("w1"), makeWorkspace("w2")];
    vi.mocked(api.get).mockResolvedValueOnce([project]);
    vi.mocked(api.post).mockResolvedValueOnce(undefined);

    const { queryClient, wrapper } = createWrapper();
    const { result } = renderHook(() => useProjects(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      result.current.archiveWorkspace("w1");
    });

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/api/workspaces/w1/archive"),
    );
    await waitFor(() => {
      const cached = queryClient.getQueryData<Project[]>(["projects"]);
      expect(cached?.[0]?.workspaces).toHaveLength(1);
      expect(cached?.[0]?.workspaces[0]?.id).toBe("w2");
    });
    expect(result.current.projects[0]?.workspaces.map((ws) => ws.id)).toEqual(["w2"]);
  });

  it("archive optimistically removes the workspace while the POST is in flight", async () => {
    const project = makeProject("p1");
    project.workspaces = [makeWorkspace("w1"), makeWorkspace("w2")];
    vi.mocked(api.get).mockResolvedValueOnce([project]);
    vi.mocked(api.post).mockImplementation(() => new Promise(() => {}));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useProjects(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      result.current.archiveWorkspace("w1");
      // React Query batches cache notifications on a macrotask; flush it so the
      // optimistic removal is observable without the POST ever resolving.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(result.current.projects[0]?.workspaces.map((ws) => ws.id)).toEqual(["w2"]);
  });

  it("archive restores the row locally and toasts once when the POST fails", async () => {
    const project = makeProject("p1");
    project.workspaces = [makeWorkspace("w1")];
    // Outage scenario: the reconciling refetch fails along with the POST, so
    // the rollback must come from the local re-insert, not the server.
    vi.mocked(api.get)
      .mockResolvedValueOnce([project])
      .mockRejectedValue(new Error("offline"));
    vi.mocked(api.post).mockRejectedValueOnce(new Error("archive failed"));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useProjects(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      result.current.archiveWorkspace("w1");
    });

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(toast.error).toHaveBeenCalledWith("archive failed");
    await waitFor(() =>
      expect(result.current.projects[0]?.workspaces.map((ws) => ws.id)).toEqual(["w1"]),
    );
  });

  it("preserves workspace order when concurrent archives fail", async () => {
    const project = makeProject("p1");
    project.workspaces = [makeWorkspace("w1"), makeWorkspace("w2"), makeWorkspace("w3")];
    vi.mocked(api.get)
      .mockResolvedValueOnce([project])
      .mockRejectedValue(new Error("offline"));
    let rejectW1!: (reason?: unknown) => void;
    let rejectW2!: (reason?: unknown) => void;
    vi.mocked(api.post).mockImplementation((url) => new Promise((_, reject) => {
      if (url === "/api/workspaces/w1/archive") rejectW1 = reject;
      if (url === "/api/workspaces/w2/archive") rejectW2 = reject;
    }));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useProjects(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.archiveWorkspace("w1");
      result.current.archiveWorkspace("w2");
    });

    await waitFor(() =>
      expect(result.current.projects[0]?.workspaces.map((ws) => ws.id)).toEqual(["w3"]),
    );

    act(() => {
      rejectW1(new Error("archive failed"));
      rejectW2(new Error("archive failed"));
    });

    await waitFor(() =>
      expect(result.current.projects[0]?.workspaces.map((ws) => ws.id)).toEqual([
        "w1",
        "w2",
        "w3",
      ]),
    );
  });

  it("archive only removes workspace from its parent project", async () => {
    const p1 = makeProject("p1");
    p1.workspaces = [makeWorkspace("w1")];
    const p2 = makeProject("p2");
    p2.workspaces = [makeWorkspace("w2")];
    vi.mocked(api.get).mockResolvedValueOnce([p1, p2]);
    vi.mocked(api.post).mockResolvedValueOnce(undefined);

    const { queryClient, wrapper } = createWrapper();
    const { result } = renderHook(() => useProjects(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      result.current.archiveWorkspace("w1");
    });

    await waitFor(() => {
      const cached = queryClient.getQueryData<Project[]>(["projects"]);
      expect(cached?.[0]?.workspaces).toHaveLength(0);
      expect(cached?.[1]?.workspaces).toHaveLength(1);
    });
  });

  it("rolls back project when workspace creation fails", async () => {
    vi.mocked(api.get).mockResolvedValueOnce([makeProject("p1")]);
    const createdProject = makeProject("p2");
    vi.mocked(api.post)
      .mockResolvedValueOnce(createdProject)
      .mockRejectedValueOnce(new Error("workspace failed"));
    vi.mocked(api.delete).mockResolvedValueOnce(undefined);

    const { queryClient, wrapper } = createWrapper();
    const { result } = renderHook(() => useProjects(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    let error: Error | undefined;
    await act(async () => {
      try {
        await result.current.createProjectWithWorkspace(createdProject.url);
      } catch (e) {
        error = e as Error;
      }
    });

    expect(error?.message).toBe("workspace failed");
    expect(api.delete).toHaveBeenCalledWith("/api/projects/p2");
    const cached = queryClient.getQueryData<Project[]>(["projects"]);
    expect(cached?.map((p) => p.id)).toEqual(["p1"]);
  });

  it("still rolls back when backend cleanup delete fails", async () => {
    vi.mocked(api.get).mockResolvedValueOnce([makeProject("p1")]);
    const createdProject = makeProject("p2");
    vi.mocked(api.post)
      .mockResolvedValueOnce(createdProject)
      .mockRejectedValueOnce(new Error("workspace failed"));
    vi.mocked(api.delete).mockRejectedValueOnce(new Error("delete failed"));

    const { queryClient, wrapper } = createWrapper();
    const { result } = renderHook(() => useProjects(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    let error: Error | undefined;
    await act(async () => {
      try {
        await result.current.createProjectWithWorkspace(createdProject.url);
      } catch (e) {
        error = e as Error;
      }
    });

    expect(error?.message).toBe("workspace failed");
    expect(api.delete).toHaveBeenCalledWith("/api/projects/p2");
    const cached = queryClient.getQueryData<Project[]>(["projects"]);
    expect(cached?.map((p) => p.id)).toEqual(["p1"]);
  });

  it("invalidates the project's picker sources after creating a workspace", async () => {
    vi.mocked(api.get).mockResolvedValueOnce([makeProject("p1")]);
    vi.mocked(api.post).mockResolvedValueOnce(makeWorkspace("w1"));

    const { queryClient, wrapper } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useProjects(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.createWorkspace("p1");
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["project-branches", "p1"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["project-pulls", "p1"] });
  });

  it("invalidates picker sources after archiving a workspace", async () => {
    const project = makeProject("p1");
    project.workspaces = [makeWorkspace("w1")];
    vi.mocked(api.get).mockResolvedValueOnce([project]);
    vi.mocked(api.post).mockResolvedValueOnce(undefined);

    const { queryClient, wrapper } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useProjects(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      result.current.archiveWorkspace("w1");
    });

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["project-branches"] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["project-pulls"] });
    });
  });

  it("invalidates projects query when fetchProjects is called", async () => {
    vi.mocked(api.get).mockResolvedValue([makeProject("p1")]);
    const { queryClient, wrapper } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useProjects(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.fetchProjects();
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["projects"] });
  });
});
