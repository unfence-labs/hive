import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createFixtureRepo, createTempDir } from "../utils/test-helpers.js";
import { connectBrain } from "./brain-repo.js";
import {
  listBrainFiles,
  readBrainFile,
  resolveBrainFilePath,
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
});

describe("resolveBrainFilePath", () => {
  it("rejects path traversal", () => {
    expect(() => resolveBrainFilePath("/repo", "../escape.md")).toThrow();
  });

  it("rejects the repo root itself", () => {
    expect(() => resolveBrainFilePath("/repo", ".")).toThrow();
  });

  it("rejects the .git directory", () => {
    expect(() => resolveBrainFilePath("/repo", ".git/config")).toThrow();
  });

  it("accepts a nested relative path", () => {
    expect(resolveBrainFilePath("/repo", "a/b.md")).toBe("/repo/a/b.md");
  });

  it("blocks traversal even with a writeBrainFile call", async () => {
    await connectFixtureBrain();
    await writeFile(join(tempDir, "outside.md"), "secret");
    await expect(writeBrainFile("../../outside.md", "x", dataDir)).rejects.toThrow();
  });
});
