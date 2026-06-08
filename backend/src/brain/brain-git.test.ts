import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { createFixtureRepo, createTempDir } from "../utils/test-helpers.js";
import { git } from "../utils/git.js";
import { brainRepoPath } from "../utils/paths.js";
import { loadBrainState } from "../state/brain.js";
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
    const status = await getBrainStatus(dataDir);
    expect(status.files).toEqual([]);
    expect(status.count).toBe(0);
    expect(status.lastSyncedAt).toBeTruthy();
    expect(status.unpushedCommitCount).toBe(0);
    // A fresh clone tracks origin.
    expect(status.upstream).toMatch(/^origin\//);
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
    expect(status.unpushedCommitCount).toBe(0);
  });
});

describe("getBrainDiff", () => {
  it("includes both a modified file and a new untracked file", async () => {
    await connectFixtureBrain();
    await writeBrainFile("README.md", "# Modified Repo\n", dataDir);
    await writeBrainFile("brand-new.md", "hello new\n", dataDir);

    const { diff, omittedFileCount } = await getBrainDiff(dataDir);
    // Modified tracked file appears via `git diff HEAD`.
    expect(diff).toContain("a/README.md");
    expect(diff).toContain("+# Modified Repo");
    // New untracked file appears via synthetic patch.
    expect(diff).toContain("b/brand-new.md");
    expect(diff).toContain("new file mode");
    expect(diff).toContain("+hello new");
    // Everything fit under the cap.
    expect(omittedFileCount).toBe(0);
  });

  it("reports omittedFileCount when untracked files exceed the cap", async () => {
    await connectFixtureBrain();
    // Five untracked files, but cap rendering at two.
    for (let i = 0; i < 5; i++) {
      await writeBrainFile(`note-${i}.md`, `content ${i}\n`, dataDir);
    }

    const { diff, omittedFileCount } = await getBrainDiff(dataDir, 2);
    // Two files rendered, three omitted but still surfaced via the count.
    expect(omittedFileCount).toBe(3);
    expect(diff).toContain("b/note-0.md");
    expect(diff).toContain("b/note-1.md");
    expect(diff).not.toContain("b/note-2.md");
  });

  it("renders an empty new file without a spurious blank addition line", async () => {
    await connectFixtureBrain();
    await writeBrainFile("empty.md", "", dataDir);

    const { diff } = await getBrainDiff(dataDir);
    expect(diff).toContain("b/empty.md");
    expect(diff).toContain("@@ -0,0 +0,0 @@");
    // No body line follows the empty-file hunk header.
    expect(diff).not.toContain("+\n");
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

    const result = await saveBrain("Add saved note", dataDir, {
      now: () => new Date("2026-06-06T10:00:00.000Z"),
    });
    expect(result).toEqual({
      committed: true,
      pushed: true,
      lastSyncedAt: "2026-06-06T10:00:00.000Z",
    });

    // The commit landed on the origin bare repo.
    const { stdout } = await git(["log", "-1", "--pretty=%s", "main"], origin);
    expect(stdout).toBe("Add saved note");
    // Working tree is clean again.
    const status = await getBrainStatus(dataDir);
    expect(status.count).toBe(0);
    expect(status.unpushedCommitCount).toBe(0);
    await expect(loadBrainState(dataDir)).resolves.toMatchObject({
      exists: true,
      lastSyncedAt: "2026-06-06T10:00:00.000Z",
    });
  });

  it("uses a default commit message when none is provided", async () => {
    await connectFixtureBrain();
    await writeBrainFile("auto.md", "auto\n", dataDir);
    const result = await saveBrain(undefined, dataDir);
    expect(result.committed).toBe(true);
    expect(result.pushed).toBe(true);
    expect(result.lastSyncedAt).toBeTruthy();
    const { stdout } = await git(["log", "-1", "--pretty=%s"], brainRepoPath(dataDir));
    expect(stdout).toMatch(/^Brain update /);
  });

  it("keeps the commit but reports pushed:false when push fails", async () => {
    await connectFixtureBrain();
    const before = await loadBrainState(dataDir);
    // Break the remote so push fails but the local commit still succeeds.
    await rm(origin, { recursive: true, force: true });
    await writeBrainFile("note.md", "content\n", dataDir);

    const result = await saveBrain("Will not push", dataDir, {
      now: () => new Date("2026-06-06T11:00:00.000Z"),
    });
    expect(result.committed).toBe(true);
    expect(result.pushed).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.lastSyncedAt).toBeUndefined();
    await expect(loadBrainState(dataDir)).resolves.toEqual(before);

    // The commit exists locally.
    const { stdout } = await git(["log", "-1", "--pretty=%s"], brainRepoPath(dataDir));
    expect(stdout).toBe("Will not push");
    expect((await getBrainStatus(dataDir)).unpushedCommitCount).toBe(1);
  });

  it("pushes existing local commits when there are no working-tree changes", async () => {
    await connectFixtureBrain();
    const repoPath = brainRepoPath(dataDir);
    await writeBrainFile("local.md", "local commit\n", dataDir);
    await git(["add", "local.md"], repoPath);
    await git(["commit", "-m", "Local only"], repoPath);

    expect((await getBrainStatus(dataDir)).unpushedCommitCount).toBe(1);

    const result = await saveBrain(undefined, dataDir, {
      now: () => new Date("2026-06-06T12:00:00.000Z"),
    });

    expect(result).toEqual({
      committed: false,
      pushed: true,
      lastSyncedAt: "2026-06-06T12:00:00.000Z",
    });
    expect((await getBrainStatus(dataDir)).unpushedCommitCount).toBe(0);
    const { stdout } = await git(["log", "-1", "--pretty=%s", "main"], origin);
    expect(stdout).toBe("Local only");
  });

  it("throws 409 when the Brain is not connected", async () => {
    await expect(saveBrain(undefined, dataDir)).rejects.toMatchObject({ statusCode: 409 });
  });
});
