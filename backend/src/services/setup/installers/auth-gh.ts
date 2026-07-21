import { execFile as execFileCallback } from "node:child_process";
import { homedir } from "node:os";
import { promisify } from "node:util";
import { detectTools } from "../detect.js";
import { StepError, type StepFn } from "../operations.js";
import {
  isDeviceCodeExpired,
  parseDeviceCode,
  parseDeviceUrl,
  stripAnsi,
} from "./auth-parsers.js";
import {
  defaultSpawnPipe,
  drivePtyAuth,
  type SpawnPty,
} from "./pty-auth.js";

const GH_LOGIN_COMMAND = "gh auth login --web --git-protocol https -h github.com";

export interface GhAuthOptions {
  spawn?: SpawnPty;
  command?: string;
  cwd?: string;
  timeoutMs?: number;
  setupGit?: () => Promise<void>;
}

async function defaultSetupGit(): Promise<void> {
  await promisify(execFileCallback)("gh", ["auth", "setup-git", "-h", "github.com"]);
}

async function requireGitCredentialSetup(setupGit: () => Promise<void>): Promise<void> {
  try {
    await setupGit();
  } catch (error) {
    throw new StepError(
      "UNKNOWN",
      "GitHub is authenticated but git credential setup failed.",
      { detail: error instanceof Error ? error.message : String(error) },
    );
  }
}

function outputDetail(buffer: string): string | undefined {
  const detail = stripAnsi(buffer).trim().split("\n").filter(Boolean).slice(-8).join("\n");
  return detail || undefined;
}

export function ghAuthStep(options: GhAuthOptions = {}): StepFn {
  return async (ctx) => {
    const detected = await detectTools();
    if (!detected.gh?.installed) {
      throw new StepError(
        "UNKNOWN",
        "GitHub CLI is not installed on this server.",
        { detail: "Re-run server provisioning to install GitHub CLI." },
      );
    }

    const setupGit = options.setupGit ?? defaultSetupGit;
    if (detected.gh.authenticated) {
      await requireGitCredentialSetup(setupGit);
      return;
    }

    let actionSurfaced = false;
    let sawExpiry = false;
    const result = await drivePtyAuth({
      spawn: options.spawn ?? defaultSpawnPipe,
      command: options.command ?? GH_LOGIN_COMMAND,
      cwd: options.cwd ?? homedir(),
      timeoutMs: options.timeoutMs ?? 180_000,
      onChunk: (buffer) => {
        if (!actionSurfaced) {
          const code = parseDeviceCode(buffer);
          const url = parseDeviceUrl(buffer);
          if (code && url) {
            actionSurfaced = true;
            ctx.setAction({ kind: "open_url_with_code", url, code });
          }
        }
        if (isDeviceCodeExpired(buffer)) sawExpiry = true;
      },
    });

    if (result.reason === "exit" && result.exitCode === 0) {
      const verified = await detectTools();
      if (!verified.gh.authenticated) {
        throw new StepError(
          "GH_POLL_STUCK",
          "GitHub sign-in exited without an authenticated session.",
          { detail: outputDetail(result.buffer) },
        );
      }
      await requireGitCredentialSetup(setupGit);
      return;
    }

    if (sawExpiry) {
      throw new StepError(
        "DEVICE_CODE_EXPIRED",
        "The GitHub sign-in code expired before it was entered.",
      );
    }
    throw new StepError(
      "GH_POLL_STUCK",
      result.reason === "timeout"
        ? "GitHub sign-in stalled while waiting for approval."
        : "GitHub sign-in did not complete.",
      { detail: outputDetail(result.buffer) },
    );
  };
}
