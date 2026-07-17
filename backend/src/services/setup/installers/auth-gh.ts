import { homedir } from "node:os";
import { StepError } from "../operations.js";
import type { EmitFn, StepContext } from "../operations.js";
import { detectTools } from "../detect.js";
import {
  parseDeviceCode,
  parseDeviceUrl,
  isGhLoggedIn,
  isDeviceCodeExpired,
} from "./auth-parsers.js";
import {
  drivePtyAuth,
  defaultSpawnPty,
  type SpawnPty,
  type PtyHandle,
} from "./pty-auth.js";

const GH_LOGIN_COMMAND =
  "gh auth login --web --git-protocol https -h github.com";

/** Overridable knobs; tests inject a fake PTY + short timeout. */
export interface GhAuthOptions {
  spawn?: SpawnPty;
  command?: string;
  cwd?: string;
  timeoutMs?: number;
}

/**
 * `auth_gh` step: drives `gh auth login --web` in a PTY (§6.3).
 *
 * - Guard: skip if gh already reports authenticated.
 * - Parse the one-time code (`First copy your one-time code: XXXX-XXXX`) and the
 *   device URL (`https://github.com/login/device`); surface them as an
 *   `open_url_with_code` action.
 * - CRITICAL: gh will not begin polling until the user presses Enter in the tty
 *   (cli/cli#12925), so we inject an Enter keystroke once the code is shown.
 * - Success -> ok; expiry/stall -> DEVICE_CODE_EXPIRED / GH_POLL_STUCK.
 */
export function ghAuthStep(options: GhAuthOptions = {}) {
  return async (emit: EmitFn, ctx: StepContext): Promise<Record<string, unknown> | void> => {
    await emit({ stream: "system", line: "GitHub sign-in: checking existing auth" });
    const detected = await detectTools({ force: true });
    if (detected.gh?.authenticated) {
      await emit({ stream: "stdout", line: "GitHub already authenticated; skipping" });
      return { skipped: true, reason: "already-authenticated" };
    }
    if (!detected.gh?.installed) {
      throw new StepError("UNKNOWN", "GitHub CLI is not installed; install it first.", {
        hint: "Run the Install GitHub CLI step first.",
      });
    }

    const spawn = options.spawn ?? defaultSpawnPty;
    const command = options.command ?? GH_LOGIN_COMMAND;
    const cwd = options.cwd ?? homedir();
    const timeoutMs = options.timeoutMs ?? 180_000;

    let enterInjected = false;
    let actionSurfaced = false;
    let sawExpiry = false;

    await emit({ stream: "system", line: "GitHub sign-in: starting device flow" });

    const result = await drivePtyAuth({
      spawn,
      command,
      cwd,
      timeoutMs,
      onChunk: async (buffer, handle: PtyHandle) => {
        if (!actionSurfaced) {
          const code = parseDeviceCode(buffer);
          const url = parseDeviceUrl(buffer);
          if (code && url) {
            actionSurfaced = true;
            await ctx.setAction({ kind: "open_url_with_code", url, code });
            await emit({
              stream: "system",
              line: `Open ${url} and enter code ${code}`,
            });
            // CRITICAL: gh waits for Enter before it starts polling.
            if (!enterInjected) {
              enterInjected = true;
              handle.write("\r");
              await emit({ stream: "system", line: "Injected Enter to begin polling" });
            }
          }
        }
        if (isDeviceCodeExpired(buffer)) sawExpiry = true;
        if (isGhLoggedIn(buffer)) return "success";
        return undefined;
      },
    });

    if (result.reason === "chunk-success") {
      await emit({ stream: "stdout", line: "GitHub sign-in complete" });
      return { authenticated: true };
    }

    if (sawExpiry || result.reason === "timeout") {
      const expired = sawExpiry;
      throw new StepError(
        expired ? "DEVICE_CODE_EXPIRED" : "GH_POLL_STUCK",
        expired
          ? "The GitHub sign-in code expired before it was entered."
          : "GitHub sign-in stalled while waiting for approval.",
        { exitCode: result.exitCode ?? undefined },
      );
    }

    // Process exited without a success signal.
    throw new StepError("GH_POLL_STUCK", "GitHub sign-in did not complete.", {
      exitCode: result.exitCode ?? undefined,
      hint: "Retry the GitHub sign-in step.",
    });
  };
}
