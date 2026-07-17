import { spawnPtyProcess, type PtyProcess } from "../../pty-process.js";
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
  /** Write raw bytes into the PTY (e.g. an Enter keystroke). */
  write: (data: string) => void;
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
    write: (data) => proc.pty.write(data),
    kill: () => proc.pty.kill(),
  };
}

export const defaultSpawnPty: SpawnPty = (command, cwd) =>
  wrapPtyProcess(spawnPtyProcess(command, cwd));

/**
 * Drive a PTY-based device-auth flow. Accumulates output, invokes `onChunk` for
 * each new full buffer so the caller can parse for a code/URL, success, or a
 * typed error, and resolves with the final buffer + exit code.
 *
 * The caller controls timing via callbacks:
 *  - `onChunk(buffer)`: return a verdict to end early (`success`/`fail`), or
 *    `undefined` to keep waiting.
 *  - `onTimeout`: buffer accumulated when the overall timeout fires.
 */
export interface DriveResult {
  buffer: string;
  exitCode: number | null;
  reason: "chunk-success" | "chunk-fail" | "exit" | "timeout";
}

export type ChunkVerdict = "success" | "fail" | undefined;

export interface DriveOptions {
  spawn: SpawnPty;
  command: string;
  cwd: string;
  timeoutMs: number;
  /** Called on every buffer update; return a verdict to stop early. */
  onChunk: (buffer: string, handle: PtyHandle) => ChunkVerdict | Promise<ChunkVerdict>;
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
      if (reason !== "exit") {
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
      void Promise.resolve(opts.onChunk(buffer, handle)).then((verdict) => {
        if (verdict === "success") finish("chunk-success", null);
        else if (verdict === "fail") finish("chunk-fail", null);
      });
    });

    offExit = handle.onExit((code) => finish("exit", code));
  });
}
