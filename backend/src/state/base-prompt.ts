import { readFile, writeFile, rename, unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { getDataDir } from "./state.js";
import { DEFAULT_BASE_PROMPT } from "../agents/system-prompt.js";

export interface BasePromptData {
  content: string;
  isDefault: boolean;
  defaultContent: string;
}

export async function loadBasePromptData(dataDir = getDataDir()): Promise<BasePromptData> {
  const filePath = join(dataDir, "prompts", "base.md");
  try {
    const content = await readFile(filePath, "utf-8");
    return { content, isDefault: content === DEFAULT_BASE_PROMPT, defaultContent: DEFAULT_BASE_PROMPT };
  } catch {
    return { content: DEFAULT_BASE_PROMPT, isDefault: true, defaultContent: DEFAULT_BASE_PROMPT };
  }
}

export async function saveBasePrompt(content: string, dataDir = getDataDir()): Promise<void> {
  const dir = join(dataDir, "prompts");
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, "base.md");
  const tmp = join(dir, `base.${randomUUID()}.tmp`);
  await writeFile(tmp, content, "utf-8");
  await rename(tmp, filePath);
}

export async function resetBasePrompt(dataDir = getDataDir()): Promise<void> {
  const filePath = join(dataDir, "prompts", "base.md");
  try {
    await unlink(filePath);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}
