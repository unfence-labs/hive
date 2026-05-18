import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StreamAdapter } from "../providers/types.js";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

import { spawn } from "node:child_process";
import { ProcessAgentRunner } from "./process-agent-runner.js";

const mockSpawn = vi.mocked(spawn);

function createMockStream(): EventEmitter & { push(data: string): void } {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    push(data: string) {
      emitter.emit("data", Buffer.from(data));
    },
  });
}

function createMockProcess() {
  const proc = new EventEmitter() as ChildProcess & {
    _stdout: ReturnType<typeof createMockStream>;
    _stderr: ReturnType<typeof createMockStream>;
    _stdinEnd: ReturnType<typeof vi.fn>;
    kill: ReturnType<typeof vi.fn>;
    _emitClose: (code: number) => void;
  };
  proc._stdout = createMockStream();
  proc._stderr = createMockStream();
  proc.stdout = proc._stdout as unknown as ChildProcess["stdout"];
  proc.stderr = proc._stderr as unknown as ChildProcess["stderr"];
  proc._stdinEnd = vi.fn();
  proc.stdin = {
    end: proc._stdinEnd,
    writable: true,
  } as unknown as ChildProcess["stdin"];
  proc.kill = vi.fn(() => true);
  proc._emitClose = (code: number) => proc.emit("close", code);
  return proc;
}

function createParser() {
  const parser = new EventEmitter() as StreamAdapter & {
    writes: string[];
    flush: () => void;
    capturedSessionId?: string;
  };
  parser.writes = [];
  parser.write = (chunk: string) => {
    parser.writes.push(chunk);
  };
  parser.flush = vi.fn(() => {});
  return parser;
}

function createRunner(parser = createParser(), providerId?: string) {
  return new ProcessAgentRunner({
    command: "agent",
    args: ["--json"],
    cwd: "/tmp/project",
    stdinContent: "hello",
    parser,
    providerId,
    useWorkspaceEnv: false,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ProcessAgentRunner", () => {
  it("forwards stdout to the parser and parser events to listeners", () => {
    const proc = createMockProcess();
    const parser = createParser();
    mockSpawn.mockReturnValue(proc);
    const runner = createRunner(parser);
    const assistantEvents: unknown[] = [];
    runner.on("assistant", (event) => assistantEvents.push(event));

    runner.start();
    proc._stdout.push("line 1\n");
    parser.emit("assistant", {
      type: "assistant",
      message: { id: "msg-1", role: "assistant", content: [{ type: "text", text: "hi" }] },
    });

    expect(parser.writes).toEqual(["line 1\n"]);
    expect(assistantEvents).toHaveLength(1);
    expect(proc._stdinEnd).toHaveBeenCalledWith("hello");
  });

  it("classifies provider stderr as suppressed, diagnostic, or error", () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const runner = createRunner(createParser(), "codex");
    const stderrEvents: Array<{ text: string; classification: string }> = [];
    runner.on("stderr", (event) => stderrEvents.push(event));

    runner.start();
    proc._stderr.push("Reading additional input from stdin...");
    proc._stderr.push("failed to connect to websocket: UTF-8 encoding error: failed to convert header to a str for header name 'x-codex-turn-metadata'");
    proc._stderr.push("permission denied");

    expect(stderrEvents).toEqual([
      {
        text: "failed to connect to websocket: UTF-8 encoding error: failed to convert header to a str for header name 'x-codex-turn-metadata'",
        classification: "diagnostic",
      },
      { text: "permission denied", classification: "error" },
    ]);
  });

  it("captures provider session id on exit", () => {
    const proc = createMockProcess();
    const parser = createParser();
    parser.capturedSessionId = "session-123";
    mockSpawn.mockReturnValue(proc);
    const runner = createRunner(parser);
    const exits: Array<[number, string | undefined]> = [];
    runner.on("exit", (code, providerSessionId) => exits.push([code, providerSessionId]));

    runner.start();
    proc._emitClose(0);

    expect(parser.flush).toHaveBeenCalledTimes(1);
    expect(exits).toEqual([[0, "session-123"]]);
  });

  it("stops with SIGTERM and escalates to SIGKILL after timeout", async () => {
    vi.useFakeTimers();
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const runner = createRunner();

    runner.start();
    runner.stop("user");

    expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
    await vi.advanceTimersByTimeAsync(5000);
    expect(proc.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("clears the SIGKILL timeout when the process closes", async () => {
    vi.useFakeTimers();
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const runner = createRunner();

    runner.start();
    runner.stop("user");
    proc._emitClose(0);
    await vi.advanceTimersByTimeAsync(5000);

    expect(proc.kill).toHaveBeenCalledTimes(1);
  });
});
