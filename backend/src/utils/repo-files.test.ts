import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTempDir } from "./test-helpers.js";
import {
  assertRealPathInsideRepo,
  resolveRepoFilePath,
  resolveSafeRepoFilePath,
} from "./repo-files.js";

describe("resolveRepoFilePath (lexical)", () => {
  it("rejects an empty path", () => {
    expect(() => resolveRepoFilePath("/repo", "")).toThrow(/Missing file path/);
  });

  it("rejects path traversal", () => {
    expect(() => resolveRepoFilePath("/repo", "../escape.md")).toThrow(/Invalid file path/);
  });

  it("rejects the repo root itself", () => {
    expect(() => resolveRepoFilePath("/repo", ".")).toThrow(/Invalid file path/);
  });

  it("rejects the .git directory", () => {
    expect(() => resolveRepoFilePath("/repo", ".git/config")).toThrow(/\.git/);
  });

  it("accepts a nested relative path", () => {
    expect(resolveRepoFilePath("/repo", "a/b.md")).toBe("/repo/a/b.md");
  });

  it("does not confuse a sibling dir sharing the root prefix", () => {
    // /repo-backup must not be treated as inside /repo.
    expect(() => resolveRepoFilePath("/repo", "../repo-backup/x")).toThrow(/Invalid file path/);
  });
});

describe("assertRealPathInsideRepo (symlink guard)", () => {
  let tempDir: string;
  let repo: string;

  beforeEach(async () => {
    tempDir = await createTempDir("hive-repo-files-test-");
    repo = join(tempDir, "repo");
    await mkdir(repo, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("accepts a real file inside the repo", async () => {
    await writeFile(join(repo, "note.md"), "hi");
    await expect(
      assertRealPathInsideRepo(repo, join(repo, "note.md")),
    ).resolves.toBeUndefined();
  });

  it("rejects a symlink that escapes the repo", async () => {
    await writeFile(join(tempDir, "secret.txt"), "top secret");
    await symlink(join(tempDir, "secret.txt"), join(repo, "leak.md"));
    await expect(
      assertRealPathInsideRepo(repo, join(repo, "leak.md")),
    ).rejects.toThrow(/Invalid file path/);
  });

  it("rejects writing through a symlinked directory that escapes the repo", async () => {
    await mkdir(join(tempDir, "outside"), { recursive: true });
    await symlink(join(tempDir, "outside"), join(repo, "link"));
    await expect(
      resolveSafeRepoFilePath(repo, "link/evil.md"),
    ).rejects.toThrow(/Invalid file path/);
  });
});
