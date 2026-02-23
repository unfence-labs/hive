import { spawn } from "node:child_process";
import { git } from "../utils/git.js";
import { buildWorkspaceEnv } from "../utils/env.js";

export interface NamingContext {
  userMessage: string;
  cwd: string;
  bareRepo: string;
  currentBranch: string;
  workspaceName: string;
  command?: string;
}

export interface NamingResult {
  branchName?: string;
  sessionTitle?: string;
}

const NAMING_PROMPT_TEMPLATE = `Based on the following user message sent to a coding agent, generate a concise branch name and session title.

User message:
"""
{MESSAGE}
"""

Respond with ONLY a raw JSON object, no markdown fencing, no explanation:
{"branch_name": "descriptive-kebab-case-name", "session_title": "Short Descriptive Title"}

Rules for branch_name:
- Lowercase letters, digits, and hyphens only
- Max 50 characters
- Describe the task concisely (e.g. "user-auth-middleware", "fix-login-redirect")
- No prefixes like feat/, fix/, chore/, docs/, refactor/, test/

Rules for session_title:
- Max 60 characters
- Sentence case, concise summary of the task
- No commit-style prefixes (Add, Fix, Update, Refactor)`;

const TIMEOUT_MS = 15_000;

const PREFIX_PATTERN = /^(?:feat|fix|chore|docs|refactor|test|style|perf|ci|build|workspace)\//;

export function sanitizeBranchName(raw: string): string {
  let name = raw.toLowerCase();
  name = name.replace(PREFIX_PATTERN, "");
  name = name.replace(/[\s_]+/g, "-");
  name = name.replace(/[^a-z0-9-]/g, "");
  name = name.replace(/-{2,}/g, "-");
  name = name.replace(/^-|-$/g, "");
  name = name.slice(0, 50);
  return name.length < 3 ? "" : name;
}

export function ensureUniqueBranch(desired: string, existing: string[]): string {
  const set = new Set(existing);
  if (!set.has(desired)) return desired;
  for (let i = 2; i <= 9; i++) {
    const candidate = `${desired}-${i}`;
    if (!set.has(candidate)) return candidate;
  }
  // Extremely unlikely: append timestamp fragment
  const suffix = Date.now().toString(36).slice(-4);
  return `${desired}-${suffix}`;
}

async function listExistingBranches(bareRepo: string): Promise<string[]> {
  try {
    const { stdout } = await git(["branch", "--format=%(refname:short)"], bareRepo);
    return stdout.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

function buildNamingPrompt(userMessage: string): string {
  const truncated = userMessage.slice(0, 500);
  return NAMING_PROMPT_TEMPLATE.replace("{MESSAGE}", truncated);
}

function extractJson(text: string): NamingResult {
  // Strip markdown fences if present
  const stripped = text.replace(/```(?:json)?\s*/g, "").replace(/```\s*/g, "");

  // Find first { and matching }
  const start = stripped.indexOf("{");
  if (start === -1) return {};
  let depth = 0;
  for (let i = start; i < stripped.length; i++) {
    if (stripped[i] === "{") depth++;
    else if (stripped[i] === "}") depth--;
    if (depth === 0) {
      try {
        const obj = JSON.parse(stripped.slice(start, i + 1));
        return {
          branchName: typeof obj.branch_name === "string" ? obj.branch_name : undefined,
          sessionTitle: typeof obj.session_title === "string" ? obj.session_title : undefined,
        };
      } catch {
        return {};
      }
    }
  }
  return {};
}

export async function generateNames(ctx: NamingContext): Promise<NamingResult> {
  const command = ctx.command ?? "claude";
  const prompt = buildNamingPrompt(ctx.userMessage);

  return new Promise<NamingResult>((resolve) => {
    const args = [
      "--print",
      "--output-format", "text",
      "--max-turns", "1",
      "--no-session-persistence",
      "--model", "haiku",
      "-p", prompt,
    ];

    let stdout = "";
    const proc = spawn(command, args, {
      cwd: ctx.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: buildWorkspaceEnv(),
    });

    proc.stdin?.end();

    proc.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
    });

    const timer = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch { /* already exited */ }
      resolve({});
    }, TIMEOUT_MS);

    proc.on("close", () => {
      clearTimeout(timer);
      resolve(extractJson(stdout));
    });

    proc.on("error", () => {
      clearTimeout(timer);
      resolve({});
    });
  });
}

export async function runNamingTask(
  ctx: NamingContext,
  onTitleReady: (title: string) => void,
): Promise<void> {
  // Skip in test mode (tests use command = "bash")
  const command = ctx.command ?? "claude";
  if (command !== "claude") return;

  const shouldRenameBranch = ctx.currentBranch.startsWith("workspace/");

  const result = await generateNames(ctx);

  if (result.sessionTitle) {
    const title = result.sessionTitle.slice(0, 60);
    onTitleReady(title);
  }

  if (shouldRenameBranch && result.branchName) {
    const sanitized = sanitizeBranchName(result.branchName);
    if (!sanitized) return;

    const existing = await listExistingBranches(ctx.bareRepo);
    const finalName = ensureUniqueBranch(sanitized, existing);

    // Guard: branch may have been renamed manually in the meantime
    try {
      const { stdout: currentBranch } = await git(["rev-parse", "--abbrev-ref", "HEAD"], ctx.cwd);
      if (!currentBranch.startsWith("workspace/")) {
        console.log("[naming] branch already renamed, skipping:", currentBranch);
        return;
      }
    } catch {
      return;
    }

    await git(["branch", "-m", finalName], ctx.cwd);
    console.log(`[naming] renamed branch: ${ctx.currentBranch} → ${finalName}`);
  }
}
