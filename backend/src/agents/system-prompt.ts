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

export function formatBrowserContextBlock(): string {
  return [
    "# Browser Context",
    "",
    "Hive provides a read-only live browser panel when you use the `agent-browser` CLI.",
    "For frontend or UI verification, use `agent-browser` to inspect the running app instead of relying only on static reasoning.",
    "Use the existing `AGENT_BROWSER_STREAM_PORT` environment variable for the stream; do not start a separate browser dashboard or streaming server.",
  ].join("\n");
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
  sections.push(formatBrowserContextBlock());

  return sections.join("\n\n");
}

/** Hardcoded base prompt describing the Brain agent's role and constraints. */
export const BRAIN_BASE_PROMPT = `You are the agent for the user's **Brain**, a personal knowledge base stored as a Git repository.
The Brain holds the user's notes, documentation, code snippets, references, and brainstorming — not application source code.
Your job is to help the user capture, organize, refine, and retrieve this knowledge by reading and writing files in the Brain.

How retrieval works: there is no search index. You are given a map of the Brain's file paths below. The user guides you to the right place (e.g. "look in solana/"). Use the map to navigate, then Read the relevant files before answering or editing.

Rules:
- Read and write files ONLY inside the Brain repository. Never touch files outside it.
- You have no shell/terminal access; use your Read, Write, Edit, Glob, and Grep tools.
- Prefer clear Markdown for notes. Keep a sensible folder structure; reuse existing folders when they fit.
- When the user asks you to record something, write it to an appropriate file rather than only replying in chat.
- All file content must be in English.`;

export interface BrainSystemPromptOptions {
  /** Brain repository working-tree path (Brain `cwd`). */
  cwd: string;
  /** Relative file paths currently in the Brain (the navigation map). */
  filePaths: string[];
  /** Editable base prompt; falls back to {@link BRAIN_BASE_PROMPT} when omitted. */
  basePrompt?: string;
}

/**
 * Load the Brain base prompt from `{promptsDir}/brain.md`.
 * Returns the hardcoded {@link BRAIN_BASE_PROMPT} if the file can't be read.
 */
export async function loadBrainPrompt(promptsDir: string): Promise<string> {
  try {
    return await readFile(join(promptsDir, "brain.md"), "utf-8");
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn("[system-prompt] Failed to load brain.md, using default:", err);
    }
    return BRAIN_BASE_PROMPT;
  }
}

/**
 * Format the Brain's file-path map as a system-prompt block. Paths only (no
 * content) — this is the agent's retrieval mechanism: it knows the structure
 * and the user guides it to the right place.
 */
export function formatBrainMapBlock(filePaths: string[]): string {
  const lines = ["# Brain Map (file paths only — Read files before editing)", ""];
  if (filePaths.length === 0) {
    lines.push("(The Brain is currently empty.)");
  } else {
    for (const path of filePaths) lines.push(`- ${path}`);
  }
  return lines.join("\n");
}

/**
 * Build the system prompt for a Brain agent session. Injects the Brain file-path
 * map so the agent always knows the knowledge-base structure.
 */
export function buildBrainSystemPrompt(opts: BrainSystemPromptOptions): string {
  const basePrompt = interpolatePromptVariables(opts.basePrompt ?? BRAIN_BASE_PROMPT, {
    cwd: opts.cwd,
    defaultBranch: "main",
    projectName: "Brain",
  });
  return [basePrompt, formatBrainMapBlock(opts.filePaths)].join("\n\n");
}
