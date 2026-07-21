import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { DetectableTool, ToolDetection } from "@hive/shared/setup-types";

const execFile = promisify(execFileCb);

const PROBE_TIMEOUT_MS = 2_000;
const CACHE_TTL_MS = 30_000;

/** Tools where an `authenticated` state is cheaply detectable. */
const AUTH_TOOLS: DetectableTool[] = ["claude", "codex", "gh", "tailscale"];

interface ProbeSpec {
  tool: DetectableTool;
  command: string;
  versionArgs: string[];
}

const PROBES: ProbeSpec[] = [
  { tool: "claude", command: "claude", versionArgs: ["--version"] },
  { tool: "codex", command: "codex", versionArgs: ["--version"] },
  { tool: "gh", command: "gh", versionArgs: ["--version"] },
  { tool: "tailscale", command: "tailscale", versionArgs: ["version"] },
  { tool: "node", command: "node", versionArgs: ["--version"] },
  { tool: "docker", command: "docker", versionArgs: ["--version"] },
];

function parseVersion(stdout: string): string | undefined {
  return stdout.match(/(\d+\.\d+[\w.-]*)/)?.[1];
}

async function commandExists(command: string): Promise<boolean> {
  try {
    await execFile("command", ["-v", command], { shell: "/bin/sh", timeout: PROBE_TIMEOUT_MS });
    return true;
  } catch {
    return false;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function isClaudeAuthenticated(): Promise<boolean> {
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim()) return true;
  return fileExists(join(homedir(), ".claude", ".credentials.json"));
}

async function isCodexAuthenticated(): Promise<boolean> {
  return fileExists(join(homedir(), ".codex", "auth.json"));
}

async function isGhAuthenticated(): Promise<boolean> {
  try {
    await execFile("gh", ["auth", "status"], { timeout: PROBE_TIMEOUT_MS });
    return true;
  } catch {
    return false;
  }
}

async function isTailscaleAuthenticated(): Promise<boolean> {
  try {
    const { stdout } = await execFile("tailscale", ["status", "--json"], {
      timeout: PROBE_TIMEOUT_MS,
    });
    const parsed = JSON.parse(stdout) as { BackendState?: string };
    return parsed.BackendState === "Running";
  } catch {
    return false;
  }
}

async function detectAuthenticated(tool: DetectableTool): Promise<boolean | undefined> {
  switch (tool) {
    case "claude":
      return isClaudeAuthenticated();
    case "codex":
      return isCodexAuthenticated();
    case "gh":
      return isGhAuthenticated();
    case "tailscale":
      return isTailscaleAuthenticated();
    default:
      return undefined;
  }
}

async function probeTool(spec: ProbeSpec): Promise<ToolDetection> {
  const exists = await commandExists(spec.command);
  if (!exists) return { installed: false };

  let version: string | undefined;
  try {
    const { stdout } = await execFile(spec.command, spec.versionArgs, {
      timeout: PROBE_TIMEOUT_MS,
    });
    version = parseVersion(stdout);
  } catch {
    // Installed but --version failed/timed out; still report installed.
  }

  const detection: ToolDetection = { installed: true };
  if (version) detection.version = version;

  if (AUTH_TOOLS.includes(spec.tool)) {
    const authenticated = await detectAuthenticated(spec.tool);
    if (authenticated !== undefined) detection.authenticated = authenticated;
  }

  return detection;
}

let cache: { at: number; result: Partial<Record<DetectableTool, ToolDetection>> } | null = null;

/**
 * Detect the presence, version, and auth state of the setup tool suite.
 * Probes run in parallel with a ~2s timeout each; the result is cached ~30s.
 */
export async function detectTools(
  options: { force?: boolean } = {},
): Promise<Partial<Record<DetectableTool, ToolDetection>>> {
  if (!options.force && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.result;
  }

  const results = await Promise.all(PROBES.map((spec) => probeTool(spec)));
  const detected: Partial<Record<DetectableTool, ToolDetection>> = {};
  PROBES.forEach((spec, i) => {
    detected[spec.tool] = results[i];
  });

  cache = { at: Date.now(), result: detected };
  return detected;
}

/** Clear the detection cache (used by tests). */
export function _resetDetectCache(): void {
  cache = null;
}
