import { homedir } from "node:os";
import { StepError } from "../operations.js";
import type { EmitFn, StepContext } from "../operations.js";
import { detectTools } from "../detect.js";
import {
  parseDeviceCode,
  parseDeviceUrl,
  isCodexLoggedIn,
  isCodexDeviceAuthDisabled,
  isDeviceCodeExpired,
} from "./auth-parsers.js";
import {
  drivePtyAuth,
  defaultSpawnPty,
  type SpawnPty,
} from "./pty-auth.js";

const CODEX_LOGIN_COMMAND = "codex login --device-auth";

export interface CodexAuthOptions {
  spawn?: SpawnPty;
  command?: string;
  cwd?: string;
  timeoutMs?: number;
}

/**
 * `auth_codex` step: drives `codex login --device-auth` in a PTY (§6.3).
 *
 * - Guard: skip if codex already reports authenticated.
 * - Scrape the device URL (variants `/device` and `/codex/device` — do not
 *   hardcode) and the `XXXX-XXXX` code; surface as `open_url_with_code`.
 * - Detect "contact your workspace admin to enable device code authentication"
 *   -> CODEX_DEVICE_AUTH_DISABLED.
 * - Success when the CLI reports logged in (auth.json is written).
 */
export function codexAuthStep(options: CodexAuthOptions = {}) {
  return async (emit: EmitFn, ctx: StepContext): Promise<Record<string, unknown> | void> => {
    await emit({ stream: "system", line: "Codex sign-in: checking existing auth" });
    const detected = await detectTools({ force: true });
    if (detected.codex?.authenticated) {
      await emit({ stream: "stdout", line: "Codex already authenticated; skipping" });
      return { skipped: true, reason: "already-authenticated" };
    }
    if (!detected.codex?.installed) {
      throw new StepError("UNKNOWN", "Codex is not installed; install it first.", {
        hint: "Run the Install Codex step first.",
      });
    }

    const spawn = options.spawn ?? defaultSpawnPty;
    const command = options.command ?? CODEX_LOGIN_COMMAND;
    const cwd = options.cwd ?? homedir();
    const timeoutMs = options.timeoutMs ?? 180_000;

    let actionSurfaced = false;
    let disabled = false;
    let sawExpiry = false;

    await emit({ stream: "system", line: "Codex sign-in: starting device flow" });

    const result = await drivePtyAuth({
      spawn,
      command,
      cwd,
      timeoutMs,
      onChunk: async (buffer) => {
        if (isCodexDeviceAuthDisabled(buffer)) {
          disabled = true;
          return "fail";
        }
        if (!actionSurfaced) {
          const code = parseDeviceCode(buffer);
          const url = parseDeviceUrl(buffer);
          if (code && url) {
            actionSurfaced = true;
            await ctx.setAction({ kind: "open_url_with_code", url, code });
            await emit({ stream: "system", line: `Open ${url} and enter code ${code}` });
          }
        }
        if (isDeviceCodeExpired(buffer)) sawExpiry = true;
        if (isCodexLoggedIn(buffer)) return "success";
        return undefined;
      },
    });

    if (disabled) {
      throw new StepError(
        "CODEX_DEVICE_AUTH_DISABLED",
        "Device code authentication is disabled for this ChatGPT workspace.",
      );
    }

    if (result.reason === "chunk-success" || (result.reason === "exit" && result.exitCode === 0)) {
      await emit({ stream: "stdout", line: "Codex sign-in complete" });
      // Refresh the detection cache so the next /status shows authenticated.
      await detectTools({ force: true });
      return { authenticated: true };
    }

    if (sawExpiry) {
      throw new StepError(
        "DEVICE_CODE_EXPIRED",
        "The Codex sign-in code expired before it was entered.",
        { exitCode: result.exitCode ?? undefined },
      );
    }

    throw new StepError("UNKNOWN", "Codex sign-in did not complete.", {
      exitCode: result.exitCode ?? undefined,
      hint: "Retry the Codex sign-in step.",
    });
  };
}
