import { readFile, writeFile, rename, unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { getDataDir } from "./state.js";

/** Shape returned for any editable prompt file (base, brain, ...). */
export interface PromptFileData {
  content: string;
  isDefault: boolean;
  defaultContent: string;
}

function promptsDir(dataDir: string): string {
  return join(dataDir, "prompts");
}

/**
 * Load an editable prompt file from `{dataDir}/prompts/{filename}`.
 * Returns the provided default (flagged `isDefault: true`) when the file is absent.
 */
export async function loadPromptFileData(
  filename: string,
  defaultContent: string,
  dataDir = getDataDir(),
): Promise<PromptFileData> {
  const filePath = join(promptsDir(dataDir), filename);
  try {
    const content = await readFile(filePath, "utf-8");
    return { content, isDefault: content === defaultContent, defaultContent };
  } catch {
    return { content: defaultContent, isDefault: true, defaultContent };
  }
}

/** Atomically write an editable prompt file (temp-write + rename, mkdir -p). */
export async function savePromptFile(
  filename: string,
  content: string,
  dataDir = getDataDir(),
): Promise<void> {
  const dir = promptsDir(dataDir);
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, filename);
  const tmp = join(dir, `${filename}.${randomUUID()}.tmp`);
  await writeFile(tmp, content, "utf-8");
  await rename(tmp, filePath);
}

/** Reset an editable prompt file by removing it (ENOENT is ignored). */
export async function resetPromptFile(
  filename: string,
  dataDir = getDataDir(),
): Promise<void> {
  const filePath = join(promptsDir(dataDir), filename);
  try {
    await unlink(filePath);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}
