import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { getDataDir } from "./state.js";
import { BadRequestError } from "../utils/errors.js";
import type { ProjectEnvData } from "../types.js";

const MAX_PROJECT_ENV_BYTES = 256 * 1024;

export function projectEnvPath(dataDir: string, projectId: string): string {
  return join(dataDir, projectId, "env", ".env");
}

function assertEnvSize(content: string): void {
  const size = Buffer.byteLength(content, "utf-8");
  if (size > MAX_PROJECT_ENV_BYTES) {
    throw new BadRequestError("Environment file must be 256KB or smaller");
  }
}

export async function loadProjectEnv(
  projectId: string,
  dataDir = getDataDir(),
): Promise<ProjectEnvData> {
  const path = projectEnvPath(dataDir, projectId);
  try {
    const [content, info] = await Promise.all([
      readFile(path, "utf-8"),
      stat(path),
    ]);
    return {
      exists: true,
      content,
      path,
      sizeBytes: info.size,
      updatedAt: info.mtime.toISOString(),
    };
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { exists: false, content: "" };
    }
    throw err;
  }
}

export async function saveProjectEnv(
  projectId: string,
  content: string,
  dataDir = getDataDir(),
): Promise<ProjectEnvData> {
  assertEnvSize(content);

  const dir = join(dataDir, projectId, "env");
  await mkdir(dir, { recursive: true });

  const target = projectEnvPath(dataDir, projectId);
  const tmp = join(dir, `.env.${randomUUID()}.tmp`);
  await writeFile(tmp, content, { encoding: "utf-8", mode: 0o600 });
  await rename(tmp, target);
  await chmod(target, 0o600).catch(() => {});

  return loadProjectEnv(projectId, dataDir);
}

export async function deleteProjectEnv(
  projectId: string,
  dataDir = getDataDir(),
): Promise<void> {
  await rm(projectEnvPath(dataDir, projectId), { force: true });
}

export async function copyProjectEnvToWorkspace(
  projectId: string,
  workspacePath: string,
  dataDir = getDataDir(),
): Promise<boolean> {
  const source = projectEnvPath(dataDir, projectId);
  let content: string;
  try {
    content = await readFile(source, "utf-8");
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }

  const target = join(workspacePath, ".env");
  await writeFile(target, content, { encoding: "utf-8", mode: 0o600 });
  await chmod(target, 0o600).catch(() => {});
  return true;
}
