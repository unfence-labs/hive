import { join } from "node:path";
import { git } from "./git.js";

/**
 * Synthetic workspace id the Brain shares on the hub WS channel and the
 * workspace-keyed routes. Canonical backend definition (mirrors the frontend
 * `lib/brain.ts`).
 */
export const BRAIN_WORKSPACE_ID = "brain";

export function bareRepoPath(dataDir: string, projectId: string): string {
  return join(dataDir, projectId, "repo.git");
}

export function workspacesDir(dataDir: string, projectId: string): string {
  return join(dataDir, projectId, "workspaces");
}

/** Return the singleton Brain storage directory under Hive's data directory. */
export function brainDir(dataDir: string): string {
  return join(dataDir, "brain");
}

/** Return the normal-clone repository path for the singleton Brain. */
export function brainRepoPath(dataDir: string): string {
  return join(brainDir(dataDir), "repo");
}

export async function resolveDefaultBranch(bareRepo: string): Promise<string> {
  const { stdout: headRef } = await git(["symbolic-ref", "HEAD"], bareRepo);
  return headRef.replace("refs/heads/", "");
}
