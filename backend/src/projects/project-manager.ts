import { join } from "node:path";
import { rm, mkdir, writeFile } from "node:fs/promises";
import { nanoid } from "nanoid";
import { git } from "../utils/git.js";
import {
  createGitHubRepository,
  deleteGitHubRepository,
  resolveGitHubCloneUrl,
  validateGitHubRepositoryName,
} from "../utils/github.js";
import { bareRepoPath } from "../utils/paths.js";
import { saveProject, loadProject, loadAllProjects, getDataDir } from "../state/state.js";
import { notifyProjectDeleted } from "../state/workspace-index.js";
import { pruneProjectFromUiPreferences } from "../state/ui-preferences.js";
import { validateRepositoryUrl } from "../utils/repo-url.js";
import { NotFoundError } from "../utils/errors.js";
import type { ProjectState } from "../types.js";

function extractRepoName(url: string): string {
  const match = url.match(/\/([^/]+?)(?:\.git)?$/);
  return match?.[1] ?? "unnamed";
}

export async function createProject(
  url: string,
  dataDir = getDataDir()
): Promise<ProjectState> {
  const validatedUrl = validateRepositoryUrl(url, {
    // Tests use local fixture paths as clone sources.
    allowLocalPath: process.env.NODE_ENV === "test",
  });
  const cloneUrl = await resolveGitHubCloneUrl(validatedUrl);

  const id = `proj-${nanoid(8)}`;
  const bare = bareRepoPath(dataDir, id);
  const wsDir = join(dataDir, id, "workspaces");
  const logsDir = join(dataDir, id, "logs");

  await mkdir(join(dataDir, id), { recursive: true });
  await git(["clone", "--bare", cloneUrl, bare]);
  await mkdir(wsDir, { recursive: true });
  await mkdir(logsDir, { recursive: true });

  const state: ProjectState = {
    id,
    name: extractRepoName(cloneUrl),
    url: cloneUrl,
    createdAt: new Date().toISOString(),
    workspaces: [],
  };
  await saveProject(state, dataDir);
  return state;
}

// ── Create GitHub repo + link to bare ───────────────────────────────

async function createGitHubRepo(
  name: string,
  visibility: "public" | "private",
  bare: string,
): Promise<string> {
  const repo = await createGitHubRepository(name, visibility);

  // Point the bare repo at the new remote and push the initial commit.
  // If any post-create step fails, delete the GitHub repo so we don't leave orphans.
  try {
    await git(["remote", "add", "origin", repo.url], bare);
    await git(["push", "--all", "origin"], bare);
    return repo.url;
  } catch (err) {
    await deleteGitHubRepository(repo.fullName).catch(() => {});
    throw err;
  }
}

// ── Init a brand-new project (optionally on GitHub) ─────────────────

export interface InitProjectResult {
  state: ProjectState;
  /** Set when the user requested GitHub creation but it failed (graceful degradation). */
  warning?: string;
}

export async function initProject(
  name: string,
  options: { visibility?: "public" | "private" } = {},
  dataDir = getDataDir(),
): Promise<InitProjectResult> {
  const repoName = validateGitHubRepositoryName(name);
  const id = `proj-${nanoid(8)}`;
  const projectDir = join(dataDir, id);
  const bare = bareRepoPath(dataDir, id);
  const wsDir = join(projectDir, "workspaces");
  const logsDir = join(projectDir, "logs");
  const tempWork = join(projectDir, `_init-temp-${nanoid(4)}`);

  await mkdir(projectDir, { recursive: true });

  try {
    // 1. Create a bare repo
    await git(["init", "--bare", bare]);

    // 2. Clone locally to seed the initial commit
    await git(["clone", bare, tempWork]);
    await git(["checkout", "-b", "main"], tempWork);
    await git(["config", "user.email", "hive@local"], tempWork);
    await git(["config", "user.name", "Hive"], tempWork);

    await writeFile(join(tempWork, "README.md"), `# ${repoName}\n`);
    await writeFile(join(tempWork, ".gitignore"), "node_modules/\n.env\n.DS_Store\n");
    await git(["add", "."], tempWork);
    await git(["commit", "-m", "Initial commit"], tempWork);
    await git(["push", "origin", "main"], tempWork);
    await git(["symbolic-ref", "HEAD", "refs/heads/main"], bare);

    // 3. Clean up the temp working tree and create workspace/log dirs
    await rm(tempWork, { recursive: true, force: true });
    await mkdir(wsDir, { recursive: true });
    await mkdir(logsDir, { recursive: true });
  } catch (err) {
    // Clean up partially-created project directory on failure
    await rm(projectDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }

  // 4. Save as local-only first so the project is usable even if GitHub fails
  const state: ProjectState = {
    id,
    name: repoName,
    url: undefined,
    createdAt: new Date().toISOString(),
    workspaces: [],
  };
  await saveProject(state, dataDir);

  // 5. Optionally create on GitHub, then update the saved state with the URL.
  //    If GitHub creation fails, gracefully degrade to local-only rather than
  //    propagating the error (the local project is already usable).
  let warning: string | undefined;
  if (options.visibility) {
    try {
      const url = await createGitHubRepo(repoName, options.visibility, bare);
      state.url = url;
      await saveProject(state, dataDir);
    } catch (err) {
      warning = `GitHub repo creation failed: ${err instanceof Error ? err.message : "unknown error"}`;
    }
  }

  return { state, warning };
}

export async function listProjects(
  dataDir = getDataDir()
): Promise<ProjectState[]> {
  return loadAllProjects(dataDir);
}

export async function getProject(
  projectId: string,
  dataDir = getDataDir()
): Promise<ProjectState | null> {
  return loadProject(projectId, dataDir);
}

export async function deleteProject(
  projectId: string,
  dataDir = getDataDir()
): Promise<void> {
  const projectDir = join(dataDir, projectId);
  await rm(projectDir, { recursive: true, force: true });
  notifyProjectDeleted(projectId);
  await pruneProjectFromUiPreferences(projectId, dataDir);
}

export async function fetchProject(
  projectId: string,
  dataDir = getDataDir()
): Promise<void> {
  const state = await loadProject(projectId, dataDir);
  if (!state) throw new NotFoundError(`Project ${projectId} not found`);
  if (!state.url) throw new Error("Project has no remote — nothing to fetch");
  const bare = bareRepoPath(dataDir, projectId);
  await git(["fetch", "--all"], bare);
}
