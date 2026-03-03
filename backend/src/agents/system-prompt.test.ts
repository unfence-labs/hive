import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { rm, writeFile, mkdir } from "node:fs/promises";
import { createTempDir } from "../utils/test-helpers.js";
import { git } from "../utils/git.js";
import {
  getGitContext,
  buildSystemPrompt,
  loadBasePrompt,
  formatGitContextBlock,
  interpolatePromptVariables,
  DEFAULT_BASE_PROMPT,
} from "./system-prompt.js";
import type { GitContext } from "./system-prompt.js";

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

  it("includes default base prompt with interpolated variables", async () => {
    const prompt = await buildSystemPrompt({ cwd: repoDir, projectName: "my-app" });
    expect(prompt).toContain("running inside Hive");
    expect(prompt).toContain("project called **my-app**");
    expect(prompt).toContain(`take place in the ${repoDir} directory`);
    expect(prompt).toContain("target branch for this workspace is main");
    expect(prompt).not.toContain("{DIR}");
    expect(prompt).not.toContain("{DEFAULT_BRANCH}");
    expect(prompt).not.toContain("{PROJECT}");
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

  it("does not include branch rename directives", async () => {
    const prompt = await buildSystemPrompt({ cwd: repoDir });
    expect(prompt).not.toContain("git branch -m");
    expect(prompt).not.toContain("Branch Naming");
  });

  it("loads base prompt from promptsDir when provided", async () => {
    const promptsDir = join(tempDir, "prompts");
    await mkdir(promptsDir, { recursive: true });
    await writeFile(join(promptsDir, "base.md"), "Custom base prompt from file.");

    const prompt = await buildSystemPrompt({ cwd: repoDir, promptsDir });
    expect(prompt).toContain("Custom base prompt from file.");
    expect(prompt).not.toContain("AI coding assistant");
  });

  it("interpolates {DIR} and {DEFAULT_BRANCH} in file-based prompt", async () => {
    const promptsDir = join(tempDir, "prompts");
    await mkdir(promptsDir, { recursive: true });
    await writeFile(join(promptsDir, "base.md"), "Work in {DIR}, branch is {DEFAULT_BRANCH}.");

    const prompt = await buildSystemPrompt({ cwd: repoDir, promptsDir, defaultBranch: "develop" });
    expect(prompt).toContain(`Work in ${repoDir}, branch is develop.`);
    expect(prompt).not.toContain("{DIR}");
    expect(prompt).not.toContain("{DEFAULT_BRANCH}");
  });

  it("falls back to default when promptsDir has no base.md", async () => {
    const promptsDir = join(tempDir, "empty-prompts");
    await mkdir(promptsDir, { recursive: true });

    const prompt = await buildSystemPrompt({ cwd: repoDir, promptsDir });
    expect(prompt).toContain("running inside Hive");
  });

  it("explicit basePrompt takes priority over promptsDir", async () => {
    const promptsDir = join(tempDir, "prompts");
    await mkdir(promptsDir, { recursive: true });
    await writeFile(join(promptsDir, "base.md"), "From file.");

    const prompt = await buildSystemPrompt({
      cwd: repoDir,
      promptsDir,
      basePrompt: "Explicit override.",
    });
    expect(prompt).toContain("Explicit override.");
    expect(prompt).not.toContain("From file.");
  });
});

describe("interpolatePromptVariables", () => {
  it("replaces all supported placeholders", () => {
    const result = interpolatePromptVariables(
      "Project={PROJECT}; Dir={DIR}; Branch={DEFAULT_BRANCH}",
      {
        projectName: "hive",
        cwd: "/tmp/workspace",
        defaultBranch: "main",
      },
    );

    expect(result).toBe("Project=hive; Dir=/tmp/workspace; Branch=main");
  });

  it("replaces repeated placeholders globally", () => {
    const result = interpolatePromptVariables(
      "{PROJECT}:{PROJECT}:{DEFAULT_BRANCH}:{DEFAULT_BRANCH}",
      {
        projectName: "hive",
        cwd: "/tmp/workspace",
        defaultBranch: "develop",
      },
    );

    expect(result).toBe("hive:hive:develop:develop");
  });
});

describe("loadBasePrompt", () => {
  it("reads from file when it exists", async () => {
    const promptsDir = join(tempDir, "prompts");
    await mkdir(promptsDir, { recursive: true });
    await writeFile(join(promptsDir, "base.md"), "Hello from disk.");

    const result = await loadBasePrompt(promptsDir);
    expect(result).toBe("Hello from disk.");
  });

  it("returns default when file is missing", async () => {
    const promptsDir = join(tempDir, "no-such-dir");
    const result = await loadBasePrompt(promptsDir);
    expect(result).toBe(DEFAULT_BASE_PROMPT);
  });
});

describe("formatGitContextBlock", () => {
  const baseCtx: GitContext = {
    branch: "feat/login",
    status: "",
    recentCommits: "abc1234 add login page",
    defaultBranch: "main",
  };

  it("includes header, branch, and main branch", () => {
    const block = formatGitContextBlock(baseCtx);
    expect(block).toContain("# Git Context (snapshot at session start)");
    expect(block).toContain("Current branch: feat/login");
    expect(block).toContain("Main branch: main");
  });

  it("includes project name when provided", () => {
    const block = formatGitContextBlock(baseCtx, { projectName: "hive" });
    expect(block).toContain("Project: hive");
  });

  it("includes workspace name when provided", () => {
    const block = formatGitContextBlock(baseCtx, { workspaceName: "geneva" });
    expect(block).toContain("Workspace: geneva");
  });

  it("omits project and workspace lines when not provided", () => {
    const block = formatGitContextBlock(baseCtx);
    expect(block).not.toContain("Project:");
    expect(block).not.toContain("Workspace:");
  });

  it("shows clean status when status is empty", () => {
    const block = formatGitContextBlock(baseCtx);
    expect(block).toContain("Status: (clean)");
  });

  it("shows dirty status when status has content", () => {
    const ctx = { ...baseCtx, status: "M src/app.ts\n?? new.txt" };
    const block = formatGitContextBlock(ctx);
    expect(block).toContain("Status:");
    expect(block).toContain("M src/app.ts");
    expect(block).not.toContain("(clean)");
  });

  it("includes recent commits when present", () => {
    const block = formatGitContextBlock(baseCtx);
    expect(block).toContain("Recent commits:");
    expect(block).toContain("abc1234 add login page");
  });

  it("omits recent commits section when empty", () => {
    const ctx = { ...baseCtx, recentCommits: "" };
    const block = formatGitContextBlock(ctx);
    expect(block).not.toContain("Recent commits:");
  });

  it("shows unknown branch when branch is empty", () => {
    const ctx = { ...baseCtx, branch: "" };
    const block = formatGitContextBlock(ctx);
    expect(block).toContain("Current branch: unknown");
  });

  it("produces identical output to what buildSystemPrompt appends", async () => {
    // buildSystemPrompt calls formatGitContextBlock internally — verify consistency
    const prompt = await buildSystemPrompt({
      cwd: repoDir,
      projectName: "hive",
      workspaceName: "geneva",
    });
    const ctx = await getGitContext(repoDir);
    const block = formatGitContextBlock(ctx, { projectName: "hive", workspaceName: "geneva" });
    expect(prompt).toContain(block);
  });
});
