import { join } from "node:path";
import { rm, mkdir } from "node:fs/promises";
import { nanoid } from "nanoid";
import { git } from "../utils/git.js";
import { bareRepoPath } from "../utils/paths.js";
import { saveProject, loadProject, loadAllProjects, getDataDir } from "../state/state.js";
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

  const id = `proj-${nanoid(8)}`;
  const bare = bareRepoPath(dataDir, id);
  const wsDir = join(dataDir, id, "workspaces");
  const logsDir = join(dataDir, id, "logs");

  await mkdir(join(dataDir, id), { recursive: true });
  await git(["clone", "--bare", validatedUrl, bare]);
  await mkdir(wsDir, { recursive: true });
  await mkdir(logsDir, { recursive: true });

  const state: ProjectState = {
    id,
    name: extractRepoName(validatedUrl),
    url: validatedUrl,
    createdAt: new Date().toISOString(),
    workspaces: [],
  };
  await saveProject(state, dataDir);
  return state;
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
}

export async function fetchProject(
  projectId: string,
  dataDir = getDataDir()
): Promise<void> {
  const state = await loadProject(projectId, dataDir);
  if (!state) throw new NotFoundError(`Project ${projectId} not found`);
  const bare = bareRepoPath(dataDir, projectId);
  await git(["fetch", "--all"], bare);
}
