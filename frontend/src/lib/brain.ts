/**
 * Synthetic workspace id the Brain shares on the hub WS channel and the
 * workspace-keyed session routes. Imported wherever the Brain addresses the
 * shared workspace machinery so the literal lives in exactly one place.
 */
export const BRAIN_WORKSPACE_ID = "brain";

/**
 * React Query cache keys for Brain working-tree files and git state.
 *
 * These live here (not in a hook module) so both `useFileContent` and
 * `useBrainFiles` can import them without forming an import cycle.
 */
export const BRAIN_FILES_QUERY_KEY = ["brain", "files"] as const;
export const BRAIN_STATUS_QUERY_KEY = ["brain", "status"] as const;
export const BRAIN_DIFF_QUERY_KEY = ["brain", "diff"] as const;

/** Cache key for a single Brain file's content. */
export function brainFileQueryKey(path: string | null): readonly unknown[] {
  return ["brain", "file", path] as const;
}
