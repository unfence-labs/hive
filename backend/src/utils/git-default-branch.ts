import { git } from "./git.js";

// The network fetch dominates workspace creation and diff endpoints (~1s+ per
// call against GitHub). GitSyncService already refreshes the default branch on
// its own cadence, so a successful refresh is reused briefly instead of paying
// a fetch on every call.
const REFRESH_TTL_MS = 30_000;
const lastRefreshAt = new Map<string, number>();

export async function refreshDefaultBranchFromOrigin(
  bareRepo: string,
  defaultBranch: string,
): Promise<void> {
  const key = `${bareRepo}\0${defaultBranch}`;
  const last = lastRefreshAt.get(key);
  if (last !== undefined && Date.now() - last < REFRESH_TTL_MS) return;
  try {
    await git(["fetch", "origin", defaultBranch], bareRepo);
    await git(
      ["merge-base", "--is-ancestor", `refs/heads/${defaultBranch}`, "FETCH_HEAD"],
      bareRepo,
    );
    await git(["update-ref", `refs/heads/${defaultBranch}`, "FETCH_HEAD"], bareRepo);
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
