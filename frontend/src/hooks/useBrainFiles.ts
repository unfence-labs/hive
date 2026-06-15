import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api } from "@/hooks/useApi";
import {
  BRAIN_FILES_QUERY_KEY,
  BRAIN_PARSED_DIFF_QUERY_KEY,
  BRAIN_STATUS_QUERY_KEY,
  brainFileQueryKey,
} from "@/lib/brain";
import type { BrainFileContent, WorkspaceFileTreeNode } from "@/types";

/**
 * Invalidate the Brain working-tree views — the file tree, the git status
 * badge, and the parsed diff — so the "All"/"Modified" tabs and any open diff
 * stay fresh. Shared by the refresh callback and the upsert mutation so the
 * invalidation set lives in one place.
 */
function invalidateBrainWorkingTree(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: BRAIN_FILES_QUERY_KEY });
  void queryClient.invalidateQueries({ queryKey: BRAIN_STATUS_QUERY_KEY });
  void queryClient.invalidateQueries({ queryKey: BRAIN_PARSED_DIFF_QUERY_KEY });
}

/** Query the recursive Brain file tree. */
export function useBrainFileTree() {
  return useQuery({
    queryKey: BRAIN_FILES_QUERY_KEY,
    queryFn: () => api.get<WorkspaceFileTreeNode[]>("/api/brain/files"),
  });
}

/**
 * Returns a callback that force-refreshes the Brain working-tree views: the
 * file tree, the git status badge, and the parsed diff. Used by the manual
 * refresh button so files that appear for reasons Hive can't observe (e.g. the
 * user adding one directly in the Brain clone) show up without a page reload.
 */
export function useBrainRefresh(openFilePath?: string | null): () => void {
  const queryClient = useQueryClient();
  return useCallback(() => {
    invalidateBrainWorkingTree(queryClient);
    if (openFilePath) {
      void queryClient.invalidateQueries({ queryKey: brainFileQueryKey(openFilePath) });
    }
  }, [queryClient, openFilePath]);
}

/**
 * Mutations for Brain file operations (upsert). The mutation invalidates the
 * file tree, the git status badge, and the parsed diff after success so the
 * Modified tab and any open diff stay fresh.
 *
 * Note: upsert writes to disk only (working tree) — it does NOT commit. Git
 * persistence happens through the explicit Save flow (see `useBrainGit`).
 */
export function useBrainFileMutations() {
  const queryClient = useQueryClient();

  const upsertFile = useMutation({
    mutationFn: ({ path, content }: { path: string; content: string }) =>
      api.put<BrainFileContent>("/api/brain/file", { path, content }),
    onSuccess: () => invalidateBrainWorkingTree(queryClient),
  });

  return {
    upsertFile: (path: string, content: string) => upsertFile.mutateAsync({ path, content }),
    isUpserting: upsertFile.isPending,
  };
}
