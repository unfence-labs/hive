import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { BrainState } from "../types.js";
import { brainDir, brainRepoPath } from "../utils/paths.js";
import { getDataDir, writeJsonAtomic } from "./state.js";

function brainStateFile(dataDir: string): string {
  return join(brainDir(dataDir), "state.json");
}

/** Load the singleton Brain state, returning `{ exists: false }` when absent. */
export async function loadBrainState(dataDir = getDataDir()): Promise<BrainState> {
  try {
    const raw = await readFile(brainStateFile(dataDir), "utf-8");
    const state = JSON.parse(raw) as BrainState;
    // Re-derive the local clone path on every read so it always reflects the
    // current data dir (and is present even for states persisted before the
    // field existed) — the persisted value is never trusted.
    return state.exists ? { ...state, repoPath: brainRepoPath(dataDir) } : state;
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { exists: false };
    console.warn("Corrupt or unreadable Brain state, treating as missing:", err);
    return { exists: false };
  }
}

/** Persist the singleton Brain state. */
export async function saveBrainState(
  state: Extract<BrainState, { exists: true }>,
  dataDir = getDataDir(),
): Promise<void> {
  await writeJsonAtomic(brainStateFile(dataDir), state, brainDir(dataDir));
}

/** Remove the persisted Brain state file if present. */
export async function deleteBrainState(dataDir = getDataDir()): Promise<void> {
  try {
    await unlink(brainStateFile(dataDir));
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}
