import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { getDataDir } from "./state.js";
import { BadRequestError } from "../utils/errors.js";
import {
  EMPTY_PROJECT_ENV_CONFIG,
  generateProjectEnvContent,
  hasProjectEnvVariables,
  normalizeProjectEnvConfig,
  parseProjectEnvConfig,
  validateProjectEnvConfig,
  type ProjectEnvConfig,
  type ProjectEnvData,
} from "@hive/shared/project-env";

const MAX_PROJECT_ENV_BYTES = 256 * 1024;

export function projectEnvPath(dataDir: string, projectId: string): string {
  return join(dataDir, projectId, "env", "env.json");
}

function assertEnvConfig(config: ProjectEnvConfig): ProjectEnvConfig {
  const normalized = normalizeProjectEnvConfig(config);
  const validation = validateProjectEnvConfig(normalized);
  if (!validation.valid) {
    throw new BadRequestError(validation.errors[0] ?? "Invalid environment config");
  }

  const generatedContent = generateProjectEnvContent(normalized);
  const size = Buffer.byteLength(generatedContent, "utf-8");
  if (size > MAX_PROJECT_ENV_BYTES) {
    throw new BadRequestError("Environment file must be 256KB or smaller");
  }

  const jsonSize = Buffer.byteLength(JSON.stringify(normalized), "utf-8");
  if (jsonSize > MAX_PROJECT_ENV_BYTES) {
    throw new BadRequestError("Environment config must be 256KB or smaller");
  }

  return normalized;
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
    const config = parseProjectEnvConfig(JSON.parse(content));
    if (!config) {
      throw new BadRequestError("Invalid project environment config");
    }

    return {
      exists: true,
      config,
      path,
      sizeBytes: info.size,
      updatedAt: info.mtime.toISOString(),
    };
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { exists: false, config: EMPTY_PROJECT_ENV_CONFIG };
    }
    throw err;
  }
}

export async function saveProjectEnv(
  projectId: string,
  config: ProjectEnvConfig,
  dataDir = getDataDir(),
): Promise<ProjectEnvData> {
  const normalized = assertEnvConfig(config);
  if (!hasProjectEnvVariables(normalized)) {
    await deleteProjectEnv(projectId, dataDir);
    return { exists: false, config: EMPTY_PROJECT_ENV_CONFIG };
  }

  const dir = join(dataDir, projectId, "env");
  await mkdir(dir, { recursive: true });

  const target = projectEnvPath(dataDir, projectId);
  const tmp = join(dir, `env.${randomUUID()}.json.tmp`);
  await writeFile(tmp, `${JSON.stringify(normalized, null, 2)}\n`, { encoding: "utf-8", mode: 0o600 });
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
  const env = await loadProjectEnv(projectId, dataDir);
  if (!env.exists) return false;

  const content = generateProjectEnvContent(env.config);
  if (!content) return false;

  const target = join(workspacePath, ".env");
  await writeFile(target, content, { encoding: "utf-8", mode: 0o600 });
  await chmod(target, 0o600).catch(() => {});
  return true;
}
