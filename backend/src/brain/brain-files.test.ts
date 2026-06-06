import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createFixtureRepo, createTempDir } from "../utils/test-helpers.js";
import { brainRepoPath } from "../utils/paths.js";
import { connectBrain } from "./brain-repo.js";
import {
  listBrainFiles,
  readBrainFile,
  writeBrainFile,
} from "./brain-files.js";

let tempDir: string;
let dataDir: string;

beforeEach(async () => {
  tempDir = await createTempDir("hive-brain-files-test-");
  dataDir = join(tempDir, "data");
  await mkdir(dataDir, { recursive: true });
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

async function connectFixtureBrain(): Promise<void> {
  const fixtureDir = join(tempDir, "fixtures");
  await mkdir(fixtureDir, { recursive: true });
  const origin = await createFixtureRepo(fixtureDir);
  await connectBrain(origin, dataDir);
}

describe("brain file operations", () => {
  it("throws 409 when the Brain is not connected", async () => {
    await expect(listBrainFiles(dataDir)).rejects.toMatchObject({ statusCode: 409 });
  });

  it("upserts, reads, and lists files", async () => {
    await connectFixtureBrain();

    await writeBrainFile("notes/topic.md", "# Topic\n", dataDir);
    const read = await readBrainFile("notes/topic.md", dataDir);
    expect(read).toEqual({ path: "notes/topic.md", content: "# Topic\n" });

    const tree = await listBrainFiles(dataDir);
    const dir = tree.find((n) => n.name === "notes");
    expect(dir?.type).toBe("directory");
    expect(dir?.children?.some((c) => c.name === "topic.md")).toBe(true);
  });

  it("overwrites an existing file on upsert", async () => {
    await connectFixtureBrain();
    await writeBrainFile("a.md", "first", dataDir);
    await writeBrainFile("a.md", "second", dataDir);
    expect((await readBrainFile("a.md", dataDir)).content).toBe("second");
  });

  it("returns 404 reading a missing file", async () => {
    await connectFixtureBrain();
    await expect(readBrainFile("missing.md", dataDir)).rejects.toMatchObject({ statusCode: 404 });
  });

  it("rejects reading a symlink that escapes the repo", async () => {
    await connectFixtureBrain();
    await writeFile(join(tempDir, "secret.txt"), "top secret");
    await symlink(join(tempDir, "secret.txt"), join(brainRepoPath(dataDir), "leak.md"));
    await expect(readBrainFile("leak.md", dataDir)).rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects writing through a symlinked directory that escapes the repo", async () => {
    await connectFixtureBrain();
    await mkdir(join(tempDir, "outside"), { recursive: true });
    await symlink(join(tempDir, "outside"), join(brainRepoPath(dataDir), "link"));
    await expect(writeBrainFile("link/evil.md", "x", dataDir)).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("returns a truncated prefix for oversized files instead of throwing", async () => {
    await connectFixtureBrain();
    const big = "a".repeat(1024 * 1024 + 64);
    await writeFile(join(brainRepoPath(dataDir), "big.md"), big);
    const read = await readBrainFile("big.md", dataDir);
    expect(read.truncated).toBe(true);
    expect(read.content.length).toBe(1024 * 1024);
  });
});

describe("Brain path safety", () => {
  it("blocks traversal even with a writeBrainFile call", async () => {
    await connectFixtureBrain();
    await writeFile(join(tempDir, "outside.md"), "secret");
    await expect(writeBrainFile("../../outside.md", "x", dataDir)).rejects.toThrow();
  });
});
