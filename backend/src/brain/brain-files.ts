import type { Stats } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import type { BrainFileContent, WorkspaceFileTreeNode } from "../types.js";
import { buildFileTree } from "../utils/file-tree.js";
import { BadRequestError, ConflictError, NotFoundError } from "../utils/errors.js";
import { brainRepoPath } from "../utils/paths.js";
import { getDataDir } from "../state/state.js";
import { loadBrainState } from "../state/brain.js";

const MAX_FILE_SIZE = 1024 * 1024; // 1 MB

/**
 * Resolve the Brain repository path, asserting the Brain exists.
 * Throws {@link ConflictError} (409) when no Brain is connected.
 */
export async function requireBrainRepo(dataDir = getDataDir()): Promise<string> {
  const state = await loadBrainState(dataDir);
  if (!state.exists) {
    throw new ConflictError("Brain is not connected");
  }
  return brainRepoPath(dataDir);
}

/**
 * Resolve a Brain-relative path to an absolute path, rejecting traversal
 * outside the repo and any attempt to touch the `.git` directory.
 */
export function resolveBrainFilePath(repoPath: string, relPath: string): string {
  if (!relPath || !relPath.trim()) {
    throw new BadRequestError("Missing file path");
  }
  const root = resolve(repoPath);
  const resolved = resolve(root, relPath);
  if (resolved !== root && !resolved.startsWith(`${root}${sep}`)) {
    throw new BadRequestError("Invalid file path");
  }
  if (resolved === root) {
    throw new BadRequestError("Invalid file path");
  }
  const gitDir = `${root}${sep}.git`;
  if (resolved === gitDir || resolved.startsWith(`${gitDir}${sep}`)) {
    throw new BadRequestError("Refusing to access the .git directory");
  }
  return resolved;
}

/** List the Brain working-tree files as a recursive tree (`.git` excluded). */
export async function listBrainFiles(
  dataDir = getDataDir(),
): Promise<WorkspaceFileTreeNode[]> {
  const repoPath = await requireBrainRepo(dataDir);
  return buildFileTree(repoPath);
}

/** Read a single Brain file's text content. Throws 404 when absent. */
export async function readBrainFile(
  relPath: string,
  dataDir = getDataDir(),
): Promise<BrainFileContent> {
  const repoPath = await requireBrainRepo(dataDir);
  const absolutePath = resolveBrainFilePath(repoPath, relPath);

  let fileStat: Stats;
  try {
    fileStat = await stat(absolutePath);
  } catch {
    throw new NotFoundError(`File not found: ${relPath}`);
  }
  if (!fileStat.isFile()) {
    throw new BadRequestError("Path is not a file");
  }
  if (fileStat.size > MAX_FILE_SIZE) {
    throw new BadRequestError(`File too large (${Math.round(fileStat.size / 1024)}KB, max 1MB)`);
  }

  const content = await readFile(absolutePath, "utf-8");
  return { path: relPath, content };
}

/**
 * Create or overwrite a Brain file on disk (working tree only — no commit).
 * Parent directories are created as needed.
 */
export async function writeBrainFile(
  relPath: string,
  content: string,
  dataDir = getDataDir(),
): Promise<BrainFileContent> {
  const repoPath = await requireBrainRepo(dataDir);
  const absolutePath = resolveBrainFilePath(repoPath, relPath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, "utf-8");
  return { path: relPath, content };
}
