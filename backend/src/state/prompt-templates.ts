import { readFile, writeFile, rename, mkdir, readdir, unlink } from "node:fs/promises";
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

function promptsDir(dataDir: string): string {
  return join(dataDir, "prompts");
}

// ── Frontmatter serialization ───────────────────────────────────────

function serializeTemplate(tpl: PromptTemplate): string {
  const lines = [
    "---",
    `id: ${tpl.id}`,
    `name: ${tpl.name}`,
    `type: ${tpl.type}`,
    `createdAt: ${tpl.createdAt}`,
    `updatedAt: ${tpl.updatedAt}`,
    "---",
    tpl.content,
  ];
  return lines.join("\n");
}

function parseTemplate(raw: string, filename: string): PromptTemplate | null {
  if (!raw.startsWith("---\n")) return null;
  const endIdx = raw.indexOf("\n---\n", 4);
  if (endIdx === -1) return null;

  const frontmatter = raw.slice(4, endIdx);
  const content = raw.slice(endIdx + 5); // skip \n---\n

  const fields: Record<string, string> = {};
  for (const line of frontmatter.split("\n")) {
    const colonIdx = line.indexOf(": ");
    if (colonIdx === -1) continue;
    fields[line.slice(0, colonIdx)] = line.slice(colonIdx + 2);
  }

  const id = fields.id || filename.replace(/\.md$/, "");
  if (!id || !fields.name || !fields.type) return null;

  return {
    id,
    name: fields.name,
    type: fields.type as "system" | "user",
    content,
    createdAt: fields.createdAt || new Date().toISOString(),
    updatedAt: fields.updatedAt || new Date().toISOString(),
  };
}

// ── Public API ──────────────────────────────────────────────────────

export async function loadPromptTemplates(dataDir = getDataDir()): Promise<PromptTemplate[]> {
  const dir = promptsDir(dataDir);
  let files: string[];
  try {
    files = await readdir(dir);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const templates: PromptTemplate[] = [];
  for (const file of files) {
    if (!file.endsWith(".md")) continue;
    try {
      const raw = await readFile(join(dir, file), "utf-8");
      const tpl = parseTemplate(raw, file);
      if (tpl) templates.push(tpl);
    } catch {
      // Skip unreadable files
    }
  }

  return templates;
}

export async function savePromptTemplate(
  tpl: PromptTemplate,
  dataDir = getDataDir(),
): Promise<void> {
  const dir = promptsDir(dataDir);
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, `${tpl.id}.md`);
  const tmp = join(dir, `tmp.${randomUUID()}.md`);
  await writeFile(tmp, serializeTemplate(tpl), "utf-8");
  await rename(tmp, filePath);
}

export async function deletePromptTemplate(
  id: string,
  dataDir = getDataDir(),
): Promise<boolean> {
  const filePath = join(promptsDir(dataDir), `${id}.md`);
  try {
    await unlink(filePath);
    return true;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

/**
 * @deprecated Use savePromptTemplate() for single writes.
 * Kept for bulk operations in tests — writes all templates at once.
 */
export async function savePromptTemplates(
  templates: PromptTemplate[],
  dataDir = getDataDir(),
): Promise<void> {
  const dir = promptsDir(dataDir);
  await mkdir(dir, { recursive: true });
  for (const tpl of templates) {
    await savePromptTemplate(tpl, dataDir);
  }
}
