import { nanoid } from "nanoid";
import { git } from "./git.js";

// The network fetch dominates workspace creation and diff endpoints (~1s+ per
// call against GitHub). GitSyncService already refreshes the default branch on
// its own cadence, so a successful refresh is reused briefly instead of paying
// a fetch on every call.
const REFRESH_TTL_MS = 30_000;
const lastRefreshAt = new Map<string, number>();

async function updateDefaultBranchFromOrigin(
  bareRepo: string,
  defaultBranch: string,
): Promise<string> {
  const localRef = `refs/heads/${defaultBranch}`;
  const incomingRef = `refs/hive/incoming/${nanoid(8)}`;
  try {
    await git(
      [
        "fetch",
        "--no-tags",
        "--no-write-fetch-head",
        "origin",
        `+refs/heads/${defaultBranch}:${incomingRef}`,
      ],
      bareRepo,
    );
    const [{ stdout: localTip }, { stdout: incomingTip }] = await Promise.all([
      git(["rev-parse", localRef], bareRepo),
      git(["rev-parse", incomingRef], bareRepo),
    ]);
    try {
      await git(["merge-base", "--is-ancestor", localTip, incomingTip], bareRepo);
    } catch {
      // A local merge may leave the default branch ahead of origin while still
      // containing every remote commit. Only fail when the histories diverge.
      await git(["merge-base", "--is-ancestor", incomingTip, localTip], bareRepo);
      return localTip;
    }
    if (localTip !== incomingTip) {
      try {
        await git(["update-ref", localRef, incomingTip, localTip], bareRepo);
      } catch {
        const { stdout: currentTip } = await git(["rev-parse", localRef], bareRepo);
        await git(["merge-base", "--is-ancestor", incomingTip, currentTip], bareRepo);
        return currentTip;
      }
    }
    return incomingTip;
  } finally {
    await git(["update-ref", "-d", incomingRef], bareRepo).catch(() => {});
  }
}

export async function refreshDefaultBranchFromOriginStrict(
  bareRepo: string,
  defaultBranch: string,
): Promise<string> {
  try {
    const startPoint = await updateDefaultBranchFromOrigin(bareRepo, defaultBranch);
    lastRefreshAt.set(`${bareRepo}\0${defaultBranch}`, Date.now());
    return startPoint;
  } catch (err) {
    throw new Error(`Could not refresh default branch "${defaultBranch}" from origin`, {
      cause: err,
    });
  }
}

export async function refreshDefaultBranchFromOrigin(
  bareRepo: string,
  defaultBranch: string,
): Promise<void> {
  const key = `${bareRepo}\0${defaultBranch}`;
  const last = lastRefreshAt.get(key);
  if (last !== undefined && Date.now() - last < REFRESH_TTL_MS) return;
  try {
    await updateDefaultBranchFromOrigin(bareRepo, defaultBranch);
    lastRefreshAt.set(key, Date.now());
  } catch {
    // Local-only repos, missing remotes, and diverged default branches keep
    // their current ref. Not cached: the next call retries the fetch.
  }
}

/** Reset the refresh TTL cache (for tests). */
export function _resetDefaultBranchRefreshCache(): void {
  lastRefreshAt.clear();
}
