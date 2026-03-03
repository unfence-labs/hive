import { rm } from "node:fs/promises";
import { git } from "./git.js";

export function isMissingOrNotGitRepositoryError(err: unknown): boolean {
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return true;
  }
  const message = err instanceof Error ? err.message : "";
  return (
    /not a git repository/i.test(message) ||
    /no such file or directory/i.test(message) ||
    /spawn git ENOENT/i.test(message)
  );
}

export async function addWorktreeFromBranch(
  bareRepoPath: string,
  workspacePath: string,
  branch: string,
): Promise<void> {
  await git(["worktree", "add", workspacePath, branch], bareRepoPath);
}

export async function addWorktreeWithNewBranch(
  bareRepoPath: string,
  workspacePath: string,
  branch: string,
  startPoint: string,
): Promise<void> {
  await git(["worktree", "add", "-b", branch, workspacePath, startPoint], bareRepoPath);
}

export async function refreshWorktreeToRemoteBranch(
  workspacePath: string,
  branch: string,
): Promise<void> {
  await git(["fetch", "origin", branch], workspacePath);
  await git(["checkout", branch], workspacePath);
  try {
    await git(["reset", "--hard", `origin/${branch}`], workspacePath);
  } catch {
    // Worktrees attached to bare repos may not always expose origin/<branch>.
    // FETCH_HEAD still points to the freshly fetched remote commit.
    await git(["reset", "--hard", "FETCH_HEAD"], workspacePath);
  }
  await git(["clean", "-ffdx"], workspacePath);
}

export async function removeWorktreeAndPruneBestEffort(
  bareRepoPath: string,
  workspacePath: string,
): Promise<void> {
  try {
    await git(["worktree", "remove", "--force", workspacePath], bareRepoPath);
  } catch {
    await git(["worktree", "prune"], bareRepoPath).catch(() => {});
  }
}

export async function removeWorktreeOrDeleteDirectory(
  bareRepoPath: string,
  workspacePath: string,
): Promise<void> {
  try {
    await git(["worktree", "remove", workspacePath, "--force"], bareRepoPath);
  } catch {
    await rm(workspacePath, { recursive: true, force: true });
    await git(["worktree", "prune"], bareRepoPath);
  }
}
