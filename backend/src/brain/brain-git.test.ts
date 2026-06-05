import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { createFixtureRepo, createTempDir } from "../utils/test-helpers.js";
import { git } from "../utils/git.js";
import { brainRepoPath } from "../utils/paths.js";
import { connectBrain } from "./brain-repo.js";
import { writeBrainFile } from "./brain-files.js";
import { getBrainDiff, getBrainStatus, saveBrain } from "./brain-git.js";

let tempDir: string;
let dataDir: string;
let origin: string;

beforeEach(async () => {
  tempDir = await createTempDir("hive-brain-git-test-");
  dataDir = join(tempDir, "data");
  await mkdir(dataDir, { recursive: true });
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

async function connectFixtureBrain(): Promise<void> {
  const fixtureDir = join(tempDir, "fixtures");
  await mkdir(fixtureDir, { recursive: true });
  origin = await createFixtureRepo(fixtureDir);
  await connectBrain(origin, dataDir);
  // Configure committer identity for the local clone.
  await git(["config", "user.email", "test@hive.dev"], brainRepoPath(dataDir));
  await git(["config", "user.name", "Hive Test"], brainRepoPath(dataDir));
}

describe("getBrainStatus", () => {
  it("returns no changes for a clean tree", async () => {
    await connectFixtureBrain();
    expect(await getBrainStatus(dataDir)).toEqual({ files: [], count: 0 });
  });

  it("reports modified, added (untracked), and deleted files", async () => {
    await connectFixtureBrain();
    // README.md is tracked (from the fixture); modify it.
    await writeBrainFile("README.md", "# Changed\n", dataDir);
    // Add a brand new untracked file.
    await writeBrainFile("new-note.md", "# New\n", dataDir);
    const status = await getBrainStatus(dataDir);
    const byPath = Object.fromEntries(status.files.map((f) => [f.path, f.status]));
    expect(byPath["README.md"]).toBe("modified");
    expect(byPath["new-note.md"]).toBe("untracked");
    expect(status.count).toBe(2);
  });
});

describe("getBrainDiff", () => {
  it("includes both a modified file and a new untracked file", async () => {
    await connectFixtureBrain();
    await writeBrainFile("README.md", "# Modified Repo\n", dataDir);
    await writeBrainFile("brand-new.md", "hello new\n", dataDir);

    const diff = await getBrainDiff(dataDir);
    // Modified tracked file appears via `git diff HEAD`.
    expect(diff).toContain("a/README.md");
    expect(diff).toContain("+# Modified Repo");
    // New untracked file appears via synthetic patch.
    expect(diff).toContain("b/brand-new.md");
    expect(diff).toContain("new file mode");
    expect(diff).toContain("+hello new");
  });
});

describe("saveBrain", () => {
  it("returns committed:false when there is nothing to commit", async () => {
    await connectFixtureBrain();
    expect(await saveBrain(undefined, dataDir)).toEqual({ committed: false, pushed: false });
  });

  it("commits and pushes pending changes", async () => {
    await connectFixtureBrain();
    await writeBrainFile("saved.md", "to be saved\n", dataDir);

    const result = await saveBrain("Add saved note", dataDir);
    expect(result).toEqual({ committed: true, pushed: true });

    // The commit landed on the origin bare repo.
    const { stdout } = await git(["log", "-1", "--pretty=%s", "main"], origin);
    expect(stdout).toBe("Add saved note");
    // Working tree is clean again.
    expect((await getBrainStatus(dataDir)).count).toBe(0);
  });

  it("uses a default commit message when none is provided", async () => {
    await connectFixtureBrain();
    await writeBrainFile("auto.md", "auto\n", dataDir);
    const result = await saveBrain(undefined, dataDir);
    expect(result.committed).toBe(true);
    const { stdout } = await git(["log", "-1", "--pretty=%s"], brainRepoPath(dataDir));
    expect(stdout).toMatch(/^Brain update /);
  });

  it("keeps the commit but reports pushed:false when push fails", async () => {
    await connectFixtureBrain();
    // Break the remote so push fails but the local commit still succeeds.
    await rm(origin, { recursive: true, force: true });
    await writeBrainFile("note.md", "content\n", dataDir);

    const result = await saveBrain("Will not push", dataDir);
    expect(result.committed).toBe(true);
    expect(result.pushed).toBe(false);
    expect(result.error).toBeTruthy();

    // The commit exists locally.
    const { stdout } = await git(["log", "-1", "--pretty=%s"], brainRepoPath(dataDir));
    expect(stdout).toBe("Will not push");
  });

  it("throws 409 when the Brain is not connected", async () => {
    await expect(saveBrain(undefined, dataDir)).rejects.toMatchObject({ statusCode: 409 });
  });
});
