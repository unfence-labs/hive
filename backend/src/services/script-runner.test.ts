import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

type DataHandler = (data: string) => void;
type ExitHandler = (event: { exitCode: number }) => void;

interface MockPtyProcess {
  pid: number;
  kill: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  onData: (handler: DataHandler) => { dispose: () => void };
  onExit: (handler: ExitHandler) => { dispose: () => void };
  emitData: (data: string) => void;
  emitExit: (exitCode: number) => void;
}

const mocks = vi.hoisted(() => {
  let nextPid = 10_000;
  const processes: MockPtyProcess[] = [];

  function createProcess(): MockPtyProcess {
    const dataHandlers = new Set<DataHandler>();
    const exitHandlers = new Set<ExitHandler>();

    return {
      pid: nextPid++,
      kill: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      onData: (handler: DataHandler) => {
        dataHandlers.add(handler);
        return {
          dispose: () => {
            dataHandlers.delete(handler);
          },
        };
      },
      onExit: (handler: ExitHandler) => {
        exitHandlers.add(handler);
        return {
          dispose: () => {
            exitHandlers.delete(handler);
          },
        };
      },
      emitData: (data: string) => {
        for (const handler of dataHandlers) handler(data);
      },
      emitExit: (exitCode: number) => {
        for (const handler of exitHandlers) handler({ exitCode });
      },
    };
  }

  const spawn = vi.fn(() => {
    const proc = createProcess();
    processes.push(proc);
    return proc;
  });

  return {
    spawn,
    processes,
    reset() {
      spawn.mockClear();
      processes.length = 0;
      nextPid = 10_000;
    },
  };
});

vi.mock("node-pty", () => ({
  spawn: mocks.spawn,
}));

import {
  startScript,
  stopScript,
  stopAllForWorkspace,
  getScriptStatus,
  getScriptProcess,
  _clearAll,
} from "./script-runner.js";

beforeEach(() => {
  mocks.reset();
  _clearAll();
  vi.useRealTimers();
});

afterEach(() => {
  _clearAll();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("script-runner", () => {
  it("starts a script via shell and tracks running status", () => {
    process.env.SHELL = "/bin/zsh";

    const proc = startScript("ws-1", "setup", "npm ci", "/tmp/workspace");

    expect(mocks.spawn).toHaveBeenCalledWith(
      "/bin/zsh",
      ["-c", "npm ci"],
      expect.objectContaining({
        cwd: "/tmp/workspace",
      }),
    );
    expect(proc.state).toBe("running");
    expect(getScriptStatus("ws-1").setup?.state).toBe("running");
  });

  it("starts an interactive shell when command is undefined", () => {
    process.env.SHELL = "/bin/bash";

    const proc = startScript("ws-1", "terminal", undefined, "/tmp/workspace");

    expect(mocks.spawn).toHaveBeenCalledWith(
      "/bin/bash",
      [],
      expect.objectContaining({
        cwd: "/tmp/workspace",
      }),
    );
    expect(proc.state).toBe("running");
    expect(getScriptStatus("ws-1").terminal?.state).toBe("running");
  });

  it("throws when trying to start the same script while it is already running", () => {
    startScript("ws-1", "setup", "npm ci", "/tmp/workspace");
    expect(() => startScript("ws-1", "setup", "npm ci", "/tmp/workspace")).toThrow(
      'Script "setup" is already running for workspace ws-1',
    );
  });

  it("allows restarting after previous process has exited", () => {
    const first = startScript("ws-1", "setup", "npm ci", "/tmp/workspace");
    mocks.processes[0]?.emitExit(0);
    expect(getScriptStatus("ws-1").setup).toEqual({ state: "done", exitCode: 0 });

    const second = startScript("ws-1", "setup", "npm ci", "/tmp/workspace");
    expect(second).not.toBe(first);
    expect(getScriptStatus("ws-1").setup?.state).toBe("running");
  });

  it("keeps only the latest 200 output lines in buffer", () => {
    const proc = startScript("ws-1", "run", "npm run dev", "/tmp/workspace");
    const lines = Array.from({ length: 205 }, (_, i) => `line-${i}`).join("\n");
    mocks.processes[0]?.emitData(lines);

    expect(proc.outputBuffer).toHaveLength(200);
    expect(proc.outputBuffer[0]).toBe("line-5");
    expect(proc.outputBuffer[199]).toBe("line-204");
  });

  it("notifies listeners and updates state on process exit", () => {
    const proc = startScript("ws-1", "run", "npm run dev", "/tmp/workspace");
    const liveListener = vi.fn();
    const exitListener = vi.fn();
    proc.listeners.set("live", liveListener);
    proc.exitListeners.set("exit", exitListener);

    mocks.processes[0]?.emitData("hello\n");
    mocks.processes[0]?.emitExit(2);

    expect(liveListener).toHaveBeenCalledWith("hello\n");
    expect(exitListener).toHaveBeenCalledWith(2);
    expect(getScriptStatus("ws-1").run).toEqual({ state: "error", exitCode: 2 });
  });

  it("supports named run scripts", () => {
    startScript("ws-1", "backend", "npm run dev", "/tmp/workspace");
    startScript("ws-1", "frontend", "npm run dev", "/tmp/workspace");

    const status = getScriptStatus("ws-1");
    expect(status.backend?.state).toBe("running");
    expect(status.frontend?.state).toBe("running");
  });

  it("returns false when stopping a non-running script", () => {
    expect(stopScript("ws-1", "run")).toBe(false);
  });

  it("kills the PTY process when stopping a running script", () => {
    startScript("ws-1", "run", "npm run dev", "/tmp/workspace");
    const pty = mocks.processes[0];

    const stopped = stopScript("ws-1", "run");

    expect(stopped).toBe(true);
    expect(pty?.kill).toHaveBeenCalledTimes(1);
  });

  it("sends SIGKILL fallback after timeout if process does not exit", () => {
    vi.useFakeTimers();
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

    startScript("ws-1", "run", "npm run dev", "/tmp/workspace");
    const pty = mocks.processes[0];
    const pid = pty?.pid;

    stopScript("ws-1", "run");
    vi.advanceTimersByTime(5000);

    expect(killSpy).toHaveBeenCalledWith(pid, "SIGKILL");
  });

  it("cancels SIGKILL fallback when process exits before timeout", () => {
    vi.useFakeTimers();
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

    startScript("ws-1", "run", "npm run dev", "/tmp/workspace");
    stopScript("ws-1", "run");
    mocks.processes[0]?.emitExit(0);
    vi.advanceTimersByTime(5000);

    expect(killSpy).not.toHaveBeenCalled();
  });

  it("stops all scripts for a workspace", () => {
    startScript("ws-1", "setup", "npm ci", "/tmp/workspace");
    startScript("ws-1", "backend", "npm run dev", "/tmp/workspace");
    startScript("ws-1", "frontend", "npm run dev", "/tmp/workspace");

    stopAllForWorkspace("ws-1");

    expect(mocks.processes[0]?.kill).toHaveBeenCalledTimes(1);
    expect(mocks.processes[1]?.kill).toHaveBeenCalledTimes(1);
    expect(mocks.processes[2]?.kill).toHaveBeenCalledTimes(1);
  });

  it("stopAllForWorkspace does not stop scripts from other workspaces", () => {
    startScript("ws-1", "setup", "npm ci", "/tmp/workspace");
    startScript("ws-2", "backend", "npm run dev", "/tmp/workspace");

    stopAllForWorkspace("ws-1");

    expect(mocks.processes[0]?.kill).toHaveBeenCalledTimes(1);
    expect(mocks.processes[1]?.kill).not.toHaveBeenCalled();
    expect(getScriptStatus("ws-2").backend?.state).toBe("running");
  });

  it("removes stopped script from activeScripts so status returns idle", () => {
    startScript("ws-1", "run", "npm run dev", "/tmp/workspace");
    expect(getScriptStatus("ws-1").run?.state).toBe("running");

    stopScript("ws-1", "run");

    expect(getScriptStatus("ws-1").run).toBeUndefined();
    expect(getScriptProcess("ws-1", "run")).toBeUndefined();
  });

  it("clears exit listeners on stop so stale broadcasts do not fire", () => {
    const proc = startScript("ws-1", "run", "npm run dev", "/tmp/workspace");
    const exitListener = vi.fn();
    proc.exitListeners.set("broadcast", exitListener);

    stopScript("ws-1", "run");

    // Simulate the PTY exit that happens asynchronously after kill
    mocks.processes[0]?.emitExit(137);

    expect(exitListener).not.toHaveBeenCalled();
  });

  it("clears data listeners on stop so no stale output is pushed", () => {
    const proc = startScript("ws-1", "run", "npm run dev", "/tmp/workspace");
    const dataListener = vi.fn();
    proc.listeners.set("ws-conn", dataListener);

    stopScript("ws-1", "run");

    // Data emitted after stop should not reach cleared listeners
    mocks.processes[0]?.emitData("stale output");

    expect(dataListener).not.toHaveBeenCalled();
  });

  it("preserves naturally completed scripts in activeScripts", () => {
    startScript("ws-1", "setup", "npm ci", "/tmp/workspace");
    mocks.processes[0]?.emitExit(0);

    expect(getScriptStatus("ws-1").setup).toEqual({ state: "done", exitCode: 0 });
    expect(getScriptProcess("ws-1", "setup")).toBeDefined();
  });

  it("stopAllForWorkspace removes all scripts from activeScripts", () => {
    startScript("ws-1", "setup", "npm ci", "/tmp/workspace");
    startScript("ws-1", "backend", "npm run dev", "/tmp/workspace");
    startScript("ws-1", "frontend", "npm run dev", "/tmp/workspace");

    stopAllForWorkspace("ws-1");

    expect(Object.keys(getScriptStatus("ws-1"))).toHaveLength(0);
    expect(getScriptProcess("ws-1", "setup")).toBeUndefined();
    expect(getScriptProcess("ws-1", "backend")).toBeUndefined();
    expect(getScriptProcess("ws-1", "frontend")).toBeUndefined();
  });

  it("clears all active scripts during test cleanup", () => {
    startScript("ws-1", "setup", "npm ci", "/tmp/workspace");
    startScript("ws-2", "run", "npm run dev", "/tmp/workspace");

    _clearAll();

    expect(mocks.processes[0]?.kill).toHaveBeenCalledTimes(1);
    expect(mocks.processes[1]?.kill).toHaveBeenCalledTimes(1);
    expect(getScriptProcess("ws-1", "setup")).toBeUndefined();
    expect(getScriptProcess("ws-2", "run")).toBeUndefined();
  });
});
