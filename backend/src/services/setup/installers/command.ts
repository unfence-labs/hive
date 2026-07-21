import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const DEFAULT_TIMEOUT_MS = 300_000;

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type RunCommand = (
  command: string,
  opts?: { timeoutMs?: number; env?: Record<string, string> },
) => Promise<CommandResult>;

export const realRunCommand: RunCommand = async (command, opts = {}) => {
  try {
    const { stdout, stderr } = await execFile("/bin/sh", ["-c", command], {
      timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: number | string;
    };
    return {
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? failure.message,
      exitCode: typeof failure.code === "number" ? failure.code : 127,
    };
  }
};

export interface InstallerDeps {
  run: RunCommand;
}

export function defaultInstallerDeps(): InstallerDeps {
  return { run: realRunCommand };
}
