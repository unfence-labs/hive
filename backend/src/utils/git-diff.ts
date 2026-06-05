import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { git } from "./git.js";

/** Hard cap on how many untracked files are rendered into a synthetic diff. */
export const DEFAULT_MAX_UNTRACKED_FILES = 100;

/** Result of {@link getUntrackedDiff}: the synthetic patch plus coverage counts. */
export interface UntrackedDiffResult {
  /** Concatenated synthetic new-file patches for the included untracked files. */
  patch: string;
  /** Total number of untracked files discovered in the working tree. */
  total: number;
  /** Number of untracked files actually rendered into {@link patch}. */
  included: number;
}

/**
 * Build a synthetic unified diff for untracked files in a working tree.
 *
 * `git diff` does not surface untracked files, so this reads each untracked
 * file and renders it as an all-additions "new file" patch. Binary files
 * (containing NUL bytes) are skipped. The output is concatenable with the
 * result of `git diff HEAD` to form a complete working-tree-vs-HEAD diff.
 *
 * Rendering is capped at `maxFiles` to bound memory/CPU. The returned `total`
 * and `included` counts let callers surface when the patch is incomplete (e.g.
 * a Brain Save that would commit more files than the review displays).
 *
 * @param repoPath Working tree to scan.
 * @param maxFiles Max number of untracked files to render (default
 *   {@link DEFAULT_MAX_UNTRACKED_FILES}); injectable for tests.
 */
export async function getUntrackedDiff(
  repoPath: string,
  maxFiles = DEFAULT_MAX_UNTRACKED_FILES,
): Promise<UntrackedDiffResult> {
  const untrackedResult = await git(["ls-files", "--others", "--exclude-standard"], repoPath)
    .then((r) => r.stdout)
    .catch(() => "");
  const untrackedFiles = untrackedResult.split("\n").filter(Boolean);

  // Read the capped set of files concurrently; Promise.all preserves order so
  // the concatenated patch stays deterministic. A null entry means the file was
  // skipped (binary or unreadable) — it stays counted in `total` but not `included`.
  const rendered = await Promise.all(
    untrackedFiles.slice(0, maxFiles).map(async (file): Promise<string | null> => {
      try {
        const content = await readFile(join(repoPath, file), "utf-8");
        if (content.includes("\0")) return null;
        // An empty file has no added lines: emit a `@@ -0,0 +0,0 @@` header with
        // no body so it does not render a spurious blank "+1" line.
        if (content.length === 0) {
          return `diff --git a/${file} b/${file}\nnew file mode 100644\n--- /dev/null\n+++ b/${file}\n@@ -0,0 +0,0 @@`;
        }
        const lines = content.endsWith("\n") ? content.slice(0, -1).split("\n") : content.split("\n");
        const hunkBody = lines.map((l) => `+${l}`).join("\n");
        return `diff --git a/${file} b/${file}\nnew file mode 100644\n--- /dev/null\n+++ b/${file}\n@@ -0,0 +1,${lines.length} @@\n${hunkBody}`;
      } catch {
        return null;
      }
    }),
  );

  const untrackedPatches = rendered.filter((p): p is string => p !== null);

  return {
    patch: untrackedPatches.join("\n"),
    total: untrackedFiles.length,
    included: untrackedPatches.length,
  };
}
