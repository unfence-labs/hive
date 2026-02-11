import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import type { WsOutgoing, StreamEvent } from "../types.js";

// Mock child_process.spawn before importing the module under test
vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

import { spawn } from "node:child_process";
import { ConversationSession } from "./conversation-session.js";

const mockSpawn = vi.mocked(spawn);

/** Simple EventEmitter-based mock for stdio streams. */
function createMockStream(): EventEmitter & { push(data: string): void } {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    push(data: string) {
      emitter.emit("data", Buffer.from(data));
    },
  });
}

/** Create a fake ChildProcess that we can control. */
function createMockProcess() {
  const proc = new EventEmitter() as ChildProcess & {
    _stdout: ReturnType<typeof createMockStream>;
    _stderr: ReturnType<typeof createMockStream>;
    kill: ReturnType<typeof vi.fn>;
    pid: number;
    _emitClose: (code: number) => void;
  };
  proc._stdout = createMockStream();
  proc._stderr = createMockStream();
  proc.stdout = proc._stdout as unknown as ChildProcess["stdout"];
  proc.stderr = proc._stderr as unknown as ChildProcess["stderr"];
  proc.stdin = new EventEmitter() as unknown as ChildProcess["stdin"];
  proc.pid = 12345;
  proc.kill = vi.fn(() => true);
  proc._emitClose = (code: number) => proc.emit("close", code);
  return proc;
}

function streamEventLine(event: StreamEvent): string {
  return JSON.stringify({ type: "stream_event", event }) + "\n";
}

describe("ConversationSession", () => {
  let mockProc: ReturnType<typeof createMockProcess>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockProc = createMockProcess();
    mockSpawn.mockReturnValue(mockProc);
  });

  it("creates session with a sessionId", () => {
    const session = new ConversationSession({ cwd: "/tmp/test" });
    expect(session.sessionId).toBeTruthy();
    expect(typeof session.sessionId).toBe("string");
    expect(session.status).toBe("idle");
  });

  it("uses provided sessionId", () => {
    const session = new ConversationSession({
      cwd: "/tmp/test",
      sessionId: "my-session",
    });
    expect(session.sessionId).toBe("my-session");
  });

  it("spawns correct CLI command for first message", () => {
    const session = new ConversationSession({
      cwd: "/workspace",
      sessionId: "sess-1",
      command: "claude",
    });

    session.sendMessage("Hello");

    expect(mockSpawn).toHaveBeenCalledWith(
      "claude",
      [
        "-p", "Hello",
        "--output-format", "stream-json",
        "--include-partial-messages",
        "--verbose",
        "--dangerously-skip-permissions",
        "--session-id", "sess-1",
      ],
      { cwd: "/workspace", stdio: ["pipe", "pipe", "pipe"] },
    );
  });

  it("uses --resume for subsequent messages", () => {
    const session = new ConversationSession({
      cwd: "/workspace",
      sessionId: "sess-2",
    });

    // First message
    session.sendMessage("First");
    mockProc._emitClose(0);

    // Create a new mock for second call
    const mockProc2 = createMockProcess();
    mockSpawn.mockReturnValue(mockProc2);

    session.sendMessage("Second");

    expect(mockSpawn).toHaveBeenCalledTimes(2);
    const secondArgs = mockSpawn.mock.calls[1][1] as string[];
    expect(secondArgs).toContain("--resume");
    expect(secondArgs).not.toContain("--session-id");
  });

  it("parses streaming output into text_delta events", () => {
    const session = new ConversationSession({
      cwd: "/tmp/test",
      sessionId: "sess-3",
    });
    const messages: WsOutgoing[] = [];
    session.on("message", (msg) => messages.push(msg));

    session.sendMessage("Hi");

    mockProc._stdout.push(streamEventLine({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "Hello!" },
    }));

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({ type: "text_delta", text: "Hello!" });
  });

  it("parses tool_use events correctly", () => {
    const session = new ConversationSession({
      cwd: "/tmp/test",
      sessionId: "sess-4",
    });
    const messages: WsOutgoing[] = [];
    session.on("message", (msg) => messages.push(msg));

    session.sendMessage("Read a file");

    mockProc._stdout.push(streamEventLine({
      type: "content_block_start",
      index: 1,
      content_block: { type: "tool_use", id: "toolu_abc", name: "Read" },
    }));

    mockProc._stdout.push(streamEventLine({
      type: "content_block_delta",
      index: 1,
      delta: { type: "input_json_delta", partial_json: '{"path":"/foo"}' },
    }));

    mockProc._stdout.push(streamEventLine({
      type: "content_block_stop",
      index: 1,
    }));

    expect(messages).toHaveLength(3);
    expect(messages[0]).toEqual({ type: "tool_use_start", id: "toolu_abc", name: "Read" });
    expect(messages[1]).toEqual({ type: "tool_use_delta", id: "toolu_abc", input: '{"path":"/foo"}' });
    expect(messages[2]).toEqual({ type: "tool_use_end", id: "toolu_abc" });
  });

  it("emits message_end on message_stop", () => {
    const session = new ConversationSession({
      cwd: "/tmp/test",
      sessionId: "sess-5",
    });
    const messages: WsOutgoing[] = [];
    session.on("message", (msg) => messages.push(msg));

    session.sendMessage("Hi");
    mockProc._stdout.push(streamEventLine({ type: "message_stop" }));

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({ type: "message_end" });
  });

  it("handles process exit with success", async () => {
    const session = new ConversationSession({
      cwd: "/tmp/test",
      sessionId: "sess-6",
    });

    const exitPromise = new Promise<number>((resolve) => {
      session.on("exit", resolve);
    });

    session.sendMessage("Hi");
    expect(session.status).toBe("streaming");

    mockProc._emitClose(0);
    const code = await exitPromise;

    expect(code).toBe(0);
    expect(session.status).toBe("idle");
  });

  it("handles process exit with error", async () => {
    const session = new ConversationSession({
      cwd: "/tmp/test",
      sessionId: "sess-7",
    });

    const exitPromise = new Promise<number>((resolve) => {
      session.on("exit", resolve);
    });

    session.sendMessage("Hi");
    mockProc._emitClose(1);
    const code = await exitPromise;

    expect(code).toBe(1);
    expect(session.status).toBe("error");
  });

  it("stop() kills the process", () => {
    const session = new ConversationSession({
      cwd: "/tmp/test",
      sessionId: "sess-8",
    });

    session.sendMessage("Hi");
    session.stop();

    expect(mockProc.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("rejects concurrent messages while streaming", () => {
    const session = new ConversationSession({
      cwd: "/tmp/test",
      sessionId: "sess-9",
    });

    session.sendMessage("First");
    expect(() => session.sendMessage("Second")).toThrow("Already streaming");
  });

  it("allows new message after previous one completes", () => {
    const session = new ConversationSession({
      cwd: "/tmp/test",
      sessionId: "sess-10",
    });

    session.sendMessage("First");
    mockProc._emitClose(0);

    const mockProc2 = createMockProcess();
    mockSpawn.mockReturnValue(mockProc2);

    expect(() => session.sendMessage("Second")).not.toThrow();
    expect(session.status).toBe("streaming");
  });

  it("handles spawn error", async () => {
    const session = new ConversationSession({
      cwd: "/tmp/test",
      sessionId: "sess-11",
    });

    const errorPromise = new Promise<Error>((resolve) => {
      session.on("error", resolve);
    });

    session.sendMessage("Hi");
    mockProc.emit("error", new Error("spawn failed"));

    const err = await errorPromise;
    expect(err.message).toBe("spawn failed");
    expect(session.status).toBe("error");
  });

  it("flushes parser on process close", () => {
    const session = new ConversationSession({
      cwd: "/tmp/test",
      sessionId: "sess-12",
    });
    const messages: WsOutgoing[] = [];
    session.on("message", (msg) => messages.push(msg));

    session.sendMessage("Hi");

    // Send data without trailing newline — will be buffered in parser
    const line = JSON.stringify({
      type: "stream_event",
      event: { type: "message_stop" },
    });
    mockProc._stdout.push(line); // no newline

    expect(messages).toHaveLength(0); // buffered

    mockProc._emitClose(0); // flush happens here
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({ type: "message_end" });
  });

  it("stop() is a no-op when not streaming", () => {
    const session = new ConversationSession({
      cwd: "/tmp/test",
      sessionId: "sess-13",
    });

    // Should not throw
    expect(() => session.stop()).not.toThrow();
  });
});
