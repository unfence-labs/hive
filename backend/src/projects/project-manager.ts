import { join } from "node:path";
import { rm, mkdir } from "node:fs/promises";
import { nanoid } from "nanoid";
import { git } from "../utils/git.js";
import { saveProject, loadProject, loadAllProjects, deleteProjectState, getDataDir } from "../state/state.js";
import type { Project, ProjectState } from "../types.js";

function repoPath(dataDir: string, projectId: string): string {
  return join(dataDir, projectId, "repo.git");
}

function extractRepoName(url: string): string {
  const match = url.match(/\/([^/]+?)(?:\.git)?$/);
  return match?.[1] ?? "unnamed";
}

export async function createProject(
  url: string,
  dataDir = getDataDir()
): Promise<ProjectState> {
  if (!url || typeof url !== "string") {
    throw new Error("Invalid repository URL");
  }

  const id = `proj-${nanoid(8)}`;
  const bare = repoPath(dataDir, id);
  const wsDir = join(dataDir, id, "workspaces");
  const logsDir = join(dataDir, id, "logs");

  await mkdir(join(dataDir, id), { recursive: true });
  await git(["clone", "--bare", url, bare]);
  await mkdir(wsDir, { recursive: true });
  await mkdir(logsDir, { recursive: true });

  const state: ProjectState = {
    id,
    name: extractRepoName(url),
    url,
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
  if (!state) throw new Error(`Project ${projectId} not found`);
  const bare = repoPath(dataDir, projectId);
  await git(["fetch", "--all"], bare);
}
