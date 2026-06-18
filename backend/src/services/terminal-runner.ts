import type { IPty } from "node-pty";
import { type PtyProcess, spawnPtyProcess, killPtyProcess } from "./pty-process.js";

/**
 * Registry of interactive terminal-tab PTYs, keyed by `wsId:sessionId`.
 *
 * Deliberately separate from the script runner: terminal tabs must NOT pollute
 * the workspace "script running" indicator. Terminal panes get their state from
 * their own `/ws/terminal` socket (ready/exit/error frames), so this registry
 * never broadcasts `script_status` and is never surfaced by `getScriptStatus`.
 */
const activeTerminals = new Map<string, PtyProcess>();

function key(wsId: string, sessionId: string): string {
  return `${wsId}:${sessionId}`;
}

/** Spawn an interactive login shell for a terminal-tab session. */
export function startTerminal(wsId: string, sessionId: string, cwd: string): PtyProcess {
  const k = key(wsId, sessionId);
  const existing = activeTerminals.get(k);
  if (existing && existing.state === "running") {
    throw new Error(`Terminal "${sessionId}" is already running for workspace ${wsId}`);
  }

  // Clean up finished process entry if any
  if (existing) {
    activeTerminals.delete(k);
  }

  const proc = spawnPtyProcess(undefined, cwd);
  activeTerminals.set(k, proc);
  return proc;
}

export function stopTerminal(wsId: string, sessionId: string): boolean {
  const k = key(wsId, sessionId);
  const proc = activeTerminals.get(k);
  if (!proc || proc.state !== "running") return false;

  activeTerminals.delete(k);
  killPtyProcess(proc);
  return true;
}

export function getTerminalProcess(wsId: string, sessionId: string): PtyProcess | undefined {
  return activeTerminals.get(key(wsId, sessionId));
}

export function stopAllTerminalsForWorkspace(wsId: string): void {
  const prefix = `${wsId}:`;
  const sessionIds = [...activeTerminals.keys()]
    .filter((k) => k.startsWith(prefix))
    .map((k) => k.slice(prefix.length));
  for (const sessionId of sessionIds) {
    stopTerminal(wsId, sessionId);
  }
}

/** Stop all running terminals across all workspaces (for graceful shutdown). */
export function stopAllTerminals(): void {
  for (const k of [...activeTerminals.keys()]) {
    const [wsId, ...rest] = k.split(":");
    const sessionId = rest.join(":");
    if (wsId && sessionId) stopTerminal(wsId, sessionId);
  }
}

/** For test cleanup. */
export function _clearAllTerminals(): void {
  for (const proc of activeTerminals.values()) {
    try {
      proc.pty.kill();
    } catch {
      // ignore
    }
  }
  activeTerminals.clear();
}

/** Test helper to seed a running terminal without spawning a PTY process. */
export function _setTerminalForTests(wsId: string, sessionId: string): void {
  const proc: PtyProcess = {
    pty: {
      pid: 0,
      write: () => {},
      resize: () => {},
      kill: () => {},
      onData: () => ({ dispose: () => {} }),
      onExit: () => ({ dispose: () => {} }),
    } as unknown as IPty,
    state: "running",
    outputBuffer: "",
    listeners: new Map(),
    exitListeners: new Map(),
  };
  activeTerminals.set(key(wsId, sessionId), proc);
}
