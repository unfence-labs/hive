import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/hooks/useApi";
import {
  BRAIN_FILES_QUERY_KEY,
  BRAIN_PARSED_DIFF_QUERY_KEY,
  BRAIN_STATUS_QUERY_KEY,
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
 * Mutations for Brain file operations (upsert). The mutation invalidates the
 * file tree, the git status badge, and the parsed diff after success so the
 * Modified tab and any open diff stay fresh.
 *
 * Note: upsert writes to disk only (working tree) — it does NOT commit. Git
 * persistence happens through the explicit Save flow (see `useBrainGit`).
 */
export function useBrainFileMutations() {
  const queryClient = useQueryClient();

  const invalidateTreeAndStatus = () => {
    void queryClient.invalidateQueries({ queryKey: BRAIN_FILES_QUERY_KEY });
    void queryClient.invalidateQueries({ queryKey: BRAIN_STATUS_QUERY_KEY });
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
