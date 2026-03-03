import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { git } from "../utils/git.js";

export interface GitContext {
  branch: string;
  status: string;
  recentCommits: string;
  defaultBranch: string;
}

export interface SystemPromptOptions {
  cwd: string;
  workspaceName?: string;
  projectName?: string;
  basePrompt?: string;
  /** Pre-resolved default branch (from bare repo). Skips detection if provided. */
  defaultBranch?: string;
  /** Path to prompts directory (e.g. ~/.hive/prompts). Loads base.md from disk. */
  promptsDir?: string;
}

export interface PromptInterpolationValues {
  projectName: string;
  cwd: string;
  defaultBranch: string;
}

export const DEFAULT_BASE_PROMPT = `You are an AI coding agent running inside Hive, a macOS app that helps developers ship faster by running multiple coding agents in parallel across workspaces.
You're working on a project called **{PROJECT}**. Your work should take place in the {DIR} directory (unless otherwise directed), which has been set up for you to work in.
The target branch for this workspace is {DEFAULT_BRANCH}. Use this for actions like creating new PRs, bisecting, etc., unless you're told otherwise.
If the user asks you to work on several unrelated tasks in parallel, suggest they start new workspaces.
You have full access to the codebase via your tools. Read files before modifying them.
Write clean, simple code. Follow existing patterns and conventions in the codebase.
All code, comments, and variable names must be in English.`;

/**
 * Load the base prompt from `{promptsDir}/base.md`.
 * Returns the hardcoded default if the file can't be read.
 */
export async function loadBasePrompt(promptsDir: string): Promise<string> {
  try {
    return await readFile(join(promptsDir, "base.md"), "utf-8");
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn("[system-prompt] Failed to load base.md, using default:", err);
    }
    return DEFAULT_BASE_PROMPT;
  }
}

/**
 * Gather git context from the workspace directory.
 * Fails gracefully — returns empty strings if git commands fail.
 *
 * @param defaultBranchOverride - Pre-resolved default branch name (e.g. from bare repo).
 *   In Geneva's architecture, worktrees don't have an `origin` remote, so the default
 *   branch must be resolved from the bare repo via `git symbolic-ref HEAD`.
 */
export async function getGitContext(cwd: string, defaultBranchOverride?: string): Promise<GitContext> {
  const run = async (args: string[]): Promise<string> => {
    try {
      const { stdout } = await git(args, cwd);
      return stdout;
    } catch {
      return "";
    }
  };

  const [branch, status, recentCommits] = await Promise.all([
    run(["rev-parse", "--abbrev-ref", "HEAD"]),
    run(["status", "--short"]),
    run(["log", "--oneline", "-10"]),
  ]);

  // Use override if provided, otherwise try to detect from origin/HEAD, fallback to "main"
  let defaultBranch = defaultBranchOverride ?? "";
  if (!defaultBranch) {
    const ref = await run(["rev-parse", "--abbrev-ref", "origin/HEAD"]);
    defaultBranch = ref.replace(/^origin\//, "") || "main";
  }

  return { branch, status, recentCommits, defaultBranch };
}

/**
 * Format a git context block from already-resolved GitContext.
 * Pure formatting — no async, no git calls.
 */
export function formatGitContextBlock(
  ctx: GitContext,
  opts?: { projectName?: string; workspaceName?: string },
): string {
  const gitLines: string[] = [
    "# Git Context (snapshot at session start)",
    "",
  ];

  if (opts?.projectName) gitLines.push(`Project: ${opts.projectName}`);
  if (opts?.workspaceName) gitLines.push(`Workspace: ${opts.workspaceName}`);

  gitLines.push(
    `Current branch: ${ctx.branch || "unknown"}`,
    `Main branch: ${ctx.defaultBranch}`,
  );

  if (ctx.status) {
    gitLines.push("", "Status:", ctx.status);
  } else {
    gitLines.push("", "Status: (clean)");
  }

  if (ctx.recentCommits) {
    gitLines.push("", "Recent commits:", ctx.recentCommits);
  }

  return gitLines.join("\n");
}

/** Replace prompt placeholders with concrete workspace/project values. */
export function interpolatePromptVariables(
  prompt: string,
  values: PromptInterpolationValues,
): string {
  return prompt
    .replace(/\{DIR}/g, values.cwd)
    .replace(/\{DEFAULT_BRANCH}/g, values.defaultBranch)
    .replace(/\{PROJECT}/g, values.projectName);
}

/**
 * Build a system prompt by merging a base prompt with dynamic git context.
 */
export async function buildSystemPrompt(opts: SystemPromptOptions): Promise<string> {
  const { cwd, workspaceName, projectName, defaultBranch, promptsDir } = opts;

  const ctx = await getGitContext(cwd, defaultBranch);

  let basePrompt: string;
  if (opts.basePrompt !== undefined) {
    basePrompt = opts.basePrompt;
  } else if (promptsDir) {
    basePrompt = await loadBasePrompt(promptsDir);
  } else {
    basePrompt = DEFAULT_BASE_PROMPT;
  }

  // Interpolate template variables
  basePrompt = interpolatePromptVariables(basePrompt, {
    cwd,
    defaultBranch: ctx.defaultBranch,
    projectName: projectName ?? "unknown",
  });

  const sections: string[] = [basePrompt];
  sections.push(formatGitContextBlock(ctx, { projectName, workspaceName }));

  return sections.join("\n\n");
}
