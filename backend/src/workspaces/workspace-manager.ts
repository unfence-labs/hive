import type { Stats } from "node:fs";
import { readdir, readFile, stat, mkdir, writeFile, rename } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { nanoid } from "nanoid";
import { git } from "../utils/git.js";
import {
  addWorktreeWithNewBranch,
  removeWorktreeOrDeleteDirectory,
} from "../utils/git-worktree.js";
import { buildFileTree } from "../utils/file-tree.js";
import { getUntrackedDiff } from "../utils/git-diff.js";
import { bareRepoPath, workspacesDir, resolveDefaultBranch } from "../utils/paths.js";
import { refreshDefaultBranchFromOrigin } from "../utils/git-default-branch.js";
import { pickCityName } from "../utils/city-names.js";
import { loadProject, loadAllProjects, saveProject, getDataDir, withProjectStateLock } from "../state/state.js";
import { isInitialized, lookupWorkspace } from "../state/workspace-index.js";
import { copyProjectEnvToWorkspace } from "../state/project-env.js";
import { BadRequestError, ConflictError, NotFoundError } from "../utils/errors.js";
import { stopAllForWorkspace } from "../services/script-runner.js";
import type { Workspace, ProjectState, WorkspaceFileTreeNode, DiffFileStat, DiffFileStatus, DiffScope, DiffStatResponse } from "../types.js";

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

      await refreshDefaultBranchFromOrigin(bare, defaultBranch);

      // Create worktree from the default branch
      await addWorktreeWithNewBranch(bare, wsPath, branch, defaultBranch);
      await copyProjectEnvToWorkspace(projectId, wsPath, dataDir);

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
  // Fast path: O(1) lookup from the in-memory index
  if (isInitialized()) {
    const entry = lookupWorkspace(wsId);
    if (entry) return { projectState: entry.projectState, workspace: entry.workspace };
    return null;
  }
  // Fallback: disk scan (before index is initialized, or in tests)
  const all = await loadAllProjects(dataDir);
  const found = findProjectByWorkspace(all, wsId);
  if (!found) return null;
  return { projectState: found.state, workspace: found.workspace };
}

export async function deleteWorkspace(
  wsId: string,
  dataDir = getDataDir()
): Promise<void> {
  stopAllForWorkspace(wsId);

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
      await removeWorktreeOrDeleteDirectory(bare, wsPath);

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

export async function archiveWorkspace(
  wsId: string,
  dataDir = getDataDir()
): Promise<void> {
  stopAllForWorkspace(wsId);

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
      const archiveDir = join(dataDir, projectId, "archive", wsId);

      // Create archive directory
      await mkdir(archiveDir, { recursive: true });

      // Save workspace metadata
      await writeFile(
        join(archiveDir, "workspace.json"),
        JSON.stringify(workspace, null, 2),
        "utf-8",
      );

      // Move session directories belonging to this workspace
      const sessionsRoot = join(dataDir, projectId, "sessions");
      try {
        const entries = await readdir(sessionsRoot, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const metaPath = join(sessionsRoot, entry.name, "metadata.json");
          try {
            const raw = await readFile(metaPath, "utf-8");
            const meta = JSON.parse(raw) as { workspaceId?: string };
            if (meta.workspaceId !== wsId) continue;
            const archiveSessionsDir = join(archiveDir, "sessions");
            await mkdir(archiveSessionsDir, { recursive: true });
            await rename(
              join(sessionsRoot, entry.name),
              join(archiveSessionsDir, entry.name),
            );
          } catch {
            // Skip unreadable session metadata
          }
        }
      } catch {
        // No sessions directory yet
      }

      // Remove the worktree (keep the branch for potential restore)
      await removeWorktreeOrDeleteDirectory(bare, wsPath);

      // Update state — remove workspace from project
      latest.workspaces = latest.workspaces.filter((ws) => ws.id !== wsId);
      await saveProject(latest, dataDir);
    },
    dataDir,
  );
}

interface ResolvedWorkspacePaths {
  bare: string;
  wsPath: string;
  defaultBranch: string;
  workspace: Workspace;
}

async function resolveWorkspacePaths(
  wsId: string,
  dataDir: string,
): Promise<ResolvedWorkspacePaths> {
  const result = await getWorkspace(wsId, dataDir);
  if (!result) throw new NotFoundError(`Workspace ${wsId} not found`);

  const { projectState, workspace } = result;
  const bare = bareRepoPath(dataDir, projectState.id);
  const wsPath = join(workspacesDir(dataDir, projectState.id), workspace.name);
  const defaultBranch = await resolveDefaultBranch(bare);

  return { bare, wsPath, defaultBranch, workspace };
}

export async function getWorkspaceDiff(
  wsId: string,
  dataDir = getDataDir(),
  scope: DiffScope = "combined",
): Promise<string> {
  const { bare, wsPath, defaultBranch, workspace } =
    await resolveWorkspacePaths(wsId, dataDir);

  // Keep these scopes aligned with the modified-file UX: branch commits,
  // working tree changes, or a combined review against the default branch.
  if (scope === "committed") {
    await refreshDefaultBranchFromOrigin(bare, defaultBranch);
    return git(["diff", "--find-renames", `${defaultBranch}...${workspace.branch}`], bare)
      .then((r) => r.stdout)
      .catch(() => "");
  }

  if (scope === "uncommitted") {
    const [trackedDiff, untrackedDiff] = await Promise.all([
      git(["diff", "HEAD"], wsPath).then((r) => r.stdout).catch(() => ""),
      getUntrackedDiff(wsPath),
    ]);
    return [trackedDiff, untrackedDiff].filter(Boolean).join("\n");
  }

  await refreshDefaultBranchFromOrigin(bare, defaultBranch);
  const mergeBase = await git(
    ["merge-base", defaultBranch, workspace.branch],
    wsPath,
  ).then((r) => r.stdout.trim()).catch(() => "");

  const [combinedDiff, untrackedDiff] = await Promise.all([
    mergeBase
      ? git(["diff", mergeBase], wsPath).then((r) => r.stdout).catch(() => "")
      : git(["diff", "HEAD"], wsPath).then((r) => r.stdout).catch(() => ""),
    getUntrackedDiff(wsPath),
  ]);

  return [combinedDiff, untrackedDiff].filter(Boolean).join("\n");
}

function parseDiffStat(
  numstatStdout: string,
  nameStatusStdout: string,
): DiffFileStat[] {
  const statusMap = new Map<string, { letter: string; from?: string }>();
  for (const line of nameStatusStdout.split("\n").filter(Boolean)) {
    const parts = line.split("\t");
    const letter = parts[0][0];
    if (letter === "R" && parts.length >= 3) {
      statusMap.set(parts[2], { letter, from: parts[1] });
    } else if (parts[1]) {
      statusMap.set(parts[1], { letter });
    }
  }

  const letterToStatus: Record<string, DiffFileStatus> = {
    A: "added",
    M: "modified",
    D: "deleted",
    R: "renamed",
  };

  function parseRenamePath(file: string): { from: string; to: string } | null {
    if (!file.includes(" => ")) return null;

    // Plain rename: old.txt => new.txt
    if (!file.includes("{")) {
      const [from, to] = file.split(" => ");
      if (from && to) return { from, to };
      return null;
    }

    // Brace rename:
    // - src/{old.ts => new.ts}
    // - {old/dir => new/dir}/file.ts
    const match = file.match(/^(.*)\{(.+?) => (.+?)\}(.*)$/);
    if (!match) return null;
    const [, prefix, fromPart, toPart, suffix] = match;
    return {
      from: `${prefix}${fromPart}${suffix}`,
      to: `${prefix}${toPart}${suffix}`,
    };
  }

  const files: DiffFileStat[] = [];
  for (const line of numstatStdout.split("\n").filter(Boolean)) {
    const [addStr, delStr, ...rest] = line.split("\t");
    const rawFile = rest.join("\t");
    let file = rawFile;
    const additions = addStr === "-" ? 0 : parseInt(addStr, 10);
    const deletions = delStr === "-" ? 0 : parseInt(delStr, 10);
    let info = statusMap.get(file);

    if (!info) {
      const rename = parseRenamePath(rawFile);
      if (rename) {
        const renamedInfo = statusMap.get(rename.to);
        if (renamedInfo) {
          info = renamedInfo;
          file = rename.to;
        }
      }
    }

    const stat: DiffFileStat = {
      file,
      additions,
      deletions,
      status: letterToStatus[info?.letter ?? "M"] ?? "modified",
    };
    if (info?.from) stat.renamedFrom = info.from;
    files.push(stat);
  }
  return files;
}

export async function computeDiffStat(
  bare: string,
  wsPath: string,
  defaultBranch: string,
  workspaceBranch: string,
): Promise<DiffStatResponse> {
  const range = `${defaultBranch}...${workspaceBranch}`;

  // Committed changes (branch vs default)
  const [committedNumstat, committedNameStatus] = await Promise.all([
    git(["diff", "--numstat", "--find-renames", range], bare).catch(() => ({ stdout: "" })),
    git(["diff", "--name-status", "--find-renames", range], bare).catch(() => ({ stdout: "" })),
  ]);
  const committed = parseDiffStat(committedNumstat.stdout, committedNameStatus.stdout);

  // Uncommitted changes (staged + unstaged in worktree)
  const [uncommittedNumstat, uncommittedNameStatus, untrackedResult] = await Promise.all([
    git(["diff", "--numstat", "HEAD"], wsPath).catch(() => ({ stdout: "" })),
    git(["diff", "--name-status", "HEAD"], wsPath).catch(() => ({ stdout: "" })),
    git(["ls-files", "--others", "--exclude-standard"], wsPath).catch(() => ({ stdout: "" })),
  ]);
  const uncommitted = parseDiffStat(uncommittedNumstat.stdout, uncommittedNameStatus.stdout);

  // Append untracked files as "added" (not captured by git diff)
  const trackedFiles = new Set(uncommitted.map((f) => f.file));
  for (const file of untrackedResult.stdout.split("\n").filter(Boolean)) {
    if (!trackedFiles.has(file)) {
      let additions = 0;
      try {
        const content = await readFile(join(wsPath, file), "utf-8");
        if (!content.includes("\0")) {
          const lines = content.endsWith("\n") ? content.slice(0, -1).split("\n") : content.split("\n");
          additions = lines.length;
        }
      } catch {
        // Skip unreadable files
      }
      uncommitted.push({ file, additions, deletions: 0, status: "added" });
    }
  }

  return { committed, uncommitted };
}

export async function getWorkspaceDiffStat(
  wsId: string,
  dataDir = getDataDir()
): Promise<DiffStatResponse> {
  const { bare, wsPath, defaultBranch, workspace } =
    await resolveWorkspacePaths(wsId, dataDir);
  await refreshDefaultBranchFromOrigin(bare, defaultBranch);
  return computeDiffStat(bare, wsPath, defaultBranch, workspace.branch);
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

  return buildFileTree(workspacePath);
}

const MAX_FILE_SIZE = 1024 * 1024; // 1 MB

export interface WorkspaceFileEntry {
  absolutePath: string;
  path: string;
  stat: Stats;
}

export async function getWorkspaceFileEntry(
  wsId: string,
  filePath: string,
  dataDir = getDataDir()
): Promise<WorkspaceFileEntry> {
  if (!filePath) throw new BadRequestError("Missing file path");

  const result = await getWorkspace(wsId, dataDir);
  if (!result) throw new NotFoundError(`Workspace ${wsId} not found`);

  const workspacePath = resolve(
    workspacesDir(dataDir, result.projectState.id),
    result.workspace.name,
  );

  const resolved = resolve(workspacePath, filePath);
  if (!resolved.startsWith(workspacePath + sep) && resolved !== workspacePath) {
    throw new BadRequestError("Invalid file path");
  }

  let fileStat;
  try {
    fileStat = await stat(resolved);
  } catch {
    throw new NotFoundError(`File not found: ${filePath}`);
  }

  if (!fileStat.isFile()) {
    throw new BadRequestError("Path is not a file");
  }

  return { absolutePath: resolved, path: filePath, stat: fileStat };
}

export async function getWorkspaceFileContent(
  wsId: string,
  filePath: string,
  dataDir = getDataDir()
): Promise<{ content: string; path: string }> {
  const file = await getWorkspaceFileEntry(wsId, filePath, dataDir);

  if (file.stat.size > MAX_FILE_SIZE) {
    throw new BadRequestError(`File too large (${Math.round(file.stat.size / 1024)}KB, max 1MB)`);
  }

  const content = await readFile(file.absolutePath, "utf-8");
  return { content, path: file.path };
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
    await removeWorktreeOrDeleteDirectory(bare, tempPath);
  }

  // Now delete the workspace
  await deleteWorkspace(wsId, dataDir);
}
