import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { getDataDir } from "./state.js";
import type { PromptTemplate } from "../types.js";

let templatesLock: Promise<void> = Promise.resolve();

export async function withTemplatesLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = templatesLock;
  let release: (() => void) | undefined;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  templatesLock = prev.then(() => current);

  await prev;
  try {
    return await fn();
  } finally {
    release?.();
  }
}

function templatesFilePath(dataDir: string): string {
  return join(dataDir, "prompt-templates.json");
}

async function atomicWrite(filePath: string, data: unknown, dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `tmp.${randomUUID()}.json`);
  await writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
  await rename(tmp, filePath);
}

export async function loadPromptTemplates(dataDir = getDataDir()): Promise<PromptTemplate[]> {
  try {
    const raw = await readFile(templatesFilePath(dataDir), "utf-8");
    return JSON.parse(raw) as PromptTemplate[];
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

export async function savePromptTemplates(
  templates: PromptTemplate[],
  dataDir = getDataDir(),
): Promise<void> {
  await atomicWrite(templatesFilePath(dataDir), templates, dataDir);
}
