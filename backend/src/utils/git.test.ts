import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { git } from "./git.js";

let tempDir: string;

import { beforeEach, afterEach } from "vitest";

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "hive-git-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("git()", () => {
  it("runs a git command and returns stdout/stderr", async () => {
    await git(["init", tempDir]);
    const result = await git(["status"], tempDir);
    expect(result.stdout).toContain("On branch");
  });

  it("trims stdout and stderr whitespace", async () => {
    await git(["init", tempDir]);
    const { stdout } = await git(["rev-parse", "--git-dir"], tempDir);
    expect(stdout).toBe(".git");
    expect(stdout).not.toMatch(/^\s/);
    expect(stdout).not.toMatch(/\s$/);
  });

  it("passes cwd correctly", async () => {
    const subDir = join(tempDir, "sub");
    await mkdir(subDir, { recursive: true });
    await git(["init", subDir]);
    const { stdout } = await git(["rev-parse", "--show-toplevel"], subDir);
    expect(stdout).toContain("sub");
  });

  it("throws on invalid git command", async () => {
    await expect(git(["not-a-real-command"])).rejects.toThrow();
  });

  it("throws on non-existent repo path", async () => {
    await expect(
      git(["status"], join(tempDir, "nonexistent")),
    ).rejects.toThrow();
  });

  it("returns stderr alongside stdout", async () => {
    await git(["init", tempDir]);
    // git status on a fresh repo still has a valid stdout
    const result = await git(["status"], tempDir);
    expect(result).toHaveProperty("stdout");
    expect(result).toHaveProperty("stderr");
  });
});
