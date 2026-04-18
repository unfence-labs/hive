import * as pty from "node-pty";
import type { IPty } from "node-pty";
import { buildWorkspaceEnv } from "../utils/env.js";

export type ScriptType = string;
export type ScriptState = "idle" | "running" | "done" | "error";

const MAX_BUFFER_BYTES = 256 * 1024;

export interface ScriptProcess {
  pty: IPty;
  type: ScriptType;
  state: ScriptState;
  exitCode?: number;
  outputBuffer: string;
  /** Live data listeners (WS connections). Keyed by arbitrary id. */
  listeners: Map<string, (data: string) => void>;
  /** Exit listeners. */
  exitListeners: Map<string, (code: number) => void>;
}

const activeScripts = new Map<string, ScriptProcess>();

function key(wsId: string, type: ScriptType): string {
  return `${wsId}:${type}`;
}

export function startScript(
  wsId: string,
  type: ScriptType,
  command: string | undefined,
  cwd: string,
): ScriptProcess {
  const k = key(wsId, type);
  const existing = activeScripts.get(k);
  if (existing && existing.state === "running") {
    throw new Error(`Script "${type}" is already running for workspace ${wsId}`);
  }

  // Clean up finished process entry if any
  if (existing) {
    activeScripts.delete(k);
  }

  const shell = process.env.SHELL || "/bin/sh";
  const args = command ? ["-c", command] : [];
  const ptyProcess = pty.spawn(shell, args, {
    cwd,
    env: buildWorkspaceEnv({ TERM: "xterm-256color" }),
    cols: 80,
    rows: 24,
    name: "xterm-256color",
  });

  const proc: ScriptProcess = {
    pty: ptyProcess,
    type,
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

  activeScripts.set(k, proc);
  return proc;
}

export function stopScript(wsId: string, type: ScriptType): boolean {
  const k = key(wsId, type);
  const proc = activeScripts.get(k);
  if (!proc || proc.state !== "running") return false;

  // Clear exit listeners to prevent stale "error" broadcasts after explicit stop
  proc.exitListeners.clear();
  proc.listeners.clear();

  // Remove from map so getScriptStatus() returns "idle" on subsequent queries
  activeScripts.delete(k);

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

  return true;
}

export function stopAllForWorkspace(wsId: string): void {
  const prefix = `${wsId}:`;
  const types = [...activeScripts.keys()]
    .filter((k) => k.startsWith(prefix))
    .map((k) => k.slice(prefix.length));
  for (const type of types) {
    stopScript(wsId, type);
  }
}

export interface ScriptStatusInfo {
  state: ScriptState;
  exitCode?: number;
}

export function getScriptStatus(wsId: string): Record<string, ScriptStatusInfo> {
  const result: Record<string, ScriptStatusInfo> = {};
  const prefix = `${wsId}:`;
  for (const [k, proc] of activeScripts) {
    if (k.startsWith(prefix)) {
      const type = k.slice(prefix.length);
      result[type] = {
        state: proc.state,
        ...(proc.exitCode !== undefined ? { exitCode: proc.exitCode } : {}),
      };
    }
  }
  return result;
}

export function getScriptProcess(wsId: string, type: ScriptType): ScriptProcess | undefined {
  return activeScripts.get(key(wsId, type));
}

/** Stop all running scripts across all workspaces (for graceful shutdown). */
export function stopAllScripts(): void {
  for (const k of [...activeScripts.keys()]) {
    const [wsId, ...rest] = k.split(":");
    const type = rest.join(":");
    if (wsId && type) stopScript(wsId, type);
  }
}

/** For test cleanup. */
export function _clearAll(): void {
  for (const proc of activeScripts.values()) {
    try {
      proc.pty.kill();
    } catch {
      // ignore
    }
  }
  activeScripts.clear();
}

/** Test helper to seed script status without spawning a PTY process. */
export function _setScriptStatusForTests(
  wsId: string,
  type: ScriptType,
  state: ScriptState,
  exitCode?: number,
): void {
  const proc: ScriptProcess = {
    pty: {
      pid: 0,
      write: () => {},
      resize: () => {},
      kill: () => {},
      onData: () => ({ dispose: () => {} }),
      onExit: () => ({ dispose: () => {} }),
    } as unknown as IPty,
    type,
    state,
    ...(exitCode !== undefined ? { exitCode } : {}),
    outputBuffer: "",
    listeners: new Map(),
    exitListeners: new Map(),
  };
  activeScripts.set(key(wsId, type), proc);
}
