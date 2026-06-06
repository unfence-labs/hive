import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/hooks/useApi";
import { useFileContent } from "@/hooks/useFileContent";
import {
  BRAIN_DIFF_QUERY_KEY,
  BRAIN_FILES_QUERY_KEY,
  BRAIN_PARSED_DIFF_QUERY_KEY,
  BRAIN_STATUS_QUERY_KEY,
  BRAIN_WORKSPACE_ID,
} from "@/lib/brain";
import type { BrainFileContent, WorkspaceFileTreeNode } from "@/types";

/** Query the recursive Brain file tree. */
export function useBrainFileTree() {
  return useQuery({
    queryKey: BRAIN_FILES_QUERY_KEY,
    queryFn: () => api.get<WorkspaceFileTreeNode[]>("/api/brain/files"),
  });
}

/**
 * Query a single Brain file's content. Disabled when no path is selected.
 *
 * Delegates to the shared {@link useFileContent} hook (which owns the Brain
 * endpoint, cache key, and `staleTime: Infinity` semantics) and re-exposes a
 * `useQuery`-compatible subset (`data`/`isLoading`/`isSuccess`/`error`) so
 * existing Brain callers keep compiling unchanged.
 */
export function useBrainFileContent(path: string | null) {
  const { content, isLoading, error } = useFileContent(BRAIN_WORKSPACE_ID, path);
  return {
    data: content !== undefined ? ({ path: path ?? "", content } as BrainFileContent) : undefined,
    isLoading,
    isSuccess: !isLoading && !error && content !== undefined,
    error,
  };
}

/**
 * Mutations for Brain file operations (upsert). The mutation invalidates the
 * file tree, the git status badge, and the diff (raw + parsed) after success
 * so the Modified tab and any open diff stay fresh.
 *
 * Note: upsert writes to disk only (working tree) — it does NOT commit. Git
 * persistence happens through the explicit Save flow (see `useBrainGit`).
 */
export function useBrainFileMutations() {
  const queryClient = useQueryClient();

  const invalidateTreeAndStatus = () => {
    void queryClient.invalidateQueries({ queryKey: BRAIN_FILES_QUERY_KEY });
    void queryClient.invalidateQueries({ queryKey: BRAIN_STATUS_QUERY_KEY });
    void queryClient.invalidateQueries({ queryKey: BRAIN_DIFF_QUERY_KEY });
    void queryClient.invalidateQueries({ queryKey: BRAIN_PARSED_DIFF_QUERY_KEY });
  };

  const upsertFile = useMutation({
    mutationFn: ({ path, content }: { path: string; content: string }) =>
      api.put<BrainFileContent>("/api/brain/file", { path, content }),
    onSuccess: invalidateTreeAndStatus,
  });

  return {
    upsertFile: (path: string, content: string) => upsertFile.mutateAsync({ path, content }),
    isUpserting: upsertFile.isPending,
  };
}
