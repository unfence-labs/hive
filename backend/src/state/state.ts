import { readdir, readFile, writeFile, rename, unlink, mkdir, access } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import type { ProjectState } from "../types.js";
import { DEFAULT_BASE_PROMPT } from "../agents/system-prompt.js";
import { notifyProjectSaved } from "./workspace-index.js";

const projectLocks = new Map<string, Promise<void>>();

export function getDataDir(): string {
  const dir = process.env.DATA_DIR ?? join(homedir(), ".hive");
  return dir.startsWith("~/") ? join(homedir(), dir.slice(2)) : dir;
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
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(dataDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const results: ProjectState[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const state = await loadProject(entry.name, dataDir);
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
  notifyProjectSaved(state);
}

function projectLockKey(projectId: string, dataDir: string): string {
  return `${dataDir}::${projectId}`;
}

/**
 * Serialize state-changing operations for a given project to prevent
 * lost updates from concurrent load-modify-save flows.
 */
export async function withProjectStateLock<T>(
  projectId: string,
  fn: () => Promise<T>,
  dataDir = getDataDir()
): Promise<T> {
  const key = projectLockKey(projectId, dataDir);
  const prev = projectLocks.get(key) ?? Promise.resolve();

  let release: (() => void) | undefined;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = prev.then(() => current);
  projectLocks.set(key, queued);

  await prev;
  try {
    return await fn();
  } finally {
    release?.();
    if (projectLocks.get(key) === queued) {
      projectLocks.delete(key);
    }
  }
}

export function _clearProjectLocksForTests(): void {
  projectLocks.clear();
}

/**
 * Ensure the data directory structure exists and seed default files.
 * Called once at server startup.
 */
export async function ensureDataDir(dataDir = getDataDir()): Promise<void> {
  const promptsDir = join(dataDir, "prompts");
  await mkdir(promptsDir, { recursive: true });

  const basePromptPath = join(promptsDir, "base.md");
  try {
    await access(basePromptPath);
  } catch {
    await writeFile(basePromptPath, DEFAULT_BASE_PROMPT, "utf-8");
  }
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
