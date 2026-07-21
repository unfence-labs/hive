import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import type {
  DetectableTool,
  ToolDetection,
} from "@hive/shared/setup-types";

const execFile = promisify(execFileCallback);
const PROBE_TIMEOUT_MS = 2_000;

async function commandExists(command: string): Promise<boolean> {
  try {
    await execFile(command, ["--version"], { timeout: PROBE_TIMEOUT_MS });
    return true;
  } catch {
    return false;
  }
}

async function isAuthenticated(tool: DetectableTool): Promise<boolean> {
  switch (tool) {
    case "claude":
      if (process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim()) return true;
      try {
        const { stdout } = await execFile("claude", ["auth", "status"], {
          timeout: PROBE_TIMEOUT_MS,
        });
        const status = JSON.parse(stdout) as unknown;
        return (
          typeof status === "object" &&
          status !== null &&
          "loggedIn" in status &&
          status.loggedIn === true
        );
      } catch {
        return false;
      }
    case "codex":
      try {
        const { stdout, stderr } = await execFile("codex", ["login", "status"], {
          timeout: PROBE_TIMEOUT_MS,
        });
        const status = `${stdout}\n${stderr}`;
        return /\blogged in\b/i.test(status) && !/\bnot logged in\b/i.test(status);
      } catch {
        return false;
      }
    case "gh":
      try {
        await execFile("gh", ["auth", "status"], { timeout: PROBE_TIMEOUT_MS });
        return true;
      } catch {
        return false;
      }
  }
}

async function probe(tool: DetectableTool): Promise<ToolDetection> {
  const installed = await commandExists(tool);
  return {
    installed,
    authenticated: installed ? await isAuthenticated(tool) : false,
  };
}

/** Probes the three user-facing setup tools in parallel without stale caching. */
export async function detectTools(): Promise<Record<DetectableTool, ToolDetection>> {
  const tools: DetectableTool[] = ["gh", "claude", "codex"];
  const detections = await Promise.all(tools.map(probe));
  return {
    gh: detections[0],
    claude: detections[1],
    codex: detections[2],
  };
}
