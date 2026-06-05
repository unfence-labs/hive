import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { createTempDir, createFixtureRepo } from "../utils/test-helpers.js";
import { git } from "../utils/git.js";
import { brainRepoPath } from "../utils/paths.js";
import { connectBrain, createBrain, deleteBrain } from "./brain-repo.js";
import { loadBrainState } from "../state/brain.js";

let tempDir: string;
let dataDir: string;

beforeEach(async () => {
  tempDir = await createTempDir("hive-brain-repo-test-");
  dataDir = join(tempDir, "data");
  await mkdir(dataDir, { recursive: true });
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

async function createEmptyBareRepo(path: string): Promise<void> {
  await git(["init", "--bare", path]);
}

describe("createBrain", () => {
  it("creates a normal clone, seeds README, commits, pushes, and persists state", async () => {
    const origin = join(tempDir, "brain-origin.git");
    await createEmptyBareRepo(origin);

    const state = await createBrain("my-brain", dataDir, {
      createRemote: async (name) => ({
        owner: "octocat",
        name,
        fullName: `octocat/${name}`,
        sshUrl: origin,
      }),
      deleteRemote: async () => {},
      now: () => new Date("2026-06-05T12:00:00.000Z"),
    });

    expect(state).toEqual({
      exists: true,
      repoUrl: origin,
      createdAt: "2026-06-05T12:00:00.000Z",
    });
    expect(existsSync(join(brainRepoPath(dataDir), ".git"))).toBe(true);

    const { stdout: readme } = await git(["show", "main:README.md"], origin);
    expect(readme).toContain("# my-brain");
    expect(readme).toContain("Hive Brain knowledge base");
    await expect(loadBrainState(dataDir)).resolves.toEqual(state);
  });
});

describe("connectBrain", () => {
  it("normal-clones an existing local origin and persists state", async () => {
    const fixtureDir = join(tempDir, "fixtures");
    await mkdir(fixtureDir, { recursive: true });
    const origin = await createFixtureRepo(fixtureDir);

    const state = await connectBrain(origin, dataDir, {
      now: () => new Date("2026-06-05T13:00:00.000Z"),
    });

    expect(state.repoUrl).toBe(origin);
    expect(existsSync(join(brainRepoPath(dataDir), ".git"))).toBe(true);
    const { stdout } = await git(["remote", "get-url", "origin"], brainRepoPath(dataDir));
    expect(stdout).toBe(origin);
  });

  it("rejects a second Brain", async () => {
    const fixtureDir = join(tempDir, "fixtures");
    await mkdir(fixtureDir, { recursive: true });
    const origin = await createFixtureRepo(fixtureDir);

    await connectBrain(origin, dataDir);
    await expect(connectBrain(origin, dataDir)).rejects.toThrow("Brain already exists");
  });
});

describe("deleteBrain", () => {
  it("removes state and the normal clone", async () => {
    const fixtureDir = join(tempDir, "fixtures");
    await mkdir(fixtureDir, { recursive: true });
    const origin = await createFixtureRepo(fixtureDir);

    await connectBrain(origin, dataDir);
    expect(existsSync(brainRepoPath(dataDir))).toBe(true);

    await deleteBrain(dataDir);

    expect(existsSync(brainRepoPath(dataDir))).toBe(false);
    await expect(loadBrainState(dataDir)).resolves.toEqual({ exists: false });
  });
});
