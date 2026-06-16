import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getDataDir, writeJsonAtomic } from "./state.js";
import { getDefaultThinkingLevelForModel, isThinkingLevelSupportedForModel } from "../agents/providers/registry.js";
import type { Agent, ThinkingLevel } from "../types.js";

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

function normalizeAgent(raw: Agent): Agent {
  const fallbackThinkingLevel = getDefaultThinkingLevelForModel(raw.modelId) ?? "high";
  const rawThinkingLevel = (raw as Agent & { thinkingLevel?: ThinkingLevel }).thinkingLevel;
  const thinkingLevel = rawThinkingLevel && isThinkingLevelSupportedForModel(raw.modelId, rawThinkingLevel)
    ? rawThinkingLevel
    : fallbackThinkingLevel;
  return {
    ...raw,
    thinkingLevel,
  };
}

export async function loadAgents(dataDir = getDataDir()): Promise<Agent[]> {
  try {
    const raw = await readFile(agentsFilePath(dataDir), "utf-8");
    return (JSON.parse(raw) as Agent[]).map(normalizeAgent);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

export async function saveAgents(agents: Agent[], dataDir = getDataDir()): Promise<void> {
  await writeJsonAtomic(agentsFilePath(dataDir), agents, dataDir);
}
