import { realpath, stat } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { BadRequestError } from "./errors.js";

/** Maximum size of a file served as text. Shared by workspace + Brain reads. */
export const MAX_TEXT_FILE_SIZE = 1024 * 1024; // 1 MB

/**
 * Lexically resolve a repo-relative path to an absolute path, rejecting:
 *  - traversal outside the repo (`..`, absolute escapes),
 *  - the repo root itself,
 *  - anything inside the `.git` directory.
 *
 * This is purely lexical and does NOT follow symlinks — pair it with
 * {@link assertRealPathInsideRepo} (or use {@link resolveSafeRepoFilePath})
 * whenever the path will be read from / written to disk.
 */
export function resolveRepoFilePath(repoPath: string, relPath: string): string {
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

/**
 * Defend against symlink escapes. {@link resolveRepoFilePath} is purely lexical
 * and does not follow symlinks, so a symlink committed inside the repo (or any
 * symlinked ancestor) could make `resolved` point outside the repo on disk.
 * Resolve the real path of the nearest existing ancestor — the missing
 * remainder cannot contain symlinks — and re-check containment (and `.git`)
 * against the real repo root.
 */
export async function assertRealPathInsideRepo(repoPath: string, resolved: string): Promise<void> {
  const realRoot = await realpath(repoPath);

  // Climb to the nearest ancestor that exists on disk. `resolved` is already
  // lexically contained in `repoPath`, so this stops at `repoPath` at worst.
  let existing = resolved;
  while (existing !== dirname(existing)) {
    try {
      await stat(existing);
      break;
    } catch {
      existing = dirname(existing);
    }
  }

  const realExisting = await realpath(existing);
  const remainder = relative(existing, resolved);
  const finalReal = remainder ? resolve(realExisting, remainder) : realExisting;

  const insideRoot = finalReal === realRoot || finalReal.startsWith(`${realRoot}${sep}`);
  const gitDir = `${realRoot}${sep}.git`;
  const touchesGit = finalReal === gitDir || finalReal.startsWith(`${gitDir}${sep}`);
  if (!insideRoot || touchesGit) {
    throw new BadRequestError("Invalid file path");
  }
}

/** Lexical resolve + symlink-escape guard in one call. */
export async function resolveSafeRepoFilePath(repoPath: string, relPath: string): Promise<string> {
  const resolved = resolveRepoFilePath(repoPath, relPath);
  await assertRealPathInsideRepo(repoPath, resolved);
  return resolved;
}
