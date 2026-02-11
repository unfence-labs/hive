import { readdir, readFile, writeFile, rename, unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ProjectState } from "../types.js";

export function getDataDir(): string {
  return process.env.DATA_DIR ?? "/data/projects";
}

function stateFilePath(dataDir: string, projectId: string): string {
  return join(dataDir, projectId, "state.json");
}

export async function loadProject(
  projectId: string,
  dataDir = getDataDir()
): Promise<ProjectState | null> {
  try {
    const raw = await readFile(stateFilePath(dataDir, projectId), "utf-8");
    return JSON.parse(raw) as ProjectState;
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    console.warn(`Corrupt or unreadable state for ${projectId}, skipping:`, err);
    return null;
  }
}

export async function loadAllProjects(
  dataDir = getDataDir()
): Promise<ProjectState[]> {
  let entries: string[];
  try {
    entries = await readdir(dataDir);
  } catch {
    return [];
  }

  const results: ProjectState[] = [];
  for (const entry of entries) {
    const state = await loadProject(entry, dataDir);
    if (state) results.push(state);
  }
  return results;
}

export async function saveProject(
  state: ProjectState,
  dataDir = getDataDir()
): Promise<void> {
  const dir = join(dataDir, state.id);
  await mkdir(dir, { recursive: true });
  const target = stateFilePath(dataDir, state.id);
  const tmp = join(dir, `state.${randomUUID()}.tmp`);
  await writeFile(tmp, JSON.stringify(state, null, 2), "utf-8");
  await rename(tmp, target);
}

export async function deleteProjectState(
  projectId: string,
  dataDir = getDataDir()
): Promise<void> {
  try {
    await unlink(stateFilePath(dataDir, projectId));
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}
