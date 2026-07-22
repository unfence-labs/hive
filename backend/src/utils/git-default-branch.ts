import { git } from "./git.js";

export async function refreshDefaultBranchFromOrigin(
  bareRepo: string,
  defaultBranch: string,
): Promise<void> {
  try {
    await git(["fetch", "origin", defaultBranch], bareRepo);
    await git(
      ["merge-base", "--is-ancestor", `refs/heads/${defaultBranch}`, "FETCH_HEAD"],
      bareRepo,
    );
    await git(["update-ref", `refs/heads/${defaultBranch}`, "FETCH_HEAD"], bareRepo);
  } catch {
    // Local-only repos, missing remotes, and diverged default branches keep their current ref.
  }
}
