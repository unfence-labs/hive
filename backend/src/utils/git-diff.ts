import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { git } from "./git.js";

const MAX_UNTRACKED_FILES = 100;

/**
 * Build a synthetic unified diff for untracked files in a working tree.
 *
 * `git diff` does not surface untracked files, so this reads each untracked
 * file and renders it as an all-additions "new file" patch. Binary files
 * (containing NUL bytes) are skipped. The output is concatenable with the
 * result of `git diff HEAD` to form a complete working-tree-vs-HEAD diff.
 */
export async function getUntrackedDiff(repoPath: string): Promise<string> {
  const untrackedResult = await git(["ls-files", "--others", "--exclude-standard"], repoPath)
    .then((r) => r.stdout)
    .catch(() => "");
  const untrackedFiles = untrackedResult.split("\n").filter(Boolean);
  const untrackedPatches: string[] = [];

  for (const file of untrackedFiles.slice(0, MAX_UNTRACKED_FILES)) {
    try {
      const content = await readFile(join(repoPath, file), "utf-8");
      if (content.includes("\0")) continue;
      const lines = content.endsWith("\n") ? content.slice(0, -1).split("\n") : content.split("\n");
      const lineCount = lines.length;
      const hunkBody = lines.map((l) => `+${l}`).join("\n");
      untrackedPatches.push(
        `diff --git a/${file} b/${file}\nnew file mode 100644\n--- /dev/null\n+++ b/${file}\n@@ -0,0 +1,${lineCount} @@\n${hunkBody}`,
      );
    } catch {
      // Skip unreadable files
    }
  }

  return untrackedPatches.join("\n");
}
