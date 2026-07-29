import type { SetupToolId } from "@hive/shared/setup-types";
import { parseVersionFromOutput } from "../../agents/providers/registry.js";
import type { SetupToolSpec } from "./catalog.js";
import { runCommand, type RunCommand } from "./command.js";

/** Probes must never hold up a status request; they answer or they are absent. */
const PROBE_TIMEOUT_MS = 5_000;

export interface ToolDetection {
  installed: boolean;
  version: string | null;
  authenticated: boolean;
}

export interface DetectDeps {
  run: RunCommand;
  env: NodeJS.ProcessEnv;
}

export function defaultDetectDeps(): DetectDeps {
  return { run: runCommand, env: process.env };
}

async function probeVersion(
  spec: SetupToolSpec,
  deps: DetectDeps,
): Promise<{ installed: boolean; version: string | null }> {
  const result = await deps.run(spec.command, ["--version"], {
    timeoutMs: PROBE_TIMEOUT_MS,
  });
  if (result.exitCode !== 0) return { installed: false, version: null };
  return {
    installed: true,
    version: parseVersionFromOutput(`${result.stdout}\n${result.stderr}`),
  };
}

/**
 * Whether the tool is signed in. Every probe fails closed: an unrecognised
 * output shape reads as "not authenticated", which understates rather than
 * claiming a sign-in that is not there.
 */
async function probeAuthenticated(
  id: SetupToolId,
  deps: DetectDeps,
): Promise<boolean> {
  switch (id) {
    case "claude": {
      // A token in the environment authenticates the CLI without any on-disk
      // credential, so the command probe below would wrongly report a miss.
      if (deps.env.CLAUDE_CODE_OAUTH_TOKEN?.trim()) return true;
      const result = await deps.run("claude", ["auth", "status"], {
        timeoutMs: PROBE_TIMEOUT_MS,
      });
      if (result.exitCode !== 0) return false;
      try {
        const status = JSON.parse(result.stdout) as unknown;
        return (
          typeof status === "object" &&
          status !== null &&
          "loggedIn" in status &&
          status.loggedIn === true
        );
      } catch {
        return false;
      }
    }
    case "codex": {
      const result = await deps.run("codex", ["login", "status"], {
        timeoutMs: PROBE_TIMEOUT_MS,
      });
      if (result.exitCode !== 0) return false;
      const status = `${result.stdout}\n${result.stderr}`;
      return /\blogged in\b/i.test(status) && !/\bnot logged in\b/i.test(status);
    }
    case "gh": {
      const result = await deps.run("gh", ["auth", "status"], {
        timeoutMs: PROBE_TIMEOUT_MS,
      });
      return result.exitCode === 0;
    }
  }
}

export async function detectTool(
  spec: SetupToolSpec,
  deps: DetectDeps = defaultDetectDeps(),
): Promise<ToolDetection> {
  const { installed, version } = await probeVersion(spec, deps);
  return {
    installed,
    version,
    // Asking an absent binary whether it is signed in only produces a second
    // spawn failure.
    authenticated: installed ? await probeAuthenticated(spec.id, deps) : false,
  };
}
