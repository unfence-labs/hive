import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { access, constants } from "node:fs/promises";

const execFile = promisify(execFileCb);

/**
 * Directory the provision step drops privileged helper scripts into. Its
 * presence is our "am I running on a provisioned Hive server?" signal: when it
 * exists we can shell root-requiring helpers, otherwise root steps degrade to a
 * clearly-logged no-op success so the wizard stays demoable on any box.
 */
export const HELPERS_DIR = "/usr/lib/hive/helpers";

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Run a shell command line (through `/bin/sh -c`) and capture its output.
 * A non-zero exit resolves (never rejects) so installers decide how to react;
 * spawn failures surface as exitCode 127 with the error on stderr.
 */
export type RunCommand = (
  command: string,
  opts?: { timeoutMs?: number; env?: Record<string, string> },
) => Promise<CommandResult>;

const DEFAULT_TIMEOUT_MS = 300_000;

export const realRunCommand: RunCommand = async (command, opts = {}) => {
  try {
    const { stdout, stderr } = await execFile("/bin/sh", ["-c", command], {
      timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: number | string;
    };
    const exitCode = typeof e.code === "number" ? e.code : 127;
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? (e.message ?? String(err)),
      exitCode,
    };
  }
};

/** true when the privileged helper directory exists (i.e. provisioned server). */
export async function helpersAvailable(
  dir: string = HELPERS_DIR,
): Promise<boolean> {
  try {
    await access(dir, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Dependencies every installer step is built against. Real by default;
 * overridden wholesale in unit tests so nothing ever shells out.
 */
export interface InstallerDeps {
  run: RunCommand;
  /** Whether privileged helpers can run here (provisioned server). */
  helpersAvailable: () => Promise<boolean>;
  /** Directory helper scripts live in. */
  helpersDir: string;
}

export function defaultInstallerDeps(): InstallerDeps {
  return {
    run: realRunCommand,
    helpersAvailable: () => helpersAvailable(),
    helpersDir: HELPERS_DIR,
  };
}

/**
 * Run a privileged helper: `sudo <helpersDir>/<name>.sh <args...>`. Callers must
 * first confirm helpers are available; off-server this should not be reached.
 */
export async function runHelper(
  deps: InstallerDeps,
  name: string,
  args: string[] = [],
  opts?: { timeoutMs?: number },
): Promise<CommandResult> {
  const script = `${deps.helpersDir}/${name}.sh`;
  const quoted = [script, ...args].map(shellQuote).join(" ");
  return deps.run(`sudo ${quoted}`, opts);
}

/** Minimal single-arg shell quoting for helper argument passing. */
export function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
