import { join } from "node:path";
import { git } from "./git.js";

export function bareRepoPath(dataDir: string, projectId: string): string {
  return join(dataDir, projectId, "repo.git");
}

export function workspacesDir(dataDir: string, projectId: string): string {
  return join(dataDir, projectId, "workspaces");
}

export async function resolveDefaultBranch(bareRepo: string): Promise<string> {
  const { stdout: headRef } = await git(["symbolic-ref", "HEAD"], bareRepo);
  return headRef.replace("refs/heads/", "");
}
