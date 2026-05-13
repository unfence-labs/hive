import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createTempDir } from "../utils/test-helpers.js";
import {
  copyProjectEnvToWorkspace,
  deleteProjectEnv,
  loadProjectEnv,
  projectEnvPath,
  saveProjectEnv,
} from "./project-env.js";

let tempDir: string;
let dataDir: string;

beforeEach(async () => {
  tempDir = await createTempDir("hive-project-env-test-");
  dataDir = join(tempDir, "data");
  await mkdir(dataDir, { recursive: true });
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("project environment storage", () => {
  it("returns not configured when no project .env exists", async () => {
    await expect(loadProjectEnv("proj-1", dataDir)).resolves.toEqual({
      exists: false,
      content: "",
    });
  });

  it("saves, loads, and deletes a project .env", async () => {
    const saved = await saveProjectEnv("proj-1", "API_KEY=secret\n", dataDir);

    expect(saved.exists).toBe(true);
    expect(saved.content).toBe("API_KEY=secret\n");
    expect(saved.path).toBe(projectEnvPath(dataDir, "proj-1"));
    expect(saved.sizeBytes).toBe(Buffer.byteLength("API_KEY=secret\n"));
    expect(saved.updatedAt).toBeTruthy();
    expect(await readFile(projectEnvPath(dataDir, "proj-1"), "utf-8")).toBe("API_KEY=secret\n");

    await deleteProjectEnv("proj-1", dataDir);
    expect(await loadProjectEnv("proj-1", dataDir)).toEqual({
      exists: false,
      content: "",
    });
  });

  it("rejects environment files larger than 256KB", async () => {
    await expect(saveProjectEnv("proj-1", "x".repeat(256 * 1024 + 1), dataDir))
      .rejects.toThrow("256KB or smaller");
  });
});

describe("copyProjectEnvToWorkspace", () => {
  it("does nothing when the project is not configured", async () => {
    const wsPath = join(tempDir, "workspace");
    await mkdir(wsPath, { recursive: true });

    await expect(copyProjectEnvToWorkspace("proj-1", wsPath, dataDir)).resolves.toBe(false);
    expect(existsSync(join(wsPath, ".env"))).toBe(false);
  });

  it("copies the configured project .env into a workspace", async () => {
    const wsPath = join(tempDir, "workspace");
    await mkdir(wsPath, { recursive: true });
    await saveProjectEnv("proj-1", "DATABASE_URL=postgres://local\n", dataDir);

    await expect(copyProjectEnvToWorkspace("proj-1", wsPath, dataDir)).resolves.toBe(true);
    expect(await readFile(join(wsPath, ".env"), "utf-8")).toBe("DATABASE_URL=postgres://local\n");
  });

  it("overwrites an existing workspace .env when called during workspace creation", async () => {
    const wsPath = join(tempDir, "workspace");
    await mkdir(wsPath, { recursive: true });
    await saveProjectEnv("proj-1", "API_KEY=managed\n", dataDir);
    await writeFile(join(wsPath, ".env"), "API_KEY=old\n", "utf-8");

    await copyProjectEnvToWorkspace("proj-1", wsPath, dataDir);

    expect(await readFile(join(wsPath, ".env"), "utf-8")).toBe("API_KEY=managed\n");
  });
});
