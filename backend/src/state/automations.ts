import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { getDataDir } from "./state.js";
import type { Automation, AutomationRun } from "../types.js";

const MAX_RUNS = 50;

// Global lock for automations.json (shared array of all automation definitions).
// CRUD operations must serialize on this because they load-modify-save the same file.
let automationsLock: Promise<void> = Promise.resolve();

export async function withAutomationsLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = automationsLock;
  let release: (() => void) | undefined;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  automationsLock = prev.then(() => current);

  await prev;
  try {
    return await fn();
  } finally {
    release?.();
  }
}

// Per-automation lock for runs.json (each automation has its own file at
// ~/.hive/automations/<autoId>/runs.json). This allows concurrent run
// writes for different automations without blocking each other.
const runLocks = new Map<string, Promise<void>>();

export async function withAutomationRunLock<T>(
  automationId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = runLocks.get(automationId) ?? Promise.resolve();
  let release: (() => void) | undefined;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = prev.then(() => current);
  runLocks.set(automationId, queued);

  await prev;
  try {
    return await fn();
  } finally {
    release?.();
    if (runLocks.get(automationId) === queued) {
      runLocks.delete(automationId);
    }
  }
}

export function _clearAutomationLocksForTests(): void {
  runLocks.clear();
}

function automationsFilePath(dataDir: string): string {
  return join(dataDir, "automations.json");
}

function runsDir(automationId: string, dataDir: string): string {
  return join(dataDir, "automations", automationId);
}

function runsFilePath(automationId: string, dataDir: string): string {
  return join(runsDir(automationId, dataDir), "runs.json");
}

async function atomicWrite(filePath: string, data: unknown, dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `tmp.${randomUUID()}.json`);
  await writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
  await rename(tmp, filePath);
}

export async function loadAutomations(dataDir = getDataDir()): Promise<Automation[]> {
  try {
    const raw = await readFile(automationsFilePath(dataDir), "utf-8");
    return JSON.parse(raw) as Automation[];
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

export async function saveAutomations(
  automations: Automation[],
  dataDir = getDataDir(),
): Promise<void> {
  await atomicWrite(automationsFilePath(dataDir), automations, dataDir);
}

export async function loadRuns(
  automationId: string,
  dataDir = getDataDir(),
): Promise<AutomationRun[]> {
  try {
    const raw = await readFile(runsFilePath(automationId, dataDir), "utf-8");
    return JSON.parse(raw) as AutomationRun[];
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

export async function saveRuns(
  automationId: string,
  runs: AutomationRun[],
  dataDir = getDataDir(),
): Promise<void> {
  const dir = runsDir(automationId, dataDir);
  await atomicWrite(runsFilePath(automationId, dataDir), runs, dir);
}

export async function addRun(
  automationId: string,
  run: AutomationRun,
  dataDir = getDataDir(),
): Promise<void> {
  return withAutomationRunLock(automationId, async () => {
    const runs = await loadRuns(automationId, dataDir);
    runs.unshift(run);
    // Cap at MAX_RUNS, keeping newest first
    if (runs.length > MAX_RUNS) runs.length = MAX_RUNS;
    await saveRuns(automationId, runs, dataDir);
  });
}

export async function updateRun(
  automationId: string,
  runId: string,
  updates: Partial<AutomationRun>,
  dataDir = getDataDir(),
): Promise<void> {
  return withAutomationRunLock(automationId, async () => {
    const runs = await loadRuns(automationId, dataDir);
    const idx = runs.findIndex((r) => r.id === runId);
    if (idx === -1) return;
    runs[idx] = { ...runs[idx], ...updates };
    await saveRuns(automationId, runs, dataDir);
  });
}
