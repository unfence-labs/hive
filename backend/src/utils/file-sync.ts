import { createHash, randomUUID } from "node:crypto";
import { cp, lstat, mkdir, realpath, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative } from "node:path";

export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export async function writeAtomic(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const extension = extname(filePath) || ".tmp";
  const tmp = join(dirname(filePath), `.tmp.${randomUUID()}${extension}`);
  await writeFile(tmp, content, "utf-8");
  await rename(tmp, filePath);
}

export async function copyDirectoryAtomic(sourceDir: string, targetDir: string): Promise<void> {
  await mkdir(dirname(targetDir), { recursive: true });
  const tmp = join(dirname(targetDir), `.tmp.${randomUUID()}`);
  try {
    await cp(sourceDir, tmp, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    await rename(tmp, targetDir);
  } catch (err) {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

export async function removePath(path: string): Promise<void> {
  try {
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) {
      await unlink(path);
    } else {
      await rm(path, { recursive: true, force: true });
    }
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

export async function ensureRelativeSymlink(
  linkPath: string,
  targetPath: string,
  type: "file" | "dir",
): Promise<void> {
  await mkdir(dirname(linkPath), { recursive: true });

  const existingRealPath = await realpath(linkPath).catch(() => undefined);
  const targetRealPath = await realpath(targetPath);
  if (existingRealPath === targetRealPath) return;

  const relativeTarget = relative(dirname(linkPath), targetPath) || targetPath;
  let backupPath: string | null = null;

  // Keep the original path restorable until the new symlink is definitely in place.
  try {
    await lstat(linkPath);
    backupPath = join(dirname(linkPath), `.hive-backup.${randomUUID()}`);
    await rename(linkPath, backupPath);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  try {
    await symlink(relativeTarget, linkPath, type);
    if (backupPath) await removePath(backupPath);
  } catch (err) {
    await removePath(linkPath).catch(() => {});
    if (backupPath) await rename(backupPath, linkPath).catch(() => {});
    throw err;
  }
}
