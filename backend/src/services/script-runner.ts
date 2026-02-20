import * as pty from "node-pty";
import type { IPty } from "node-pty";

export type ScriptType = string;
export type ScriptState = "idle" | "running" | "done" | "error";

const MAX_BUFFER_LINES = 200;

export interface ScriptProcess {
  pty: IPty;
  type: ScriptType;
  state: ScriptState;
  exitCode?: number;
  outputBuffer: string[];
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
  command: string,
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
  const ptyProcess = pty.spawn(shell, ["-c", command], {
    cwd,
    env: { ...process.env, TERM: "xterm-256color" } as Record<string, string>,
    cols: 80,
    rows: 24,
    name: "xterm-256color",
  });

  const proc: ScriptProcess = {
    pty: ptyProcess,
    type,
    state: "running",
    outputBuffer: [],
    listeners: new Map(),
    exitListeners: new Map(),
  };

  ptyProcess.onData((data) => {
    // Feed ring buffer
    const lines = data.split("\n");
    for (const line of lines) {
      proc.outputBuffer.push(line);
    }
    // Trim buffer
    if (proc.outputBuffer.length > MAX_BUFFER_LINES) {
      proc.outputBuffer.splice(0, proc.outputBuffer.length - MAX_BUFFER_LINES);
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
