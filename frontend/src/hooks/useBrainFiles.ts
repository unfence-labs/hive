import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/hooks/useApi";
import type { BrainFileContent, WorkspaceFileTreeNode } from "@/types";

/** React Query cache keys for Brain working-tree files. */
export const BRAIN_FILES_QUERY_KEY = ["brain", "files"] as const;
export const BRAIN_STATUS_QUERY_KEY = ["brain", "status"] as const;

/** Cache key for a single Brain file's content. */
export function brainFileQueryKey(path: string | null): readonly unknown[] {
  return ["brain", "file", path] as const;
}

/** Query the recursive Brain file tree. */
export function useBrainFileTree() {
  return useQuery({
    queryKey: BRAIN_FILES_QUERY_KEY,
    queryFn: () => api.get<WorkspaceFileTreeNode[]>("/api/brain/files"),
  });
}

/** Query a single Brain file's content. Disabled when no path is selected. */
export function useBrainFileContent(path: string | null) {
  return useQuery({
    queryKey: brainFileQueryKey(path),
    queryFn: () =>
      api.get<BrainFileContent>(`/api/brain/file?path=${encodeURIComponent(path ?? "")}`),
    enabled: !!path,
    staleTime: Infinity, // Disk is the source of truth; we drive updates explicitly.
  });
}

export interface RenameBrainFileInput {
  from: string;
  to: string;
}

/**
 * Mutations for Brain file operations (upsert/delete/rename). Each mutation
 * invalidates both the file tree and the git status badge after success.
 *
 * Note: upsert writes to disk only (working tree) — it does NOT commit. Git
 * persistence happens through the explicit Save flow (see `useBrainGit`).
 */
export function useBrainFileMutations() {
  const queryClient = useQueryClient();

  const invalidateTreeAndStatus = () => {
    void queryClient.invalidateQueries({ queryKey: BRAIN_FILES_QUERY_KEY });
    void queryClient.invalidateQueries({ queryKey: BRAIN_STATUS_QUERY_KEY });
  };

  const upsertFile = useMutation({
    mutationFn: ({ path, content }: { path: string; content: string }) =>
      api.put<BrainFileContent>("/api/brain/file", { path, content }),
    onSuccess: invalidateTreeAndStatus,
  });

  const deleteFile = useMutation({
    mutationFn: (path: string) =>
      api.delete<void>(`/api/brain/file?path=${encodeURIComponent(path)}`),
    onSuccess: invalidateTreeAndStatus,
  });

  const renameFile = useMutation({
    mutationFn: ({ from, to }: RenameBrainFileInput) =>
      api.post<BrainFileContent>("/api/brain/file/rename", { from, to }),
    onSuccess: invalidateTreeAndStatus,
  });

  return {
    upsertFile: (path: string, content: string) => upsertFile.mutateAsync({ path, content }),
    deleteFile: (path: string) => deleteFile.mutateAsync(path),
    renameFile: (input: RenameBrainFileInput) => renameFile.mutateAsync(input),
    isUpserting: upsertFile.isPending,
  };
}
