import { useCallback } from "react";
import { useQuery, useMutation, useMutationState, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "./useApi";
import type { CreateWorkspaceSource, Project, Workspace } from "@/types";

const PROJECTS_FETCH_TIMEOUT_MS = 10_000;
const PROJECTS_RECOVERY_INTERVAL_MS = 5_000;

function makeTimeoutError(message: string): Error {
  if (typeof DOMException === "function") {
    return new DOMException(message, "TimeoutError");
  }
  const error = new Error(message);
  error.name = "TimeoutError";
  return error;
}

function createLinkedAbortSignal(parentSignal?: AbortSignal): {
  abort: (reason?: unknown) => void;
  cleanup: () => void;
  signal: AbortSignal;
} {
  const controller = new AbortController();

  const abortFromParent = () => {
    controller.abort(parentSignal?.reason);
  };

  if (parentSignal?.aborted) {
    abortFromParent();
  } else if (parentSignal) {
    parentSignal.addEventListener("abort", abortFromParent, { once: true });
  }

  return {
    abort: (reason?: unknown) => controller.abort(reason),
    signal: controller.signal,
    cleanup: () => {
      parentSignal?.removeEventListener("abort", abortFromParent);
    },
  };
}

async function fetchProjects(signal?: AbortSignal): Promise<Project[]> {
  const {
    abort,
    signal: requestSignal,
    cleanup,
  } = createLinkedAbortSignal(signal);
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      const timeoutError = makeTimeoutError("Loading repositories timed out.");
      abort(timeoutError);
      reject(timeoutError);
    }, PROJECTS_FETCH_TIMEOUT_MS);
  });

  try {
    return await Promise.race([
      api.get<Project[]>("/api/projects", { signal: requestSignal }),
      timeoutPromise,
    ]);
  } catch (error) {
    if (!signal?.aborted && requestSignal.aborted && requestSignal.reason instanceof Error) {
      throw requestSignal.reason;
    }
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    cleanup();
  }
}

function formatProjectsError(error: unknown): string {
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return "The server took too long to respond.";
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return "Unable to load repositories.";
}

export function useProjects() {
  const queryClient = useQueryClient();

  /** Drop cached picker lists whose workspace annotations just changed. */
  function invalidateWorkspaceSources(projectId?: string) {
    for (const key of ["project-branches", "project-pulls"]) {
      void queryClient.invalidateQueries({ queryKey: projectId ? [key, projectId] : [key] });
    }
  }

  const query = useQuery({
    queryKey: ["projects"],
    queryFn: ({ signal }) => fetchProjects(signal),
    refetchInterval: (currentQuery) =>
      currentQuery.state.error && !currentQuery.state.data
        ? PROJECTS_RECOVERY_INTERVAL_MS
        : false,
    refetchIntervalInBackground: true,
  });
  const { refetch } = query;

  const retryProjects = useCallback(
    () => refetch(),
    [refetch],
  );

  /** Shared logic: create project → optimistic cache → create workspace → rollback on error. */
  async function createProjectThenWorkspace(
    body: Record<string, unknown>,
  ): Promise<Workspace & { warning?: string }> {
    const project = await api.post<Project>("/api/projects", body);
    // Optimistically add project so Sidebar renders immediately
    queryClient.setQueryData<Project[]>(["projects"], (prev) =>
      prev ? [...prev, project] : [project],
    );
    try {
      const workspace = await api.post<Workspace>(
        `/api/projects/${project.id}/workspaces`,
      );
      queryClient.setQueryData<Project[]>(["projects"], (prev) =>
        prev?.map((p) =>
          p.id !== project.id
            ? p
            : { ...p, workspaces: [...p.workspaces, workspace] },
        ) ?? [],
      );
      return { ...workspace, warning: project.warning };
    } catch (err) {
      // Roll back: remove the project from cache and clean up backend
      queryClient.setQueryData<Project[]>(["projects"], (prev) =>
        prev?.filter((p) => p.id !== project.id) ?? [],
      );
      try {
        await api.delete(`/api/projects/${project.id}`);
      } catch {
        // Best-effort cleanup
      }
      throw err;
    }
  }

  const createProjectWithWorkspace = useMutation({
    mutationFn: (url: string) => createProjectThenWorkspace({ url }),
  });

  const createNewProjectWithWorkspace = useMutation({
    mutationFn: (params: { name: string; visibility?: "public" | "private" }) =>
      createProjectThenWorkspace({ mode: "create", ...params }),
  });

  const createWorkspace = useMutation({
    mutationFn: ({ projectId, source }: { projectId: string; source?: CreateWorkspaceSource }) =>
      source
        ? api.post<Workspace>(`/api/projects/${projectId}/workspaces`, { source })
        : api.post<Workspace>(`/api/projects/${projectId}/workspaces`),
    onSuccess: (workspace, { projectId }) => {
      queryClient.setQueryData<Project[]>(["projects"], (prev) =>
        prev?.map((p) =>
          p.id !== projectId
            ? p
            : { ...p, workspaces: [...p.workspaces, workspace] },
        ) ?? [],
      );
      invalidateWorkspaceSources(projectId);
    },
  });

  const deleteProject = useMutation({
    mutationFn: (id: string) => api.delete(`/api/projects/${id}`),
    onSuccess: (_, id) => {
      queryClient.setQueryData<Project[]>(["projects"], (prev) =>
        prev?.filter((p) => p.id !== id) ?? [],
      );
    },
  });

  const archiveWorkspace = useMutation({
    mutationKey: ["archive-workspace"],
    mutationFn: (wsId: string) =>
      api.post(`/api/workspaces/${wsId}/archive`),
    onMutate: async (wsId) => {
      await queryClient.cancelQueries({ queryKey: ["projects"] });
      queryClient.setQueryData<Project[]>(["projects"], (prev) =>
        prev?.map((p) => ({
          ...p,
          workspaces: p.workspaces.filter((ws) => ws.id !== wsId),
        })) ?? [],
      );
    },
    onSuccess: (_, wsId) => {
      queryClient.setQueryData<Project[]>(["projects"], (prev) =>
        prev?.map((p) => ({
          ...p,
          workspaces: p.workspaces.filter((ws) => ws.id !== wsId),
        })) ?? [],
      );
      invalidateWorkspaceSources();
    },
    onError: (err) => {
      toast.error(
        err instanceof Error && err.message ? err.message : "Failed to archive workspace",
      );
      // Server is truth: refetch so the workspace row reappears.
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  // A background ["projects"] refetch landing while the archive POST is still
  // in flight would resurrect the optimistically removed row — filter pending
  // archives out of whatever the cache holds.
  const pendingArchiveIds = useMutationState({
    filters: { mutationKey: ["archive-workspace"], status: "pending" },
    select: (m) => m.state.variables as string,
  });
  const rawProjects = query.data ?? [];
  const projects = pendingArchiveIds.length === 0
    ? rawProjects
    : rawProjects.map((p) => ({
      ...p,
      workspaces: p.workspaces.filter((ws) => !pendingArchiveIds.includes(ws.id)),
    }));

  return {
    projects,
    loading: query.isLoading,
    recovering: query.isFetching && query.isError && !query.data,
    unavailable: query.isError && !query.data,
    // True only after a successful fetch — guards destructive UI logic that
    // must not run on an empty/failed project list (e.g. sidebar-folder sanitize).
    ready: query.isSuccess,
    error: query.error,
    errorMessage: query.error ? formatProjectsError(query.error) : null,
    fetchProjects: () =>
      queryClient.invalidateQueries({ queryKey: ["projects"] }),
    retryProjects,
    createProjectWithWorkspace: (url: string) =>
      createProjectWithWorkspace.mutateAsync(url),
    createNewProjectWithWorkspace: (params: { name: string; visibility?: "public" | "private" }) =>
      createNewProjectWithWorkspace.mutateAsync(params),
    createWorkspace: (projectId: string, source?: CreateWorkspaceSource) =>
      createWorkspace.mutateAsync({ projectId, source }),
    deleteProject: (id: string) => deleteProject.mutateAsync(id),
    archiveWorkspace: (wsId: string) => archiveWorkspace.mutate(wsId),
  };
}
