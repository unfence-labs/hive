import { join } from "node:path";
import { rm, mkdir } from "node:fs/promises";
import { nanoid } from "nanoid";
import { git } from "../utils/git.js";
import { pickCityName } from "../utils/city-names.js";
import { loadProject, saveProject, getDataDir } from "../state/state.js";
import type { Workspace, ProjectState } from "../types.js";

function bareRepoPath(dataDir: string, projectId: string): string {
  return join(dataDir, projectId, "repo.git");
}

function workspacesDir(dataDir: string, projectId: string): string {
  return join(dataDir, projectId, "workspaces");
}

function findWorkspace(state: ProjectState, wsId: string): Workspace | undefined {
  return state.workspaces.find((ws) => ws.id === wsId);
}

function findProjectByWorkspace(
  states: ProjectState[],
  wsId: string
): { state: ProjectState; workspace: Workspace } | undefined {
  for (const state of states) {
    const ws = findWorkspace(state, wsId);
    if (ws) return { state, workspace: ws };
  }
  return undefined;
}

export async function createWorkspace(
  projectId: string,
  dataDir = getDataDir()
): Promise<Workspace> {
  const state = await loadProject(projectId, dataDir);
  if (!state) throw new Error(`Project ${projectId} not found`);

  const usedNames = state.workspaces.map((ws) => ws.name);
  const cityName = pickCityName(usedNames);
  const branch = `workspace/${cityName}`;
  const wsPath = join(workspacesDir(dataDir, projectId), cityName);
  const bare = bareRepoPath(dataDir, projectId);

  // Determine default branch from bare repo
  const { stdout: headRef } = await git(["symbolic-ref", "HEAD"], bare);
  const defaultBranch = headRef.replace("refs/heads/", "");

  // Create worktree from the default branch
  await git(["worktree", "add", "-b", branch, wsPath, defaultBranch], bare);

  const workspace: Workspace = {
    id: `ws-${nanoid(8)}`,
    name: cityName,
    projectId,
    branch,
    status: "idle",
    createdAt: new Date().toISOString(),
  };
  state.workspaces.push(workspace);
  await saveProject(state, dataDir);
  return workspace;
}

export async function listWorkspaces(
  projectId: string,
  dataDir = getDataDir()
): Promise<Workspace[]> {
  const state = await loadProject(projectId, dataDir);
  if (!state) throw new Error(`Project ${projectId} not found`);
  return state.workspaces;
}

export async function getWorkspace(
  wsId: string,
  dataDir = getDataDir()
): Promise<{ projectState: ProjectState; workspace: Workspace } | null> {
  const { loadAllProjects } = await import("../state/state.js");
  const all = await loadAllProjects(dataDir);
  const found = findProjectByWorkspace(all, wsId);
  if (!found) return null;
  return { projectState: found.state, workspace: found.workspace };
}

export async function deleteWorkspace(
  wsId: string,
  dataDir = getDataDir()
): Promise<void> {
  const result = await getWorkspace(wsId, dataDir);
  if (!result) throw new Error(`Workspace ${wsId} not found`);

  const { projectState, workspace } = result;
  const bare = bareRepoPath(dataDir, projectState.id);
  const wsPath = join(workspacesDir(dataDir, projectState.id), workspace.name);

  // Remove the worktree
  try {
    await git(["worktree", "remove", wsPath, "--force"], bare);
  } catch {
    // Fallback: just remove the directory
    await rm(wsPath, { recursive: true, force: true });
    await git(["worktree", "prune"], bare);
  }

  // Remove the branch
  try {
    await git(["branch", "-D", workspace.branch], bare);
  } catch {
    // Branch may not exist
  }

  // Update state
  projectState.workspaces = projectState.workspaces.filter((ws) => ws.id !== wsId);
  await saveProject(projectState, dataDir);
}

export async function getWorkspaceDiff(
  wsId: string,
  dataDir = getDataDir()
): Promise<string> {
  const result = await getWorkspace(wsId, dataDir);
  if (!result) throw new Error(`Workspace ${wsId} not found`);

  const { projectState, workspace } = result;
  const bare = bareRepoPath(dataDir, projectState.id);

  // Get the default branch name
  const { stdout: headRef } = await git(["symbolic-ref", "HEAD"], bare);
  const defaultBranch = headRef.replace("refs/heads/", "");

  try {
    const { stdout } = await git(["diff", `${defaultBranch}...${workspace.branch}`], bare);
    return stdout;
  } catch {
    return "";
  }
}

export async function mergeWorkspace(
  wsId: string,
  dataDir = getDataDir()
): Promise<void> {
  const result = await getWorkspace(wsId, dataDir);
  if (!result) throw new Error(`Workspace ${wsId} not found`);

  const { projectState, workspace } = result;
  if (workspace.status === "busy") {
    throw new Error("Cannot merge while a session is active");
  }

  const bare = bareRepoPath(dataDir, projectState.id);

  // Get default branch name
  const { stdout: headRef } = await git(["symbolic-ref", "HEAD"], bare);
  const defaultBranch = headRef.replace("refs/heads/", "");

  // Create a temp worktree on the default branch to perform the merge
  const tempPath = join(dataDir, projectState.id, `_merge-${nanoid(6)}`);

  try {
    await git(["worktree", "add", tempPath, defaultBranch], bare);

    // Configure git user in the temp worktree
    await git(["config", "user.email", "hive@orchestrator.local"], tempPath);
    await git(["config", "user.name", "Hive Orchestrator"], tempPath);

    // Merge the workspace branch
    await git(["merge", workspace.branch, "-m", `Merge workspace ${workspace.name}`], tempPath);

    // Update the bare repo's default branch ref to point to the merge commit
    const { stdout: mergeHash } = await git(["rev-parse", "HEAD"], tempPath);
    await git(["update-ref", `refs/heads/${defaultBranch}`, mergeHash], bare);
  } finally {
    // Cleanup temp worktree
    try {
      await git(["worktree", "remove", tempPath, "--force"], bare);
    } catch {
      await rm(tempPath, { recursive: true, force: true });
      await git(["worktree", "prune"], bare);
    }
  }

  // Now delete the workspace
  await deleteWorkspace(wsId, dataDir);
}
