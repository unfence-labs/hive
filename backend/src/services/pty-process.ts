import * as pty from "node-pty";
import type { IPty } from "node-pty";
import { buildWorkspaceEnv } from "../utils/env.js";

const MAX_BUFFER_BYTES = 256 * 1024;

/**
 * A spawned PTY plus the bookkeeping shared by both the script runner and the
 * terminal runner: a verbatim ring buffer for replay, live data listeners, and
 * exit listeners. This is the reusable lifecycle core; registries (keying,
 * status broadcasts) live in the callers.
 */
export interface PtyProcess {
  pty: IPty;
  state: "running" | "done" | "error";
  exitCode?: number;
  /** Verbatim ring buffer of PTY output (ANSI escapes and \r\n preserved). */
  outputBuffer: string;
  /** Live data listeners (WS connections). Keyed by arbitrary id. */
  listeners: Map<string, (data: string) => void>;
  /** Exit listeners. Keyed by arbitrary id. */
  exitListeners: Map<string, (code: number) => void>;
}

/**
 * Spawn a PTY and wire its output buffer plus data/exit listener dispatch.
 *
 * - No command launches a login shell (`-l`) so the user's full profile/PATH is
 *   sourced — matching what they get in an interactive terminal.
 * - A command runs once via `-c`.
 *
 * The caller owns registration and any status broadcasting.
 */
export function spawnPtyProcess(command: string | undefined, cwd: string): PtyProcess {
  const shell = process.env.SHELL || "/bin/sh";
  const args = command ? ["-c", command] : ["-l"];
  const ptyProcess = pty.spawn(shell, args, {
    cwd,
    env: buildWorkspaceEnv({ TERM: "xterm-256color" }),
    cols: 80,
    rows: 24,
    name: "xterm-256color",
  });

  const proc: PtyProcess = {
    pty: ptyProcess,
    state: "running",
    outputBuffer: "",
    listeners: new Map(),
    exitListeners: new Map(),
  };

  ptyProcess.onData((data) => {
    // Append raw PTY chunk to the ring buffer. We intentionally keep the stream
    // verbatim (ANSI escapes, partial lines, \r\n) so the replay on reconnect
    // matches what xterm would have rendered live.
    proc.outputBuffer += data;
    if (proc.outputBuffer.length > MAX_BUFFER_BYTES) {
      const overflow = proc.outputBuffer.length - MAX_BUFFER_BYTES;
      // Trim at the next newline past the overflow point to avoid slicing an
      // ANSI escape sequence in half.
      const nextNewline = proc.outputBuffer.indexOf("\n", overflow);
      proc.outputBuffer =
        nextNewline === -1
          ? proc.outputBuffer.slice(overflow)
          : proc.outputBuffer.slice(nextNewline + 1);
    }
    // Notify live listeners
    for (const listener of proc.listeners.values()) {
      listener(data);
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    proc.exitCode = exitCode;
    proc.state = exitCode === 0 ? "done" : "error";
    for (const listener of proc.exitListeners.values()) {
      listener(exitCode);
    }
  });

  return proc;
}

/**
 * Kill a running PTY: clear listeners (so no stale broadcasts fire after an
 * explicit stop), send the kill signal, and arm a 5s SIGKILL fallback that is
 * cancelled if the process exits first.
 */
export function killPtyProcess(proc: PtyProcess): void {
  // Clear listeners to prevent stale "error" broadcasts/output after explicit stop
  proc.exitListeners.clear();
  proc.listeners.clear();

  proc.pty.kill();

  // Fallback SIGKILL after 5s
  const timeout = setTimeout(() => {
    try {
      process.kill(proc.pty.pid, "SIGKILL");
    } catch {
      // Process may already be dead
    }
  }, 5000);

  const origExit = proc.pty.onExit(() => {
    clearTimeout(timeout);
    origExit.dispose();
  });
}
