import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { rm, writeFile, mkdir } from "node:fs/promises";
import { createTempDir } from "../utils/test-helpers.js";
import { git } from "../utils/git.js";
import {
  getGitContext,
  buildPrompt,
  loadBasePrompt,
  loadBrainPrompt,
  formatGitContextBlock,
  interpolatePromptVariables,
  DEFAULT_BASE_PROMPT,
  BRAIN_BASE_PROMPT,
} from "./system-prompt.js";
import type { GitContext } from "./system-prompt.js";
import type { WorkspaceSource } from "../types.js";

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

describe("loadBrainPrompt", () => {
  it("reads from file when it exists", async () => {
    const promptsDir = join(tempDir, "prompts");
    await mkdir(promptsDir, { recursive: true });
    await writeFile(join(promptsDir, "brain.md"), "Brain prompt from disk.");

    const result = await loadBrainPrompt(promptsDir);
    expect(result).toBe("Brain prompt from disk.");
  });

  it("returns BRAIN_BASE_PROMPT when file is missing", async () => {
    const promptsDir = join(tempDir, "no-such-dir");
    const result = await loadBrainPrompt(promptsDir);
    expect(result).toBe(BRAIN_BASE_PROMPT);
  });
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

  it("omits workspace source lines when no source is provided", () => {
    const block = formatGitContextBlock(baseCtx, { projectName: "hive" });
    expect(block).not.toContain("Workspace source:");
    expect(block).not.toContain("PR base branch:");
  });

  it("emits the branch source line right after the main branch line", () => {
    const source: WorkspaceSource = { kind: "branch", branch: "feature-x" };
    const block = formatGitContextBlock(baseCtx, { source });
    expect(block).toContain('Main branch: main\nWorkspace source: existing branch "feature-x"');
  });

  it("emits the issue source line with title and url", () => {
    const source: WorkspaceSource = {
      kind: "issue",
      number: 45,
      title: "Sidebar flickers",
      url: "https://github.com/acme/demo/issues/45",
    };
    const block = formatGitContextBlock(baseCtx, { source });
    expect(block).toContain(
      'Workspace source: issue #45 — "Sidebar flickers" (https://github.com/acme/demo/issues/45)',
    );
  });

  it("omits the url parens on an issue source without url", () => {
    const source: WorkspaceSource = { kind: "issue", number: 45, title: "Sidebar flickers" };
    const block = formatGitContextBlock(baseCtx, { source });
    expect(block).toMatch(/^Workspace source: issue #45 — "Sidebar flickers"$/m);
  });

  it("emits PR source, base branch, and instruction lines", () => {
    const source: WorkspaceSource = {
      kind: "pr",
      branch: "feature-x",
      number: 12,
      title: "Fix streaming",
      url: "https://github.com/acme/demo/pull/12",
      baseBranch: "develop",
    };
    const block = formatGitContextBlock(baseCtx, { source });
    expect(block).toContain(
      'Workspace source: pull request #12 — "Fix streaming" (https://github.com/acme/demo/pull/12)',
    );
    expect(block).toContain("PR base branch: develop");
    expect(block).toContain(
      "This workspace works on an existing pull request: push to its head branch to update the PR; do not create a new pull request. The PR merges into develop, not necessarily the main branch.",
    );
  });

  it("warns that pushing does not update a fork PR", () => {
    const source: WorkspaceSource = {
      kind: "pr",
      branch: "pr/7",
      number: 7,
      title: "Fork contribution",
      url: "https://github.com/acme/demo/pull/7",
      baseBranch: "main",
      crossRepository: true,
    };
    const block = formatGitContextBlock(baseCtx, { source });
    expect(block).toContain(
      "This workspace works on a pull request opened from a fork: the local branch is a copy of the PR head, and pushing it does NOT update the PR. Do not push to update the PR and do not create a new pull request. The PR merges into main, not necessarily the main branch.",
    );
    expect(block).not.toContain("push to its head branch");
  });

  it("emits the PR instruction without the merge sentence when baseBranch is absent", () => {
    const source: WorkspaceSource = {
      kind: "pr",
      branch: "feature-x",
      number: 12,
      title: "Fix streaming",
      url: "https://github.com/acme/demo/pull/12",
    };
    const block = formatGitContextBlock(baseCtx, { source });
    expect(block).not.toContain("PR base branch:");
    expect(block).toContain(
      "This workspace works on an existing pull request: push to its head branch to update the PR; do not create a new pull request.",
    );
    expect(block).not.toContain("The PR merges into");
  });

  it("degrades gracefully on sources with missing fields", () => {
    // Old workspaces may persist partial sources — never print "undefined".
    const block = formatGitContextBlock(baseCtx, { source: { kind: "pr" } });
    expect(block).not.toContain("undefined");
    expect(block).not.toContain("Workspace source:");
    expect(block).toContain(
      "This workspace works on an existing pull request: push to its head branch to update the PR; do not create a new pull request.",
    );

    const branchBlock = formatGitContextBlock(baseCtx, { source: { kind: "branch" } });
    expect(branchBlock).not.toContain("undefined");
    expect(branchBlock).not.toContain("Workspace source:");
  });

  it("produces identical output to what buildPrompt appends", async () => {
    // buildPrompt("chat") calls formatGitContextBlock internally — verify consistency
    const ctx = await getGitContext(repoDir);
    const { text } = buildPrompt("chat", {
      base: DEFAULT_BASE_PROMPT,
      interpolation: { projectName: "hive", cwd: repoDir, defaultBranch: ctx.defaultBranch },
      git: ctx,
      projectName: "hive",
      workspaceName: "geneva",
    });
    const block = formatGitContextBlock(ctx, { projectName: "hive", workspaceName: "geneva" });
    expect(text).toContain(block);
  });
});

describe("buildPrompt", () => {
  const gitCtx: GitContext = {
    branch: "feat/login",
    status: "",
    recentCommits: "abc1234 add login page",
    defaultBranch: "main",
  };
  const interpolation = { projectName: "hive", cwd: "/work/dir", defaultBranch: "main" };
  const base = "Base for {PROJECT} in {DIR} on {DEFAULT_BRANCH}.";

  it("chat recipe with git material yields [base, git, browser] in order", () => {
    const result = buildPrompt("chat", { base, interpolation, git: gitCtx });
    expect(result.blocks.map((b) => b.label)).toEqual(["base", "git", "browser"]);
    expect(result.text).toBe(result.blocks.map((b) => b.content).join("\n\n"));
    expect(result.blocks[1].content).toContain("# Git Context");
    expect(result.blocks[2].content).toContain("# Browser Context");
  });

  it("chat recipe without git material yields [base, browser]", () => {
    const result = buildPrompt("chat", { base, interpolation });
    expect(result.blocks.map((b) => b.label)).toEqual(["base", "browser"]);
    expect(result.text).not.toContain("# Git Context");
    expect(result.text).toContain("# Browser Context");
  });

  it("brain recipe yields [base, brainMap]", () => {
    const result = buildPrompt("brain", {
      base,
      interpolation,
      brainFilePaths: ["notes/a.md"],
    });
    expect(result.blocks.map((b) => b.label)).toEqual(["base", "brainMap"]);
    expect(result.blocks[1].content).toContain("# Brain Map");
    expect(result.blocks[1].content).toContain("- notes/a.md");
  });

  it("brain recipe with empty filePaths still yields a brainMap block", () => {
    const result = buildPrompt("brain", { base, interpolation, brainFilePaths: [] });
    expect(result.blocks.map((b) => b.label)).toEqual(["base", "brainMap"]);
    expect(result.blocks[1].content).toContain("currently empty");
  });

  it("brain recipe with omitted filePaths defaults to an empty brainMap block", () => {
    const result = buildPrompt("brain", { base, interpolation });
    expect(result.blocks.map((b) => b.label)).toEqual(["base", "brainMap"]);
    expect(result.blocks[1].content).toContain("currently empty");
  });

  it("automation recipe with git yields [base, git]", () => {
    const result = buildPrompt("automation", { base, interpolation, git: gitCtx });
    expect(result.blocks.map((b) => b.label)).toEqual(["base", "git"]);
    expect(result.blocks[1].content).toContain("# Git Context");
  });

  it("automation recipe without git yields [base]", () => {
    const result = buildPrompt("automation", { base, interpolation });
    expect(result.blocks.map((b) => b.label)).toEqual(["base"]);
  });

  it("interpolates the base block only, leaving concrete blocks untouched", () => {
    // Git block carries a literal "{DIR}" that must survive untouched, while the
    // base's "{DIR}" must be replaced with the interpolation cwd.
    const gitWithPlaceholder: GitContext = {
      ...gitCtx,
      recentCommits: "deadbee build in {DIR}",
    };
    const result = buildPrompt("chat", {
      base,
      interpolation: { projectName: "hive", cwd: "/work/dir", defaultBranch: "main" },
      git: gitWithPlaceholder,
    });

    const baseBlock = result.blocks.find((b) => b.label === "base")!;
    const gitBlock = result.blocks.find((b) => b.label === "git")!;

    // Base placeholders are resolved.
    expect(baseBlock.content).toContain("/work/dir");
    expect(baseBlock.content).not.toContain("{DIR}");
    // Git block keeps the literal placeholder — never interpolated.
    expect(gitBlock.content).toContain("build in {DIR}");
  });

  it("passes project/workspace names into the git block header", () => {
    const result = buildPrompt("chat", {
      base,
      interpolation,
      git: gitCtx,
      projectName: "hive",
      workspaceName: "geneva",
    });
    const gitBlock = result.blocks.find((b) => b.label === "git")!;
    expect(gitBlock.content).toContain("Project: hive");
    expect(gitBlock.content).toContain("Workspace: geneva");
  });

  it("passes the workspace source into the git block", () => {
    const result = buildPrompt("chat", {
      base,
      interpolation,
      git: gitCtx,
      source: { kind: "branch", branch: "feature-x" },
    });
    const gitBlock = result.blocks.find((b) => b.label === "git")!;
    expect(gitBlock.content).toContain('Workspace source: existing branch "feature-x"');
  });

  it("emits no source lines when materials have no source", () => {
    const result = buildPrompt("chat", { base, interpolation, git: gitCtx });
    expect(result.text).not.toContain("Workspace source:");
  });

  it("text equals blocks joined with double newline for every recipe", () => {
    for (const result of [
      buildPrompt("chat", { base, interpolation, git: gitCtx }),
      buildPrompt("chat", { base, interpolation }),
      buildPrompt("automation", { base, interpolation, git: gitCtx }),
      buildPrompt("automation", { base, interpolation }),
      buildPrompt("brain", { base, interpolation, brainFilePaths: [] }),
    ]) {
      expect(result.text).toBe(result.blocks.map((b) => b.content).join("\n\n"));
      expect(result.blocks.every((b) => typeof b.label === "string" && b.label.length > 0)).toBe(true);
    }
  });
});
