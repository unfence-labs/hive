import type { Stats } from "node:fs";
import { mkdir, open, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { BrainFileContent, WorkspaceFileTreeNode } from "../types.js";
import { buildFileTree } from "../utils/file-tree.js";
import { BadRequestError, ConflictError, NotFoundError } from "../utils/errors.js";
import { MAX_TEXT_FILE_SIZE, resolveSafeRepoFilePath } from "../utils/repo-files.js";
import { brainRepoPath } from "../utils/paths.js";
import { getDataDir } from "../state/state.js";
import { loadBrainState } from "../state/brain.js";

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
  const absolutePath = await resolveSafeRepoFilePath(repoPath, relPath);

  let fileStat: Stats;
  try {
    fileStat = await stat(absolutePath);
  } catch {
    throw new NotFoundError(`File not found: ${relPath}`);
  }
  if (!fileStat.isFile()) {
    throw new BadRequestError("Path is not a file");
  }

  // The agent can write notes directly to disk (its own Write tool bypasses the
  // size-checked write path), so any finite cap can be exceeded. Rather than
  // making such a note unviewable, return a bounded prefix and flag it as
  // truncated; the UI renders truncated files read-only so a save can never
  // overwrite the dropped tail.
  if (fileStat.size > MAX_TEXT_FILE_SIZE) {
    const handle = await open(absolutePath, "r");
    try {
      const buffer = Buffer.alloc(MAX_TEXT_FILE_SIZE);
      const { bytesRead } = await handle.read(buffer, 0, MAX_TEXT_FILE_SIZE, 0);
      const content = buffer.subarray(0, bytesRead).toString("utf-8");
      return { path: relPath, content, truncated: true };
    } finally {
      await handle.close();
    }
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
  const absolutePath = await resolveSafeRepoFilePath(repoPath, relPath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, "utf-8");
  return { path: relPath, content };
}
