import { rm, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { nanoid } from "nanoid";
import { git } from "../utils/git.js";
import { bareRepoPath, workspacesDir, resolveDefaultBranch } from "../utils/paths.js";
import { pickCityName } from "../utils/city-names.js";
import { loadProject, saveProject, getDataDir, withProjectStateLock } from "../state/state.js";
import { ConflictError, NotFoundError } from "../utils/errors.js";
import type { Workspace, ProjectState, WorkspaceFileTreeNode } from "../types.js";

const IGNORED_DIRS = new Set([".git", "node_modules"]);
const MAX_TREE_DEPTH = 8;
const MAX_TREE_NODES = 3000;

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

function toUnixPath(path: string): string {
  return path.split(sep).join("/");
}

function sortDirEntries(a: { name: string; isDirectory: () => boolean }, b: { name: string; isDirectory: () => boolean }): number {
  if (a.isDirectory() !== b.isDirectory()) {
    return a.isDirectory() ? -1 : 1;
  }
  return a.name.localeCompare(b.name);
}

async function readWorkspaceTree(
  rootPath: string,
  currentPath: string,
  depth: number,
  remaining: { count: number }
): Promise<WorkspaceFileTreeNode[]> {
  if (depth > MAX_TREE_DEPTH || remaining.count <= 0) {
    return [];
  }

  const entries = await readdir(currentPath, { withFileTypes: true });
  entries.sort(sortDirEntries);

  const nodes: WorkspaceFileTreeNode[] = [];
  for (const entry of entries) {
    if (remaining.count <= 0) break;

    const absolutePath = join(currentPath, entry.name);
    const relativePath = toUnixPath(relative(rootPath, absolutePath));

    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;

      remaining.count -= 1;
      const children = await readWorkspaceTree(
        rootPath,
        absolutePath,
        depth + 1,
        remaining,
      );
      nodes.push({
        name: entry.name,
        path: relativePath,
        type: "directory",
        ...(children.length > 0 ? { children } : {}),
      });
      continue;
    }

    if (!entry.isFile()) continue;

    remaining.count -= 1;
    nodes.push({
      name: entry.name,
      path: relativePath,
      type: "file",
    });
  }

  return nodes;
}

export async function createWorkspace(
  projectId: string,
  dataDir = getDataDir()
): Promise<Workspace> {
  return withProjectStateLock(
    projectId,
    async () => {
      const state = await loadProject(projectId, dataDir);
      if (!state) throw new NotFoundError(`Project ${projectId} not found`);

      const usedNames = state.workspaces.map((ws) => ws.name);
      const cityName = pickCityName(usedNames);
      const branch = `workspace/${cityName}`;
      const wsPath = join(workspacesDir(dataDir, projectId), cityName);
      const bare = bareRepoPath(dataDir, projectId);

      const defaultBranch = await resolveDefaultBranch(bare);

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
    },
    dataDir,
  );
}

export async function listWorkspaces(
  projectId: string,
  dataDir = getDataDir()
): Promise<Workspace[]> {
  const state = await loadProject(projectId, dataDir);
  if (!state) throw new NotFoundError(`Project ${projectId} not found`);
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
  if (!result) throw new NotFoundError(`Workspace ${wsId} not found`);

  const projectId = result.projectState.id;
  await withProjectStateLock(
    projectId,
    async () => {
      const latest = await loadProject(projectId, dataDir);
      if (!latest) throw new NotFoundError(`Project ${projectId} not found`);
      const workspace = latest.workspaces.find((ws) => ws.id === wsId);
      if (!workspace) throw new NotFoundError(`Workspace ${wsId} not found`);

      const bare = bareRepoPath(dataDir, projectId);
      const wsPath = join(workspacesDir(dataDir, projectId), workspace.name);

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
      latest.workspaces = latest.workspaces.filter((ws) => ws.id !== wsId);
      await saveProject(latest, dataDir);
    },
    dataDir,
  );
}

export async function getWorkspaceDiff(
  wsId: string,
  dataDir = getDataDir()
): Promise<string> {
  const result = await getWorkspace(wsId, dataDir);
  if (!result) throw new NotFoundError(`Workspace ${wsId} not found`);

  const { projectState, workspace } = result;
  const bare = bareRepoPath(dataDir, projectState.id);

  const defaultBranch = await resolveDefaultBranch(bare);

  try {
    const { stdout } = await git(["diff", `${defaultBranch}...${workspace.branch}`], bare);
    return stdout;
  } catch {
    return "";
  }
}

export async function listWorkspaceFiles(
  wsId: string,
  dataDir = getDataDir()
): Promise<WorkspaceFileTreeNode[]> {
  const result = await getWorkspace(wsId, dataDir);
  if (!result) throw new NotFoundError(`Workspace ${wsId} not found`);

  const workspacePath = join(
    workspacesDir(dataDir, result.projectState.id),
    result.workspace.name,
  );

  const remaining = { count: MAX_TREE_NODES };
  return readWorkspaceTree(workspacePath, workspacePath, 0, remaining);
}

export async function mergeWorkspace(
  wsId: string,
  dataDir = getDataDir()
): Promise<void> {
  const result = await getWorkspace(wsId, dataDir);
  if (!result) throw new NotFoundError(`Workspace ${wsId} not found`);

  const { projectState, workspace } = result;
  if (workspace.status === "busy") {
    throw new ConflictError("Cannot merge while a session is active");
  }

  const bare = bareRepoPath(dataDir, projectState.id);

  const defaultBranch = await resolveDefaultBranch(bare);

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
