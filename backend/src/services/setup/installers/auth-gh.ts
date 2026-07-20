import { homedir } from "node:os";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { StepError } from "../operations.js";
import type { EmitFn, StepContext } from "../operations.js";
import { detectTools } from "../detect.js";
import {
  parseDeviceCode,
  parseDeviceUrl,
  isDeviceCodeExpired,
} from "./auth-parsers.js";
import {
  drivePtyAuth,
  defaultSpawnPipe,
  type SpawnPty,
} from "./pty-auth.js";

const GH_LOGIN_COMMAND =
  "gh auth login --web --git-protocol https -h github.com";

/** Overridable knobs; tests inject a fake PTY + short timeout. */
export interface GhAuthOptions {
  spawn?: SpawnPty;
  command?: string;
  cwd?: string;
  timeoutMs?: number;
  /** Injectable for tests; defaults to running `gh auth setup-git`. */
  setupGit?: () => Promise<void>;
}

async function defaultSetupGit(): Promise<void> {
  await promisify(execFileCb)("gh", ["auth", "setup-git", "-h", "github.com"]);
}

/**
 * `auth_gh` step: drives `gh auth login --web` WITHOUT a TTY (§6.3).
 *
 * Pipe mode is deliberate: with a TTY gh renders interactive prompts (git
 * credentials question, cursor-position queries) that stall a bare PTY, while
 * without one it prints the one-time code immediately and polls on its own.
 *
 * - Guard: skip if gh already reports authenticated.
 * - Parse the one-time code (`First copy your one-time code: XXXX-XXXX`) and the
 *   device URL (`https://github.com/login/device`); surface them as an
 *   `open_url_with_code` action.
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

    const spawn = options.spawn ?? defaultSpawnPipe;
    const command = options.command ?? GH_LOGIN_COMMAND;
    const cwd = options.cwd ?? homedir();
    const timeoutMs = options.timeoutMs ?? 180_000;

    let actionSurfaced = false;
    let sawExpiry = false;

    await emit({ stream: "system", line: "GitHub sign-in: starting device flow" });

    const result = await drivePtyAuth({
      spawn,
      command,
      cwd,
      timeoutMs,
      onChunk: async (buffer) => {
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
          }
        }
        if (isDeviceCodeExpired(buffer)) sawExpiry = true;
        // No early-success on output: gh prints "Authentication complete"
        // BEFORE persisting credentials, and killing it then loses the login.
        // gh exits on its own right after storing; exit 0 is the signal.
        return undefined;
      },
    });

    if (result.reason === "exit" && result.exitCode === 0) {
      await emit({ stream: "stdout", line: "GitHub sign-in complete" });
      // The non-interactive login skips gh's setup-git prompt, so wire the git
      // credential helper explicitly — HTTPS clones of private repos need it.
      try {
        await (options.setupGit ?? defaultSetupGit)();
        await emit({ stream: "stdout", line: "Configured git to authenticate via gh" });
      } catch (e) {
        await emit({
          stream: "stderr",
          line: `gh auth setup-git failed (clones of private repos may prompt): ${e instanceof Error ? e.message : String(e)}`,
        });
      }
      // Refresh the detection cache so the next /status shows authenticated.
      await detectTools({ force: true });
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
