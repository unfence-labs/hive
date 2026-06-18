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
        return { dispose: () => dataHandlers.delete(handler) };
      },
      onExit: (handler: ExitHandler) => {
        exitHandlers.add(handler);
        return { dispose: () => exitHandlers.delete(handler) };
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
  startTerminal,
  stopTerminal,
  getTerminalProcess,
  stopAllTerminalsForWorkspace,
  stopAllTerminals,
  _clearAllTerminals,
} from "./terminal-runner.js";

beforeEach(() => {
  mocks.reset();
  _clearAllTerminals();
  vi.useRealTimers();
});

afterEach(() => {
  _clearAllTerminals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("terminal-runner", () => {
  it("starts an interactive login shell and tracks the running process", () => {
    process.env.SHELL = "/bin/bash";

    const proc = startTerminal("ws-1", "sess-1", "/tmp/workspace");

    expect(mocks.spawn).toHaveBeenCalledWith(
      "/bin/bash",
      ["-l"],
      expect.objectContaining({ cwd: "/tmp/workspace" }),
    );
    expect(proc.state).toBe("running");
    expect(getTerminalProcess("ws-1", "sess-1")).toBe(proc);
  });

  it("throws when starting a terminal that is already running for the same key", () => {
    startTerminal("ws-1", "sess-1", "/tmp/workspace");
    expect(() => startTerminal("ws-1", "sess-1", "/tmp/workspace")).toThrow(
      'Terminal "sess-1" is already running for workspace ws-1',
    );
  });

  it("allows restarting after the previous terminal has exited", () => {
    const first = startTerminal("ws-1", "sess-1", "/tmp/workspace");
    mocks.processes[0]?.emitExit(0);

    const second = startTerminal("ws-1", "sess-1", "/tmp/workspace");
    expect(second).not.toBe(first);
    expect(second.state).toBe("running");
  });

  it("returns false when stopping a terminal that is not running", () => {
    expect(stopTerminal("ws-1", "sess-1")).toBe(false);
  });

  it("kills the PTY and removes the entry on stop", () => {
    startTerminal("ws-1", "sess-1", "/tmp/workspace");
    const pty = mocks.processes[0];

    const stopped = stopTerminal("ws-1", "sess-1");

    expect(stopped).toBe(true);
    expect(pty?.kill).toHaveBeenCalledTimes(1);
    expect(getTerminalProcess("ws-1", "sess-1")).toBeUndefined();
  });

  it("stops all terminals for a workspace without touching other workspaces", () => {
    startTerminal("ws-1", "sess-a", "/tmp/workspace");
    startTerminal("ws-1", "sess-b", "/tmp/workspace");
    startTerminal("ws-2", "sess-c", "/tmp/workspace");

    stopAllTerminalsForWorkspace("ws-1");

    expect(mocks.processes[0]?.kill).toHaveBeenCalledTimes(1);
    expect(mocks.processes[1]?.kill).toHaveBeenCalledTimes(1);
    expect(mocks.processes[2]?.kill).not.toHaveBeenCalled();
    expect(getTerminalProcess("ws-1", "sess-a")).toBeUndefined();
    expect(getTerminalProcess("ws-1", "sess-b")).toBeUndefined();
    expect(getTerminalProcess("ws-2", "sess-c")?.state).toBe("running");
  });

  it("stops all terminals across all workspaces", () => {
    startTerminal("ws-1", "sess-a", "/tmp/workspace");
    startTerminal("ws-2", "sess-b", "/tmp/workspace");

    stopAllTerminals();

    expect(mocks.processes[0]?.kill).toHaveBeenCalledTimes(1);
    expect(mocks.processes[1]?.kill).toHaveBeenCalledTimes(1);
    expect(getTerminalProcess("ws-1", "sess-a")).toBeUndefined();
    expect(getTerminalProcess("ws-2", "sess-b")).toBeUndefined();
  });
});
