import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTempDir, createFixtureRepo } from "../utils/test-helpers.js";
import { createProject } from "../projects/project-manager.js";
import { git } from "../utils/git.js";

const mocks = vi.hoisted(() => ({
  startScript: vi.fn(),
  stopAllForWorkspace: vi.fn(),
}));

vi.mock("../services/script-runner.js", () => ({
  startScript: mocks.startScript,
  stopAllForWorkspace: mocks.stopAllForWorkspace,
}));

import { createWorkspace, listWorkspaces } from "./workspace-manager.js";

let tempDir: string;
let dataDir: string;
let projectId: string;

beforeEach(async () => {
  tempDir = await createTempDir("hive-ws-script-autorun-test-");
  dataDir = join(tempDir, "data");
  const fixtureDir = join(tempDir, "fixtures");
  await mkdir(dataDir, { recursive: true });
  await mkdir(fixtureDir, { recursive: true });

  const fixtureRepoUrl = await createFixtureRepo(fixtureDir);
  const project = await createProject(fixtureRepoUrl, dataDir);
  projectId = project.id;

  mocks.startScript.mockReset();
  mocks.stopAllForWorkspace.mockReset();
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

async function waitForCondition(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      clearInterval(interval);
      reject(new Error("Timed out waiting for condition"));
    }, timeoutMs);

    const interval = setInterval(() => {
      if (!predicate()) return;
      clearTimeout(timeout);
      clearInterval(interval);
      resolve();
    }, 10);
  });
}

async function seedDefaultBranchHiveConfig(hiveConfig: object): Promise<void> {
  const bareRepo = join(dataDir, projectId, "repo.git");
  const seedPath = join(tempDir, "seed-default-branch");

  await git(["worktree", "add", seedPath, "main"], bareRepo);
  try {
    await writeFile(
      join(seedPath, "hive.json"),
      JSON.stringify(hiveConfig, null, 2),
      "utf-8",
    );
    await git(["add", "hive.json"], seedPath);
    await git(["config", "user.email", "test@hive.dev"], seedPath);
    await git(["config", "user.name", "Hive Test"], seedPath);
    await git(["commit", "-m", "seed hive config"], seedPath);
  } finally {
    await git(["worktree", "remove", seedPath, "--force"], bareRepo);
  }
}

describe("createWorkspace setup script auto-run", () => {
  it("starts setup script when hive.json defines scripts.setup", async () => {
    await seedDefaultBranchHiveConfig({
      scripts: {
        setup: "npm ci",
      },
    });

    const ws = await createWorkspace(projectId, dataDir);
    const wsPath = join(dataDir, projectId, "workspaces", ws.name);

    await waitForCondition(() => mocks.startScript.mock.calls.length > 0);

    expect(mocks.startScript).toHaveBeenCalledWith(ws.id, "setup", "npm ci", wsPath);
  });

  it("does not start script when hive.json has no setup command", async () => {
    await seedDefaultBranchHiveConfig({
      scripts: {
        run: "npm run dev",
      },
    });

    await createWorkspace(projectId, dataDir);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mocks.startScript).not.toHaveBeenCalled();
  });

  it("does not fail workspace creation if startScript throws", async () => {
    await seedDefaultBranchHiveConfig({
      scripts: {
        setup: "npm ci",
      },
    });
    mocks.startScript.mockImplementation(() => {
      throw new Error("process already running");
    });

    const ws = await createWorkspace(projectId, dataDir);
    await waitForCondition(() => mocks.startScript.mock.calls.length > 0);

    const list = await listWorkspaces(projectId, dataDir);
    expect(ws.id).toBeDefined();
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(ws.id);
  });
});
