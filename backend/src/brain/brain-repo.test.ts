import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
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
  // createBrain commits internally and no longer configures a repo-local git
  // identity (production uses the developer's own git config). Provide an
  // identity via env so the commit also works where no global git config exists
  // (e.g. CI). Scoped + restored so it doesn't leak to other tests.
  const IDENTITY_ENV = {
    GIT_AUTHOR_NAME: "Brain Test",
    GIT_AUTHOR_EMAIL: "brain-test@hive.dev",
    GIT_COMMITTER_NAME: "Brain Test",
    GIT_COMMITTER_EMAIL: "brain-test@hive.dev",
  } as const;
  const savedIdentityEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const [key, value] of Object.entries(IDENTITY_ENV)) {
      savedIdentityEnv[key] = process.env[key];
      process.env[key] = value;
    }
  });

  afterEach(() => {
    for (const key of Object.keys(IDENTITY_ENV)) {
      const prev = savedIdentityEnv[key];
      if (prev === undefined) delete process.env[key];
      else process.env[key] = prev;
    }
  });

  it("creates a normal clone, seeds README, commits, pushes, and persists state", async () => {
    const origin = join(tempDir, "brain-origin.git");
    await createEmptyBareRepo(origin);

    const state = await createBrain("my-brain", dataDir, {
      createRemote: async (name) => ({
        owner: "octocat",
        name,
        fullName: `octocat/${name}`,
        url: origin,
      }),
      deleteRemote: async () => {},
      now: () => new Date("2026-06-05T12:00:00.000Z"),
    });

    expect(state).toEqual({
      exists: true,
      repoUrl: origin,
      createdAt: "2026-06-05T12:00:00.000Z",
      lastSyncedAt: "2026-06-05T12:00:00.000Z",
      repoPath: brainRepoPath(dataDir),
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
    expect(state.createdAt).toBe("2026-06-05T13:00:00.000Z");
    expect(state.lastSyncedAt).toBe("2026-06-05T13:00:00.000Z");
    expect(existsSync(join(brainRepoPath(dataDir), ".git"))).toBe(true);
    const { stdout } = await git(["remote", "get-url", "origin"], brainRepoPath(dataDir));
    expect(stdout).toBe(origin);
  });

  it("normalizes a GitHub SSH URL before cloning and persisting it", async () => {
    const gitModule = await import("../utils/git.js");
    const gitSpy = vi.spyOn(gitModule, "git").mockResolvedValue({ stdout: "", stderr: "" });
    try {
      const state = await connectBrain("git@github.com:octocat/brain.git", dataDir);
      expect(state.repoUrl).toBe("https://github.com/octocat/brain.git");
      expect(gitSpy).toHaveBeenCalledWith([
        "clone",
        "https://github.com/octocat/brain.git",
        brainRepoPath(dataDir),
      ]);
    } finally {
      gitSpy.mockRestore();
    }
  });

  it("rejects a second Brain", async () => {
    const fixtureDir = join(tempDir, "fixtures");
    await mkdir(fixtureDir, { recursive: true });
    const origin = await createFixtureRepo(fixtureDir);

    await connectBrain(origin, dataDir);
    await expect(connectBrain(origin, dataDir)).rejects.toThrow("Brain already exists");
  });
});

describe("loadBrainState", () => {
  it("hydrates legacy state with createdAt as lastSyncedAt", async () => {
    const createdAt = "2026-06-05T14:00:00.000Z";
    await mkdir(join(dataDir, "brain"), { recursive: true });
    await writeFile(
      join(dataDir, "brain", "state.json"),
      JSON.stringify({
        exists: true,
        repoUrl: "git@example.com:octocat/brain.git",
        createdAt,
      }),
      "utf-8",
    );

    await expect(loadBrainState(dataDir)).resolves.toMatchObject({
      exists: true,
      createdAt,
      lastSyncedAt: createdAt,
      repoPath: brainRepoPath(dataDir),
    });
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
