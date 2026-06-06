import type {
  BrainFileStatus,
  BrainFileStatusKind,
  BrainSaveResponse,
  BrainStatusResponse,
  DiffResponse,
} from "../types.js";
import { git } from "../utils/git.js";
import { buildDiffResponse, getUntrackedDiff } from "../utils/git-diff.js";
import { getDataDir } from "../state/state.js";
import { requireBrainRepo } from "./brain-files.js";

/** Map a `git status --porcelain` XY code pair to a Brain status kind. */
function porcelainToStatus(x: string, y: string): BrainFileStatusKind {
  if (x === "?" && y === "?") return "untracked";
  if (x === "R" || y === "R") return "renamed";
  if (x === "A" || y === "A") return "added";
  if (x === "D" || y === "D") return "deleted";
  return "modified";
}

/**
 * List the Brain working-tree changes relative to HEAD — exactly the set that
 * `save` (`git add -A` + commit) would commit: modified, added, deleted,
 * renamed, and untracked files.
 */
export async function getBrainStatus(
  dataDir = getDataDir(),
): Promise<BrainStatusResponse> {
  const repoPath = await requireBrainRepo(dataDir);
  // -z gives NUL-delimited records; renames emit an extra NUL-separated old path.
  // -uall lists individual untracked files instead of collapsing directories.
  const { stdout } = await git(["status", "--porcelain", "-z", "-uall"], repoPath);

  const files: BrainFileStatus[] = [];
  const records = stdout.split("\0");
  for (let i = 0; i < records.length; i++) {
    let record = records[i];
    if (!record) continue;
    // `git()` trims its output, so the first record can lose a leading status
    // space (e.g. " M file" -> "M file"). A normal record has a separator space
    // at index 2; if it's missing, restore the dropped leading space.
    if (record[2] !== " ") record = ` ${record}`;
    const x = record[0] ?? " ";
    const y = record[1] ?? " ";
    const path = record.slice(3);
    const status = porcelainToStatus(x, y);

    if (status === "renamed") {
      // The following NUL-delimited record is the original path.
      const renamedFrom = records[i + 1] ?? "";
      i += 1;
      files.push({ path, status, renamedFrom });
      continue;
    }
    files.push({ path, status });
  }

  return { files, count: files.length };
}

/**
 * Build the Brain working-tree-vs-HEAD diff in unified format, including
 * tracked changes (modified/deleted) and synthetic patches for untracked
 * files so the diff reflects exactly what `save` would commit.
 *
 * Untracked rendering is capped (see {@link getUntrackedDiff}); any overflow is
 * reported as `omittedFileCount` so the review can warn that more files will be
 * committed than displayed instead of hiding them silently.
 *
 * @param dataDir Data directory (injectable for tests).
 * @param maxUntrackedFiles Cap forwarded to `getUntrackedDiff` (injectable for tests).
 */
export async function getBrainDiff(
  dataDir = getDataDir(),
  maxUntrackedFiles?: number,
): Promise<DiffResponse> {
  const repoPath = await requireBrainRepo(dataDir);
  const [trackedDiff, untracked] = await Promise.all([
    git(["diff", "--find-renames", "HEAD"], repoPath)
      .then((r) => r.stdout)
      .catch(() => ""),
    getUntrackedDiff(repoPath, maxUntrackedFiles),
  ]);
  return buildDiffResponse(trackedDiff, untracked);
}

/**
 * Persist the Brain working tree to git: `git add -A`, commit, and push.
 *
 * - Nothing to commit -> `{ committed: false, pushed: false }` (not an error).
 * - Commit succeeds but push fails -> `{ committed: true, pushed: false, error }`
 *   (the local commit is kept; the UI surfaces the push failure).
 */
export async function saveBrain(
  message: string | undefined,
  dataDir = getDataDir(),
): Promise<BrainSaveResponse> {
  const repoPath = await requireBrainRepo(dataDir);

  const { count } = await getBrainStatus(dataDir);
  if (count === 0) {
    return { committed: false, pushed: false };
  }

  const commitMessage = message?.trim() || `Brain update ${new Date().toISOString()}`;
  await git(["add", "-A"], repoPath);
  await git(["commit", "-m", commitMessage], repoPath);

  try {
    await git(["push"], repoPath);
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : "Push failed";
    return { committed: true, pushed: false, error: detail };
  }

  return { committed: true, pushed: true };
}
