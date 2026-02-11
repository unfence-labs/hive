import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { rm, writeFile } from "node:fs/promises";
import { createTempDir } from "../utils/test-helpers.js";
import { git } from "../utils/git.js";
import { getGitContext, buildSystemPrompt } from "./system-prompt.js";

let tempDir: string;
let repoDir: string;

beforeEach(async () => {
  tempDir = await createTempDir("hive-sysprompt-test-");
  repoDir = join(tempDir, "repo");

  await git(["init", repoDir]);
  await git(["checkout", "-b", "main"], repoDir);
  await git(["config", "user.email", "test@hive.dev"], repoDir);
  await git(["config", "user.name", "Hive Test"], repoDir);
  await writeFile(join(repoDir, "README.md"), "# Test\n");
  await git(["add", "."], repoDir);
  await git(["commit", "-m", "initial commit"], repoDir);
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("getGitContext", () => {
  it("returns current branch", async () => {
    const ctx = await getGitContext(repoDir);
    expect(ctx.branch).toBe("main");
  });

  it("returns clean status for clean repo", async () => {
    const ctx = await getGitContext(repoDir);
    expect(ctx.status).toBe("");
  });

  it("returns dirty status for modified files", async () => {
    await writeFile(join(repoDir, "new.txt"), "hello");
    const ctx = await getGitContext(repoDir);
    expect(ctx.status).toContain("new.txt");
  });

  it("returns recent commits", async () => {
    const ctx = await getGitContext(repoDir);
    expect(ctx.recentCommits).toContain("initial commit");
  });

  it("returns branch name on feature branch", async () => {
    await git(["checkout", "-b", "feat/cool-stuff"], repoDir);
    const ctx = await getGitContext(repoDir);
    expect(ctx.branch).toBe("feat/cool-stuff");
  });

  it("handles non-git directory gracefully", async () => {
    const ctx = await getGitContext(tempDir);
    expect(ctx.branch).toBe("");
    expect(ctx.status).toBe("");
    expect(ctx.recentCommits).toBe("");
  });

  it("uses defaultBranch override when provided", async () => {
    const ctx = await getGitContext(repoDir, "develop");
    expect(ctx.defaultBranch).toBe("develop");
  });

  it("falls back to main when no origin/HEAD and no override", async () => {
    const ctx = await getGitContext(repoDir);
    // No remote set up, so origin/HEAD won't resolve — should fall back to "main"
    expect(ctx.defaultBranch).toBe("main");
  });
});

describe("buildSystemPrompt", () => {
  it("includes git context in output", async () => {
    const prompt = await buildSystemPrompt({ cwd: repoDir });
    expect(prompt).toContain("Current branch: main");
    expect(prompt).toContain("initial commit");
  });

  it("includes workspace and project name when provided", async () => {
    const prompt = await buildSystemPrompt({
      cwd: repoDir,
      workspaceName: "geneva",
      projectName: "hive",
    });
    expect(prompt).toContain("Project: hive");
    expect(prompt).toContain("Workspace: geneva");
  });

  it("includes default base prompt", async () => {
    const prompt = await buildSystemPrompt({ cwd: repoDir });
    expect(prompt).toContain("AI coding assistant");
  });

  it("uses custom base prompt when provided", async () => {
    const prompt = await buildSystemPrompt({
      cwd: repoDir,
      basePrompt: "You are a specialized agent for database migrations.",
    });
    expect(prompt).toContain("database migrations");
    expect(prompt).not.toContain("AI coding assistant");
  });

  it("shows clean status for clean repo", async () => {
    const prompt = await buildSystemPrompt({ cwd: repoDir });
    expect(prompt).toContain("Status: (clean)");
  });

  it("shows dirty status for modified repo", async () => {
    await writeFile(join(repoDir, "dirty.txt"), "changes");
    const prompt = await buildSystemPrompt({ cwd: repoDir });
    expect(prompt).toContain("dirty.txt");
    expect(prompt).not.toContain("Status: (clean)");
  });

  it("uses provided defaultBranch instead of detecting", async () => {
    const prompt = await buildSystemPrompt({ cwd: repoDir, defaultBranch: "develop" });
    expect(prompt).toContain("Main branch: develop");
  });

  it("includes branch rename directive when configured", async () => {
    const prompt = await buildSystemPrompt({
      cwd: repoDir,
      branchRename: { prefix: "feat/" },
    });
    expect(prompt).toContain("git branch -m");
    expect(prompt).toContain('prefix "feat/"');
  });

  it("includes branch rename without prefix", async () => {
    const prompt = await buildSystemPrompt({
      cwd: repoDir,
      branchRename: {},
    });
    expect(prompt).toContain("git branch -m");
    expect(prompt).not.toContain("prefix");
  });

  it("uses custom maxLength in branch rename", async () => {
    const prompt = await buildSystemPrompt({
      cwd: repoDir,
      branchRename: { maxLength: 30 },
    });
    expect(prompt).toContain("under 30 characters");
  });

  it("omits branch rename when not configured", async () => {
    const prompt = await buildSystemPrompt({ cwd: repoDir });
    expect(prompt).not.toContain("git branch -m");
  });
});
