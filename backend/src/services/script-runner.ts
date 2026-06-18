import type { IPty } from "node-pty";
import { type PtyProcess, spawnPtyProcess, killPtyProcess } from "./pty-process.js";

export type ScriptType = string;
export type ScriptState = "idle" | "running" | "done" | "error";

/** A script PTY: the shared lifecycle core plus the script type tag. */
export type ScriptProcess = PtyProcess & {
  type: ScriptType;
};

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

  // Attach `type` onto the same object the spawn closures mutate. Spreading
  // into a new object would break those live references (state/exitCode would
  // never update), so we augment in place.
  const proc: ScriptProcess = Object.assign(spawnPtyProcess(command, cwd), { type });

  activeScripts.set(k, proc);
  return proc;
}

export function stopScript(wsId: string, type: ScriptType): boolean {
  const k = key(wsId, type);
  const proc = activeScripts.get(k);
  if (!proc || proc.state !== "running") return false;

  // Remove from map so getScriptStatus() returns "idle" on subsequent queries
  activeScripts.delete(k);

  killPtyProcess(proc);

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
  state: Exclude<ScriptState, "idle">,
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
