import type { Stats } from "node:fs";
import { readdir, readFile, stat, mkdir, writeFile, rename } from "node:fs/promises";
import { join, resolve } from "node:path";
import { nanoid } from "nanoid";
import { git } from "../utils/git.js";
import {
  addWorktreeFromBranch,
  addWorktreeWithNewBranch,
  removeWorktreeOrDeleteDirectory,
} from "../utils/git-worktree.js";
import { parseGitHubRepo, fetchPrDetail, fetchIssueDetail } from "../utils/github.js";
import { mapBranchesToWorkspaces } from "./workspace-sources.js";
import { buildFileTree } from "../utils/file-tree.js";
import { MAX_TEXT_FILE_SIZE, resolveSafeRepoFilePath } from "../utils/repo-files.js";
import { buildDiffResponse, getUntrackedDiff } from "../utils/git-diff.js";
import { bareRepoPath, workspacesDir, resolveDefaultBranch } from "../utils/paths.js";
import { refreshDefaultBranchFromOrigin } from "../utils/git-default-branch.js";
import { pickCityName } from "../utils/city-names.js";
import { loadProject, loadAllProjects, saveProject, getDataDir, withProjectStateLock } from "../state/state.js";
import { isInitialized, lookupWorkspace } from "../state/workspace-index.js";
import { copyProjectEnvToWorkspace } from "../state/project-env.js";
import { BadRequestError, ConflictError, NotFoundError } from "../utils/errors.js";
import { stopAllForWorkspace } from "../services/script-runner.js";
import { stopAllTerminalsForWorkspace } from "../services/terminal-runner.js";
import type { Workspace, WorkspaceSource, CreateWorkspaceSourceInput, ProjectState, WorkspaceFileTreeNode, DiffFileStat, DiffFileStatus, DiffScope, DiffResponse, DiffStatResponse } from "../types.js";

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

// Reject option-like or malformed branch names before they reach git argv.
const INVALID_BRANCH_CHARS_RE = /[\s~^:?*[\\]/;

function validateBranchName(branch: string): void {
  if (!branch || branch.startsWith("-") || branch.includes("..") || INVALID_BRANCH_CHARS_RE.test(branch)) {
    throw new BadRequestError(`Invalid branch name: ${branch}`);
  }
}

function requireGitHubRepo(state: ProjectState): { owner: string; repo: string } {
  const repo = state.url ? parseGitHubRepo(state.url) : null;
  if (!repo) throw new BadRequestError("This project has no GitHub remote");
  return repo;
}

function buildDraftPrompt(ref: string, title: string, url: string, body: string): string {
  const lines = [`Work on ${ref}: ${title}`, url];
  const description = body.trim();
  if (description) lines.push("", description);
  return lines.join("\n");
}

async function assertBranchNotCheckedOut(
  state: ProjectState,
  bare: string,
  branch: string,
  dataDir: string,
): Promise<void> {
  const workspaceByBranch = await mapBranchesToWorkspaces(state, bare, dataDir);
  const existing = workspaceByBranch.get(branch);
  if (existing) {
    throw new ConflictError(
      `Branch "${branch}" is already checked out in workspace "${existing.name}"`,
    );
  }
}

/**
 * Fetch a remote ref into a unique Hive-owned temp ref and return its name.
 * The shared fetch-tracking ref is a single file per repo and other
 * components (git-sync, diff endpoints) fetch into the same bare repo
 * concurrently; a private ref makes the fetched tip immune to those writes.
 * Callers must delete the ref via deleteTempRef() when done.
 */
async function fetchToTempRef(bare: string, remoteRef: string): Promise<string> {
  const tempRef = `refs/hive/incoming/${nanoid(8)}`;
  await git(["fetch", "--no-tags", "origin", `+${remoteRef}:${tempRef}`], bare);
  return tempRef;
}

async function deleteTempRef(bare: string, ref: string): Promise<void> {
  await git(["update-ref", "-d", ref], bare).catch(() => {});
}

/**
 * Check out `branch` into a new worktree. `fetchedRef` is the Hive-owned temp
 * ref holding the remote tip of the branch (see fetchToTempRef), or null if
 * the branch is local-only / unreachable on the remote.
 */
async function addWorktreeOnBranch(
  bare: string,
  wsPath: string,
  branch: string,
  fetchedRef: string | null,
): Promise<void> {
  const hasLocal = await git(["show-ref", "--verify", `refs/heads/${branch}`], bare)
    .then(() => true)
    .catch(() => false);
  if (hasLocal) {
    if (fetchedRef) {
      // Fast-forward to the remote tip when possible; keep a diverged local ref.
      try {
        await git(["merge-base", "--is-ancestor", `refs/heads/${branch}`, fetchedRef], bare);
        await git(["update-ref", `refs/heads/${branch}`, fetchedRef], bare);
      } catch {
        // Diverged or unrelated — keep the local ref as-is.
      }
    }
    await addWorktreeFromBranch(bare, wsPath, branch);
    return;
  }
  if (!fetchedRef) throw new BadRequestError(`Branch "${branch}" not found`);
  await addWorktreeWithNewBranch(bare, wsPath, branch, fetchedRef);
}

async function checkoutSourceBranch(
  state: ProjectState,
  bare: string,
  wsPath: string,
  branch: string,
  dataDir: string,
): Promise<void> {
  validateBranchName(branch);
  await assertBranchNotCheckedOut(state, bare, branch, dataDir);
  let fetchedRef: string | null = null;
  try {
    fetchedRef = await fetchToTempRef(bare, `refs/heads/${branch}`);
  } catch {
    // Local-only branch or unreachable remote.
  }
  try {
    await addWorktreeOnBranch(bare, wsPath, branch, fetchedRef);
  } finally {
    if (fetchedRef) await deleteTempRef(bare, fetchedRef);
  }
}

/**
 * Check out a cross-repository PR on a Hive-owned local branch `pr/<number>`.
 * Never reuses the fork's headRefName: a fork can name its branch anything
 * (including "main"), and reusing the name could repoint an unrelated local
 * branch at the fork's commits.
 */
async function checkoutPullRequestHead(
  state: ProjectState,
  bare: string,
  wsPath: string,
  prNumber: number,
  dataDir: string,
): Promise<string> {
  const branch = `pr/${prNumber}`;
  await assertBranchNotCheckedOut(state, bare, branch, dataDir);
  let fetchedRef: string;
  try {
    fetchedRef = await fetchToTempRef(bare, `refs/pull/${prNumber}/head`);
  } catch {
    throw new BadRequestError(`Could not fetch pull request #${prNumber} from origin`);
  }
  try {
    // A stale pr/<n> branch left behind by an older workspace is safe to reset:
    // the namespace is Hive-owned and the assert above proved nothing has it
    // checked out.
    await git(["branch", "-D", branch], bare).catch(() => {});
    await addWorktreeWithNewBranch(bare, wsPath, branch, fetchedRef);
  } finally {
    await deleteTempRef(bare, fetchedRef);
  }
  return branch;
}

export async function createWorkspace(
  projectId: string,
  dataDir = getDataDir(),
  source?: CreateWorkspaceSourceInput,
): Promise<Workspace> {
  return withProjectStateLock(
    projectId,
    async () => {
      const state = await loadProject(projectId, dataDir);
      if (!state) throw new NotFoundError(`Project ${projectId} not found`);

      const usedNames = state.workspaces.map((ws) => ws.name);
      const cityName = pickCityName(usedNames);
      const wsPath = join(workspacesDir(dataDir, projectId), cityName);
      const bare = bareRepoPath(dataDir, projectId);

      const defaultBranch = await resolveDefaultBranch(bare);

      let branch: string;
      let wsSource: WorkspaceSource | undefined;
      let draftPrompt: string | undefined;

      if (!source) {
        // Default flow: new branch off the refreshed default branch.
        branch = `workspace/${cityName}`;
        await refreshDefaultBranchFromOrigin(bare, defaultBranch);
        await addWorktreeWithNewBranch(bare, wsPath, branch, defaultBranch);
      } else if (source.kind === "branch") {
        branch = source.branch;
        await checkoutSourceBranch(state, bare, wsPath, branch, dataDir);
        wsSource = { kind: "branch", branch };
      } else if (source.kind === "pr") {
        const repo = requireGitHubRepo(state);
        const pr = await fetchPrDetail(repo.owner, repo.repo, source.number);
        if (pr.isCrossRepository) {
          branch = await checkoutPullRequestHead(state, bare, wsPath, pr.number, dataDir);
        } else {
          branch = pr.headRefName;
          await checkoutSourceBranch(state, bare, wsPath, branch, dataDir);
        }
        wsSource = { kind: "pr", branch, number: pr.number, title: pr.title, url: pr.url };
        draftPrompt = buildDraftPrompt(`pull request #${pr.number}`, pr.title, pr.url, pr.body);
      } else if (source.kind === "issue") {
        const repo = requireGitHubRepo(state);
        const issue = await fetchIssueDetail(repo.owner, repo.repo, source.number);
        // Issues have no code: branch off the default branch like the default flow.
        branch = `workspace/${cityName}`;
        await refreshDefaultBranchFromOrigin(bare, defaultBranch);
        await addWorktreeWithNewBranch(bare, wsPath, branch, defaultBranch);
        wsSource = { kind: "issue", number: issue.number, title: issue.title, url: issue.url };
        draftPrompt = buildDraftPrompt(`issue #${issue.number}`, issue.title, issue.url, issue.body);
      } else {
        throw new BadRequestError("Invalid workspace source");
      }

      await copyProjectEnvToWorkspace(projectId, wsPath, dataDir);

      const workspace: Workspace = {
        id: `ws-${nanoid(8)}`,
        name: cityName,
        projectId,
        branch,
        status: "idle",
        createdAt: new Date().toISOString(),
        ...(wsSource ? { source: wsSource } : {}),
        ...(draftPrompt ? { draftPrompt } : {}),
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
  stopAllTerminalsForWorkspace(wsId);

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

      // Remove the branch — but keep branches that pre-existed the workspace
      // (created from an existing branch or a same-repo PR head). Cross-repo PR
      // checkouts live on the Hive-owned `pr/<n>` branch and are deleted with
      // the workspace.
      const src = workspace.source;
      const keepBranch =
        src?.kind === "branch" ||
        (src?.kind === "pr" && workspace.branch !== `pr/${src.number}`);
      if (!keepBranch) {
        try {
          await git(["branch", "-D", workspace.branch], bare);
        } catch {
          // Branch may not exist
        }
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
  stopAllTerminalsForWorkspace(wsId);

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
  maxUntrackedFiles?: number,
): Promise<DiffResponse> {
  const { bare, wsPath, defaultBranch, workspace } =
    await resolveWorkspacePaths(wsId, dataDir);

  // Keep these scopes aligned with the modified-file UX: branch commits,
  // working tree changes, or a combined review against the default branch.
  if (scope === "committed") {
    await refreshDefaultBranchFromOrigin(bare, defaultBranch);
    const diff = await git(["-c", "core.quotePath=false", "diff", "--find-renames", `${defaultBranch}...${workspace.branch}`], bare)
      .then((r) => r.stdout);
    return { diff, omittedFileCount: 0 };
  }

  if (scope === "uncommitted") {
    const [trackedDiff, untracked] = await Promise.all([
      git(["-c", "core.quotePath=false", "diff", "HEAD"], wsPath).then((r) => r.stdout),
      getUntrackedDiff(wsPath, maxUntrackedFiles),
    ]);
    return buildDiffResponse(trackedDiff, untracked);
  }

  await refreshDefaultBranchFromOrigin(bare, defaultBranch);
  const mergeBase = await git(
    ["merge-base", defaultBranch, workspace.branch],
    wsPath,
  ).then((r) => r.stdout.trim()).catch(() => "");

  const [combinedDiff, untracked] = await Promise.all([
    mergeBase
      ? git(["-c", "core.quotePath=false", "diff", mergeBase], wsPath).then((r) => r.stdout)
      : git(["-c", "core.quotePath=false", "diff", "HEAD"], wsPath).then((r) => r.stdout),
    getUntrackedDiff(wsPath, maxUntrackedFiles),
  ]);

  return buildDiffResponse(combinedDiff, untracked);
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
    git(["-c", "core.quotePath=false", "diff", "--numstat", "--find-renames", range], bare).catch(() => ({ stdout: "" })),
    git(["-c", "core.quotePath=false", "diff", "--name-status", "--find-renames", range], bare).catch(() => ({ stdout: "" })),
  ]);
  const committed = parseDiffStat(committedNumstat.stdout, committedNameStatus.stdout);

  // Uncommitted changes (staged + unstaged in worktree)
  const [uncommittedNumstat, uncommittedNameStatus, untrackedResult] = await Promise.all([
    git(["-c", "core.quotePath=false", "diff", "--numstat", "HEAD"], wsPath).catch(() => ({ stdout: "" })),
    git(["-c", "core.quotePath=false", "diff", "--name-status", "HEAD"], wsPath).catch(() => ({ stdout: "" })),
    git(["-c", "core.quotePath=false", "ls-files", "--others", "--exclude-standard"], wsPath).catch(() => ({ stdout: "" })),
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
  const result = await getWorkspace(wsId, dataDir);
  if (!result) throw new NotFoundError(`Workspace ${wsId} not found`);

  const workspacePath = resolve(
    workspacesDir(dataDir, result.projectState.id),
    result.workspace.name,
  );

  // Shared with the Brain: rejects traversal, the repo root, `.git`, and
  // symlink escapes (lexical resolve does not follow symlinks).
  const resolved = await resolveSafeRepoFilePath(workspacePath, filePath);

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

  if (file.stat.size > MAX_TEXT_FILE_SIZE) {
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
