import { spawn } from "node:child_process";
import { homedir } from "node:os";
import * as pty from "node-pty";
import { buildWorkspaceEnv } from "../../../utils/env.js";

/**
 * A sign-in child process, whichever way it had to be started.
 *
 * Both drivers below produce this, so the flows read output and write codes
 * without caring whether there is a terminal underneath — which is the only
 * difference between them, and one the CLIs forced rather than one Hive chose.
 */
export interface AuthProcess {
  onData: (listener: (chunk: string) => void) => void;
  /** Feed the process's stdin. A no-op for a process that has none. */
  write: (data: string) => void;
  kill: () => void;
  /** Resolves with the exit code once the process is gone. */
  exit: Promise<number>;
}

export type SpawnAuthProcess = (command: string, args: string[]) => AuthProcess;

/**
 * Wide enough that nothing the CLIs print wraps.
 *
 * A terminal wraps by inserting line breaks into the *text*, so a URL printed
 * into an 80-column pane arrives in pieces. Parsing recovers from that anyway
 * (see `output.ts`), but not having to is better than recovering.
 */
const PTY_COLUMNS = 512;
const PTY_ROWS = 48;

/** The environment sign-in commands run in. */
function authEnv(extra?: Record<string, string>): Record<string, string> {
  // buildWorkspaceEnv strips CLAUDE_CODE_*, which is exactly right here: a
  // token inherited from whatever started the backend must not decide the
  // outcome of a sign-in the operator asked for.
  return buildWorkspaceEnv(extra);
}

/**
 * Start a command attached to a pseudo-terminal.
 *
 * Reserved for CLIs that refuse to run without one. A PTY is strictly worse to
 * drive — output arrives decorated with colours and cursor moves that have to
 * be undone before anything can be read — so it is used only where the CLI
 * offers no alternative.
 */
export const spawnPtyAuthProcess: SpawnAuthProcess = (command, args) => {
  const child = pty.spawn(command, args, {
    cwd: homedir(),
    env: authEnv({ TERM: "xterm-256color" }),
    cols: PTY_COLUMNS,
    rows: PTY_ROWS,
    name: "xterm-256color",
  });

  let settled = false;
  let resolveExit!: (code: number) => void;
  const exit = new Promise<number>((resolve) => {
    resolveExit = resolve;
  });
  child.onExit(({ exitCode }) => {
    if (settled) return;
    settled = true;
    resolveExit(exitCode);
  });

  return {
    onData: (listener) => {
      child.onData(listener);
    },
    write: (data) => child.write(data),
    kill: () => {
      try {
        child.kill();
      } catch {
        // Already gone; the exit listener has fired or is about to.
      }
    },
    exit,
  };
};

/**
 * Start a command with ordinary pipes and no stdin.
 *
 * `detached` puts the child in its own process group so a kill reaches it even
 * if it has forked helpers of its own — the difference between cancelling a
 * sign-in and leaving one polling in the background.
 */
export const spawnPipedAuthProcess: SpawnAuthProcess = (command, args) => {
  const child = spawn(command, args, {
    cwd: homedir(),
    env: authEnv(),
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });

  const listeners = new Set<(chunk: string) => void>();
  const emit = (chunk: Buffer): void => {
    const text = chunk.toString("utf-8");
    for (const listener of listeners) listener(text);
  };
  child.stdout?.on("data", emit);
  child.stderr?.on("data", emit);

  let settled = false;
  const exit = new Promise<number>((resolve) => {
    const settle = (code: number): void => {
      if (settled) return;
      settled = true;
      resolve(code);
    };
    child.on("close", (code) => settle(code ?? 1));
    child.on("error", () => settle(127));
  });

  const signalGroup = (signal: NodeJS.Signals): void => {
    try {
      if (child.pid === undefined) return;
      process.kill(-child.pid, signal);
    } catch {
      // Already reaped.
    }
  };

  return {
    onData: (listener) => {
      listeners.add(listener);
    },
    write: () => {
      // The device flow needs no input; it polls the provider itself.
    },
    kill: () => {
      signalGroup("SIGTERM");
      const escalation = setTimeout(() => {
        if (!settled) signalGroup("SIGKILL");
      }, 5_000);
      escalation.unref?.();
    },
    exit,
  };
};
