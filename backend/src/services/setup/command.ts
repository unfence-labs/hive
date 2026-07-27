import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import type { ToolFailureReason } from "@hive/shared/setup-types";
import { outputTail } from "./auth/output.js";

const execFile = promisify(execFileCallback);

/** Installs pull a whole dependency tree over a home connection; be patient. */
export const DEFAULT_COMMAND_TIMEOUT_MS = 300_000;

const MAX_BUFFER_BYTES = 8 * 1024 * 1024;

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  /** True when the command was killed for exceeding its time limit. */
  timedOut: boolean;
}

export type RunCommand = (
  command: string,
  args: string[],
  opts?: { timeoutMs?: number },
) => Promise<CommandResult>;

/**
 * Run a command as an argv vector — never a shell string. Nothing here is
 * user-supplied today, but a shell would make the next argument that is a
 * remote code execution hole rather than a bug.
 */
export const runCommand: RunCommand = async (command, args, opts = {}) => {
  try {
    const { stdout, stderr } = await execFile(command, args, {
      timeout: opts.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER_BYTES,
    });
    return { stdout, stderr, exitCode: 0, timedOut: false };
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: number | string;
      killed?: boolean;
      signal?: string | null;
    };
    return {
      stdout: failure.stdout ?? "",
      stderr: failure.stderr || failure.message,
      // A spawn failure (ENOENT) surfaces `code` as a string; treat it the way
      // a shell does — 127, command not found.
      exitCode: typeof failure.code === "number" ? failure.code : 127,
      timedOut: failure.killed === true && failure.signal != null,
    };
  }
};

const NETWORK_FAILURE =
  /could not resolve|getaddrinfo|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|ECONNRESET|ENETUNREACH|network is unreachable|temporary failure in name resolution|request to https?:\/\/\S+ failed|socket hang up/i;

/**
 * Classify a failed command. The distinction that matters is whether the
 * command never got to talk to the registry (fix the server's network) or ran
 * and refused (read what it said).
 */
export function classifyFailure(result: CommandResult): ToolFailureReason {
  if (result.timedOut) return "timeout";
  if (NETWORK_FAILURE.test(`${result.stderr}\n${result.stdout}`)) return "network";
  return "command_failed";
}

/** Bounded tail of a command's combined output, ready to show or store. */
export function outputExcerpt(result: CommandResult): string | undefined {
  return outputTail(`${result.stdout}\n${result.stderr}`);
}
