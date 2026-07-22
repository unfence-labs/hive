import { join } from "node:path";
import { git } from "../utils/git.js";
import { bareRepoPath, workspacesDir, resolveDefaultBranch } from "../utils/paths.js";
import { loadProject, getDataDir } from "../state/state.js";
import { NotFoundError } from "../utils/errors.js";
import type { ProjectBranchItem, ProjectState } from "../types.js";

/**
 * Live branch → worktree path mapping from `git worktree list`. The stored
 * `Workspace.branch` can be stale after the naming task renames a branch, so
 * conflict checks and annotations must use the live worktree state.
 */
export async function getWorktreeBranches(bare: string): Promise<Map<string, string>> {
  const { stdout } = await git(["worktree", "list", "--porcelain"], bare);
  const map = new Map<string, string>();
  let currentPath = "";
  for (const line of stdout.split("\n")) {
    if (line.startsWith("worktree ")) {
      currentPath = line.slice("worktree ".length);
    } else if (line.startsWith("branch refs/heads/")) {
      map.set(line.slice("branch refs/heads/".length), currentPath);
    }
  }
  return map;
}

/** Branch → owning workspace, for branches checked out in a project workspace. */
export async function mapBranchesToWorkspaces(
  state: ProjectState,
  bare: string,
  dataDir: string,
): Promise<Map<string, { id: string; name: string }>> {
  const branches = await getWorktreeBranches(bare);
  const workspaceByPath = new Map(
    state.workspaces.map((ws) => [
      join(workspacesDir(dataDir, state.id), ws.name),
      { id: ws.id, name: ws.name },
    ]),
  );
  const result = new Map<string, { id: string; name: string }>();
  for (const [branch, path] of branches) {
    const ws = workspaceByPath.get(path);
    if (ws) result.set(branch, ws);
  }
  return result;
}

/**
 * All branches a workspace could be created from: remote heads (via
 * `ls-remote`, the bare clone has no fetch refspec) merged with local heads,
 * minus the default branch, annotated with the workspace that already has
 * the branch checked out when applicable.
 */
export async function listProjectBranches(
  projectId: string,
  dataDir = getDataDir(),
): Promise<ProjectBranchItem[]> {
  const state = await loadProject(projectId, dataDir);
  if (!state) throw new NotFoundError(`Project ${projectId} not found`);
  const bare = bareRepoPath(dataDir, projectId);
  const defaultBranch = await resolveDefaultBranch(bare);

  const names = new Set<string>();
  const remoteNames = new Set<string>();
  let remoteReachable = false;
  try {
    const { stdout } = await git(["ls-remote", "--heads", "origin"], bare);
    remoteReachable = true;
    for (const line of stdout.split("\n").filter(Boolean)) {
      const ref = line.split("\t")[1];
      if (ref?.startsWith("refs/heads/")) remoteNames.add(ref.slice("refs/heads/".length));
    }
    for (const name of remoteNames) names.add(name);
  } catch {
    // No reachable remote — fall back to local branches only.
  }
  const { stdout: localHeads } = await git(
    ["for-each-ref", "--format=%(refname:short)", "refs/heads"],
    bare,
  );
  for (const name of localHeads.split("\n").filter(Boolean)) names.add(name);
  names.delete(defaultBranch);

  const workspaceByBranch = await mapBranchesToWorkspaces(state, bare, dataDir);
  return [...names].sort((a, b) => a.localeCompare(b)).map((name) => {
    const ws = workspaceByBranch.get(name);
    // Only flag local-only branches when the remote answered; with the remote
    // unreachable every branch would be a false positive.
    const localOnly = remoteReachable && !remoteNames.has(name);
    return {
      name,
      ...(localOnly ? { localOnly: true } : {}),
      ...(ws ? { workspaceId: ws.id, workspaceName: ws.name } : {}),
    };
  });
}
