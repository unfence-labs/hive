import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { getDataDir } from "./state.js";
import type { Agent } from "../types.js";

// Global lock for agents.json (shared array of all agent definitions).
// CRUD operations must serialize on this because they load-modify-save the same file.
let agentsLock: Promise<void> = Promise.resolve();

export async function withAgentsLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = agentsLock;
  let release: (() => void) | undefined;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  agentsLock = prev.then(() => current);

  await prev;
  try {
    return await fn();
  } finally {
    release?.();
  }
}

function agentsFilePath(dataDir: string): string {
  return join(dataDir, "agents.json");
}

async function atomicWrite(filePath: string, data: unknown, dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `tmp.${randomUUID()}.json`);
  await writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
  await rename(tmp, filePath);
}

export async function loadAgents(dataDir = getDataDir()): Promise<Agent[]> {
  try {
    const raw = await readFile(agentsFilePath(dataDir), "utf-8");
    return JSON.parse(raw) as Agent[];
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

export async function saveAgents(agents: Agent[], dataDir = getDataDir()): Promise<void> {
  await atomicWrite(agentsFilePath(dataDir), agents, dataDir);
}
