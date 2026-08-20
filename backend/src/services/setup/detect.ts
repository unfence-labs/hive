import type { SetupToolId } from "@hive/shared/setup-types";
import { parseVersionFromOutput } from "../../agents/providers/registry.js";
import { buildWorkspaceEnv } from "../../utils/env.js";
import type { SetupToolSpec } from "./catalog.js";
import { runCommand, type RunCommand } from "./command.js";

/** Probes must never hold up a status request; they answer or they are absent. */
const PROBE_TIMEOUT_MS = 5_000;

export type ToolAuthenticationState =
  | "authenticated"
  | "unauthenticated"
  | "unknown";

export type AuthenticationProbeFailureCategory =
  | "timeout"
  | "command_failed"
  | "invalid_output";

export interface ToolAuthenticationProbe {
  state: ToolAuthenticationState;
  failureCategory?: AuthenticationProbeFailureCategory;
}

export interface ToolDetection {
  installed: boolean;
  version: string | null;
  authenticated: boolean;
}

export interface DetectDeps {
  run: RunCommand;
}

export function defaultDetectDeps(): DetectDeps {
  return { run: runCommand };
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

/** Probe authentication without confusing a broken probe with a signed-out CLI. */
export async function probeToolAuthentication(
  id: SetupToolId,
  deps: DetectDeps = defaultDetectDeps(),
): Promise<ToolAuthenticationProbe> {
  try {
    switch (id) {
      case "claude": {
        const result = await deps.run("claude", ["auth", "status"], {
          timeoutMs: PROBE_TIMEOUT_MS,
          // Authentication belongs to Claude Code's credential store. Ignore
          // tokens inherited by the Hive service so detection matches agent runs.
          env: buildWorkspaceEnv(),
        });
        if (result.timedOut) return { state: "unknown", failureCategory: "timeout" };
        try {
          const status = JSON.parse(result.stdout) as unknown;
          if (
            typeof status === "object" &&
            status !== null &&
            "loggedIn" in status &&
            typeof status.loggedIn === "boolean"
          ) {
            if (status.loggedIn === false) return { state: "unauthenticated" };
            if (result.exitCode === 0) return { state: "authenticated" };
          }
        } catch {
          // Categorised below without exposing the CLI output.
        }
        return {
          state: "unknown",
          failureCategory: result.exitCode === 0 ? "invalid_output" : "command_failed",
        };
      }
      case "codex": {
        const result = await deps.run("codex", ["login", "status"], {
          timeoutMs: PROBE_TIMEOUT_MS,
        });
        if (result.timedOut) return { state: "unknown", failureCategory: "timeout" };
        const status = `${result.stdout}\n${result.stderr}`;
        if (/\bnot logged in\b/i.test(status)) return { state: "unauthenticated" };
        if (result.exitCode === 0 && /\blogged in\b/i.test(status)) {
          return { state: "authenticated" };
        }
        return {
          state: "unknown",
          failureCategory: result.exitCode === 0 ? "invalid_output" : "command_failed",
        };
      }
      case "gh": {
        const result = await deps.run("gh", ["auth", "status"], {
          timeoutMs: PROBE_TIMEOUT_MS,
        });
        if (result.timedOut) return { state: "unknown", failureCategory: "timeout" };
        return { state: result.exitCode === 0 ? "authenticated" : "unauthenticated" };
      }
    }
  } catch {
    return { state: "unknown", failureCategory: "command_failed" };
  }
}

/** Boolean compatibility for setup status and authentication flows. */
export async function detectToolAuthentication(
  id: SetupToolId,
  deps: DetectDeps = defaultDetectDeps(),
): Promise<boolean> {
  return (await probeToolAuthentication(id, deps)).state === "authenticated";
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
    authenticated: installed ? await detectToolAuthentication(spec.id, deps) : false,
  };
}
