import { spawn as spawnChild } from "node:child_process";
import { killPtyProcess, spawnPtyProcess, type PtyProcess } from "../../pty-process.js";
import { nanoid } from "nanoid";

/**
 * A minimal PTY handle used by the device-auth drivers. `spawnPtyProcess` from
 * pty-process.ts satisfies this; tests inject a fake that replays fixture output
 * from a bash stub so no real CLI is required.
 */
export interface PtyHandle {
  /** Register a data listener; returns an unsubscribe fn. */
  onData: (cb: (chunk: string) => void) => () => void;
  /** Register an exit listener; returns an unsubscribe fn. */
  onExit: (cb: (code: number) => void) => () => void;
  /** Terminate the PTY. */
  kill: () => void;
}

/** Spawns a PTY handle for a command. Injectable so tests avoid real CLIs. */
export type SpawnPty = (command: string, cwd: string) => PtyHandle;

/** Wrap a real `PtyProcess` (from spawnPtyProcess) as a PtyHandle. */
export function wrapPtyProcess(proc: PtyProcess): PtyHandle {
  return {
    onData: (cb) => {
      const key = nanoid(6);
      proc.listeners.set(key, cb);
      return () => proc.listeners.delete(key);
    },
    onExit: (cb) => {
      const key = nanoid(6);
      proc.exitListeners.set(key, cb);
      // If it already exited, fire immediately.
      if (proc.state !== "running" && proc.exitCode !== undefined) {
        cb(proc.exitCode);
      }
      return () => proc.exitListeners.delete(key);
    },
    kill: () => killPtyProcess(proc),
  };
}

export const defaultSpawnPty: SpawnPty = (command, cwd) =>
  wrapPtyProcess(spawnPtyProcess(command, cwd));

/**
 * Plain pipe spawn (no PTY) for CLIs that behave better without a TTY: gh
 * prints the device code immediately and starts polling, instead of blocking
 * on interactive prompts and cursor-position queries a bare PTY never answers.
 */
export const defaultSpawnPipe: SpawnPty = (command, cwd) => {
  // detached: own process group, so kill() reaches the CLI even if bash execs
  // or forks it rather than dying with the wrapper.
  const child = spawnChild("bash", ["-lc", command], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  const dataCbs = new Set<(chunk: string) => void>();
  const exitCbs = new Set<(code: number) => void>();
  let exitCode: number | undefined;
  const settle = (code: number) => {
    if (exitCode !== undefined) return;
    exitCode = code;
    for (const cb of exitCbs) cb(exitCode);
  };
  const forward = (d: Buffer) => {
    const text = d.toString("utf8");
    for (const cb of dataCbs) cb(text);
  };
  child.stdout?.on("data", forward);
  child.stderr?.on("data", forward);
  child.on("close", (code) => settle(code ?? 1));
  child.on("error", () => settle(1));
  const signalGroup = (signal: NodeJS.Signals) => {
    try {
      if (child.pid !== undefined) {
        process.kill(-child.pid, signal);
      } else {
        child.kill(signal);
      }
    } catch {
      /* already gone */
    }
  };
  return {
    onData: (cb) => {
      dataCbs.add(cb);
      return () => dataCbs.delete(cb);
    },
    onExit: (cb) => {
      exitCbs.add(cb);
      if (exitCode !== undefined) cb(exitCode);
      return () => exitCbs.delete(cb);
    },
    kill: () => {
      signalGroup("SIGTERM");
      const fallback = setTimeout(() => {
        if (exitCode === undefined) signalGroup("SIGKILL");
      }, 5000);
      if (typeof (fallback as { unref?: () => void }).unref === "function") {
        (fallback as { unref: () => void }).unref();
      }
    },
  };
};

/**
 * Drive a PTY-based device-auth flow. Accumulates output, invokes `onChunk` for
 * each new full buffer so the caller can parse for a code/URL, and resolves
 * only when the process exits or times out. Output is never treated as proof
 * of success because both CLIs persist credentials immediately before exit.
 */
export interface DriveResult {
  buffer: string;
  exitCode: number | null;
  reason: "exit" | "timeout";
}

export interface DriveOptions {
  spawn: SpawnPty;
  command: string;
  cwd: string;
  timeoutMs: number;
  onChunk: (buffer: string) => void;
}

export function drivePtyAuth(opts: DriveOptions): Promise<DriveResult> {
  return new Promise<DriveResult>((resolve) => {
    const handle = opts.spawn(opts.command, opts.cwd);
    let buffer = "";
    let settled = false;
    let offData = () => {};
    let offExit = () => {};

    const finish = (reason: DriveResult["reason"], exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      offData();
      offExit();
      if (reason === "timeout") {
        try {
          handle.kill();
        } catch {
          /* already gone */
        }
      }
      resolve({ buffer, exitCode, reason });
    };

    const timer = setTimeout(() => finish("timeout", null), opts.timeoutMs);
    if (typeof (timer as { unref?: () => void }).unref === "function") {
      (timer as { unref: () => void }).unref();
    }

    offData = handle.onData((chunk) => {
      buffer += chunk;
      opts.onChunk(buffer);
    });

    offExit = handle.onExit((code) => finish("exit", code));
  });
}
