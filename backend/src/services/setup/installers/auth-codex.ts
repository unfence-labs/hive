import { homedir } from "node:os";
import { detectTools } from "../detect.js";
import { StepError, type StepFn } from "../operations.js";
import {
  isCodexDeviceAuthDisabled,
  isDeviceCodeExpired,
  parseDeviceCode,
  parseDeviceUrl,
  stripAnsi,
} from "./auth-parsers.js";
import {
  defaultSpawnPty,
  drivePtyAuth,
  type SpawnPty,
} from "./pty-auth.js";

const CODEX_LOGIN_COMMAND = "codex login --device-auth";

export interface CodexAuthOptions {
  spawn?: SpawnPty;
  command?: string;
  cwd?: string;
  timeoutMs?: number;
}

function outputDetail(buffer: string): string | undefined {
  const detail = stripAnsi(buffer).trim().split("\n").filter(Boolean).slice(-8).join("\n");
  return detail || undefined;
}

export function codexAuthStep(options: CodexAuthOptions = {}): StepFn {
  return async (ctx) => {
    const detected = await detectTools();
    if (detected.codex?.authenticated) return;
    if (!detected.codex?.installed) {
      throw new StepError(
        "UNKNOWN",
        "Codex is not installed on this server.",
        { detail: "Run the Codex install step first." },
      );
    }

    let actionSurfaced = false;
    let disabled = false;
    let sawExpiry = false;
    const result = await drivePtyAuth({
      spawn: options.spawn ?? defaultSpawnPty,
      command: options.command ?? CODEX_LOGIN_COMMAND,
      cwd: options.cwd ?? homedir(),
      timeoutMs: options.timeoutMs ?? 180_000,
      onChunk: (buffer) => {
        disabled ||= isCodexDeviceAuthDisabled(buffer);
        sawExpiry ||= isDeviceCodeExpired(buffer);
        if (!actionSurfaced) {
          const code = parseDeviceCode(buffer);
          const url = parseDeviceUrl(buffer);
          if (code && url) {
            actionSurfaced = true;
            ctx.setAction({ kind: "open_url_with_code", url, code });
          }
        }
      },
    });

    // A clean exit with persisted credentials wins over any expiry notice seen
    // mid-flight (a first code can expire and be replaced in the same session).
    if (result.reason === "exit" && result.exitCode === 0) {
      const verified = await detectTools();
      if (verified.codex.authenticated) return;
    }

    if (disabled) {
      throw new StepError(
        "CODEX_DEVICE_AUTH_DISABLED",
        "Device code authentication is disabled for this ChatGPT workspace.",
      );
    }
    if (sawExpiry) {
      throw new StepError(
        "DEVICE_CODE_EXPIRED",
        "The Codex sign-in code expired before it was entered.",
      );
    }
    if (result.reason !== "exit" || result.exitCode !== 0) {
      throw new StepError(
        "UNKNOWN",
        result.reason === "timeout"
          ? "Codex sign-in timed out."
          : "Codex sign-in did not complete.",
        { detail: outputDetail(result.buffer) },
      );
    }

    throw new StepError(
      "UNKNOWN",
      "Codex sign-in exited without an authenticated session.",
      {
        detail: outputDetail(result.buffer) ??
          "No valid Codex credentials were detected after login.",
      },
    );
  };
}
