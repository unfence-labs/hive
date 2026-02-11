import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ChildProcess } from "node:child_process";
import type { WsOutgoing } from "../types.js";

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
    _stdinEnd: ReturnType<typeof vi.fn>;
    kill: ReturnType<typeof vi.fn>;
    pid: number;
    _emitClose: (code: number) => void;
  };
  proc._stdout = createMockStream();
  proc._stderr = createMockStream();
  proc.stdout = proc._stdout as unknown as ChildProcess["stdout"];
  proc.stderr = proc._stderr as unknown as ChildProcess["stderr"];
  proc._stdinEnd = vi.fn();
  proc.stdin = { end: proc._stdinEnd } as unknown as ChildProcess["stdin"];
  proc.pid = 12345;
  proc.kill = vi.fn(() => true);
  proc._emitClose = (code: number) => proc.emit("close", code);
  return proc;
}

function assistantLine(text: string, toolUse?: { id: string; name: string; input: unknown }): string {
  const content: unknown[] = [{ type: "text", text }];
  if (toolUse) {
    content.push({ type: "tool_use", ...toolUse });
  }
  return JSON.stringify({ type: "assistant", message: { id: "msg-1", role: "assistant", content } }) + "\n";
}

function userLine(toolResults: Array<{ tool_use_id: string; content: string }>): string {
  return JSON.stringify({
    type: "user",
    message: { role: "user", content: toolResults.map((r) => ({ type: "tool_result", ...r })) },
  }) + "\n";
}

function resultLine(sessionId = "sess-123", costUsd = 0.01): string {
  return JSON.stringify({ type: "result", session_id: sessionId, cost_usd: costUsd }) + "\n";
}

function thinkingAssistantLine(thinking: string, text: string): string {
  return JSON.stringify({
    type: "assistant",
    message: {
      id: "msg-1",
      role: "assistant",
      content: [
        { type: "thinking", thinking },
        { type: "text", text },
      ],
    },
  }) + "\n";
}

let tempDir: string;

beforeEach(async () => {
  vi.clearAllMocks();
  const os = await import("node:os");
  const fs = await import("node:fs/promises");
  tempDir = await fs.mkdtemp(join(os.tmpdir(), "hive-conv-session-test-"));
});

afterEach(async () => {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await rm(tempDir, { recursive: true, force: true });
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOTEMPTY" || attempt === 4) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, 25));
    }
  }
});

describe("ConversationSession", () => {
  let mockProc: ReturnType<typeof createMockProcess>;

  beforeEach(() => {
    mockProc = createMockProcess();
    mockSpawn.mockReturnValue(mockProc);
  });

  function createSession(opts?: { sessionId?: string; command?: string }) {
    return new ConversationSession({
      cwd: "/tmp/test",
      dataDir: tempDir,
      workspaceId: "ws-test",
      sessionId: opts?.sessionId,
      command: opts?.command,
    });
  }

  it("creates session with a sessionId", () => {
    const session = createSession();
    expect(session.sessionId).toBeTruthy();
    expect(typeof session.sessionId).toBe("string");
    expect(session.status).toBe("idle");
  });

  it("uses provided sessionId", () => {
    const session = createSession({ sessionId: "my-session" });
    expect(session.sessionId).toBe("my-session");
  });

  it("spawns correct CLI command for first message (no --resume)", () => {
    const session = createSession({ sessionId: "sess-1", command: "claude" });

    session.sendMessage("Hello");

    expect(mockSpawn).toHaveBeenCalledWith(
      "claude",
      [
        "--print",
        "--output-format", "stream-json",
        "--verbose",
        "--dangerously-skip-permissions",
        "-p", "Hello",
      ],
      { cwd: "/tmp/test", stdio: ["pipe", "pipe", "pipe"] },
    );
    expect(mockProc._stdinEnd).toHaveBeenCalledTimes(1);
  });

  it("uses --resume after receiving claudeSessionId from result", () => {
    const session = createSession({ sessionId: "sess-2" });

    session.sendMessage("First");

    // Simulate the result with session_id
    mockProc._stdout.push(resultLine("claude-sess-abc"));
    mockProc._emitClose(0);

    // Create a new mock for second call
    const mockProc2 = createMockProcess();
    mockSpawn.mockReturnValue(mockProc2);

    session.sendMessage("Second");

    expect(mockSpawn).toHaveBeenCalledTimes(2);
    const secondArgs = mockSpawn.mock.calls[1][1] as string[];
    expect(secondArgs).toContain("--resume");
    expect(secondArgs).toContain("claude-sess-abc");
  });

  it("emits text_delta for assistant text", () => {
    const session = createSession();
    const messages: WsOutgoing[] = [];
    session.on("message", (msg) => messages.push(msg));

    session.sendMessage("Hi");
    mockProc._stdout.push(assistantLine("Hello!"));

    const textDeltas = messages.filter((m) => m.type === "text_delta");
    expect(textDeltas).toHaveLength(1);
    expect(textDeltas[0]).toEqual({ type: "text_delta", text: "Hello!" });
  });

  it("emits tool_use for assistant tool calls", () => {
    const session = createSession();
    const messages: WsOutgoing[] = [];
    session.on("message", (msg) => messages.push(msg));

    session.sendMessage("Read a file");
    mockProc._stdout.push(
      assistantLine("Let me read that.", { id: "toolu_abc", name: "Read", input: { file_path: "/foo" } }),
    );

    const toolUses = messages.filter((m) => m.type === "tool_use");
    expect(toolUses).toHaveLength(1);
    expect(toolUses[0]).toEqual({
      type: "tool_use",
      id: "toolu_abc",
      name: "Read",
      input: JSON.stringify({ file_path: "/foo" }, null, 2),
    });
  });

  it("emits tool_result for user messages", () => {
    const session = createSession();
    const messages: WsOutgoing[] = [];
    session.on("message", (msg) => messages.push(msg));

    session.sendMessage("Read a file");
    mockProc._stdout.push(userLine([{ tool_use_id: "toolu_abc", content: "file contents" }]));

    const toolResults = messages.filter((m) => m.type === "tool_result");
    expect(toolResults).toHaveLength(1);
    expect(toolResults[0]).toEqual({
      type: "tool_result",
      toolUseId: "toolu_abc",
      output: "file contents",
    });
  });

  it("emits thinking events", () => {
    const session = createSession();
    const messages: WsOutgoing[] = [];
    session.on("message", (msg) => messages.push(msg));

    session.sendMessage("Think about this");
    mockProc._stdout.push(thinkingAssistantLine("Hmm, let me think...", "Here's my answer."));

    const thinkingMsgs = messages.filter((m) => m.type === "thinking");
    expect(thinkingMsgs).toHaveLength(1);
    expect(thinkingMsgs[0]).toEqual({ type: "thinking", text: "Hmm, let me think..." });
  });

  it("emits done on successful process close", async () => {
    const session = createSession();
    const messages: WsOutgoing[] = [];
    session.on("message", (msg) => messages.push(msg));

    session.sendMessage("Hi");
    mockProc._stdout.push(assistantLine("Hello!"));
    mockProc._stdout.push(resultLine("claude-sess-1"));
    mockProc._emitClose(0);

    // Allow async persistence to settle
    await new Promise((r) => setTimeout(r, 50));

    const doneMsgs = messages.filter((m) => m.type === "done");
    expect(doneMsgs).toHaveLength(1);
    expect(doneMsgs[0]).toEqual({ type: "done", sessionId: "claude-sess-1" });
    expect(session.status).toBe("idle");
  });

  it("emits cancelled on non-zero exit while streaming", async () => {
    const session = createSession();
    const messages: WsOutgoing[] = [];
    session.on("message", (msg) => messages.push(msg));

    session.sendMessage("Hi");
    mockProc._stdout.push(assistantLine("Partial..."));
    mockProc._emitClose(1);

    await new Promise((r) => setTimeout(r, 50));

    const cancelledMsgs = messages.filter((m) => m.type === "cancelled");
    expect(cancelledMsgs).toHaveLength(1);
  });

  it("stop() kills the process", () => {
    const session = createSession();
    session.sendMessage("Hi");
    session.stop();
    expect(mockProc.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("rejects concurrent messages while streaming", () => {
    const session = createSession();
    session.sendMessage("First");
    expect(() => session.sendMessage("Second")).toThrow("Already streaming");
  });

  it("allows new message after previous one completes", () => {
    const session = createSession();

    session.sendMessage("First");
    mockProc._stdout.push(resultLine("sess-x"));
    mockProc._emitClose(0);

    const mockProc2 = createMockProcess();
    mockSpawn.mockReturnValue(mockProc2);

    expect(() => session.sendMessage("Second")).not.toThrow();
    expect(session.status).toBe("streaming");
  });

  it("handles spawn error", async () => {
    const session = createSession();
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
    const session = createSession();
    const messages: WsOutgoing[] = [];
    session.on("message", (msg) => messages.push(msg));

    session.sendMessage("Hi");

    // Send assistant data without trailing newline
    const line = JSON.stringify({
      type: "assistant",
      message: { id: "msg-1", role: "assistant", content: [{ type: "text", text: "flushed" }] },
    });
    mockProc._stdout.push(line); // no newline

    const textDeltas = messages.filter((m) => m.type === "text_delta");
    expect(textDeltas).toHaveLength(0); // buffered

    mockProc._emitClose(0); // flush happens here
    const afterFlush = messages.filter((m) => m.type === "text_delta");
    expect(afterFlush).toHaveLength(1);
  });

  it("stop() is a no-op when not streaming", () => {
    const session = createSession();
    expect(() => session.stop()).not.toThrow();
  });

  it("persists user message on send", async () => {
    const session = createSession({ sessionId: "persist-test" });

    session.sendMessage("Hello");
    mockProc._emitClose(0);

    // Wait for async persistence
    await new Promise((r) => setTimeout(r, 100));

    const messagesPath = join(tempDir, "sessions", "persist-test", "messages.jsonl");
    const raw = await readFile(messagesPath, "utf-8");
    const lines = raw.split("\n").filter(Boolean);

    expect(lines.length).toBeGreaterThanOrEqual(1);
    const userMsg = JSON.parse(lines[0]);
    expect(userMsg.role).toBe("user");
    expect(userMsg.content).toBe("Hello");
    expect(userMsg.sessionId).toBe("persist-test");
  });

  it("persists assistant message on done", async () => {
    const session = createSession({ sessionId: "persist-asst" });

    session.sendMessage("Hi");
    mockProc._stdout.push(assistantLine("Hello back!"));
    mockProc._stdout.push(resultLine("claude-s1"));
    mockProc._emitClose(0);

    await new Promise((r) => setTimeout(r, 100));

    const messagesPath = join(tempDir, "sessions", "persist-asst", "messages.jsonl");
    const raw = await readFile(messagesPath, "utf-8");
    const lines = raw.split("\n").filter(Boolean);

    expect(lines.length).toBe(2); // user + assistant
    const assistantMsg = JSON.parse(lines[1]);
    expect(assistantMsg.role).toBe("assistant");
    expect(assistantMsg.content).toBe("Hello back!");
  });

  it("saves metadata with claudeSessionId after result", async () => {
    const session = createSession({ sessionId: "meta-test" });

    session.sendMessage("Hi");
    mockProc._stdout.push(assistantLine("Hello"));
    mockProc._stdout.push(resultLine("claude-real-id"));
    mockProc._emitClose(0);

    await new Promise((r) => setTimeout(r, 100));

    const metaPath = join(tempDir, "sessions", "meta-test", "metadata.json");
    const raw = await readFile(metaPath, "utf-8");
    const meta = JSON.parse(raw);

    expect(meta.sessionId).toBe("meta-test");
    expect(meta.claudeSessionId).toBe("claude-real-id");
    expect(meta.messageCount).toBe(1);
  });

  it("getMessages() returns persisted messages", async () => {
    const session = createSession({ sessionId: "getmsgs-test" });

    session.sendMessage("Hi");
    mockProc._stdout.push(assistantLine("Hey!"));
    mockProc._stdout.push(resultLine());
    mockProc._emitClose(0);

    await new Promise((r) => setTimeout(r, 100));

    const messages = await session.getMessages();
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("user");
    expect(messages[1].role).toBe("assistant");
  });

  it("getMessages() returns empty for fresh session", async () => {
    const session = createSession();
    const messages = await session.getMessages();
    expect(messages).toEqual([]);
  });

  it("static load() restores metadata from disk", async () => {
    // First session creates metadata
    const session1 = createSession({ sessionId: "load-test" });
    session1.sendMessage("Hi");
    mockProc._stdout.push(assistantLine("Hey"));
    mockProc._stdout.push(resultLine("loaded-sess"));
    mockProc._emitClose(0);
    await new Promise((r) => setTimeout(r, 100));

    // Load from disk
    const session2 = await ConversationSession.load({
      cwd: "/tmp/test",
      dataDir: tempDir,
      workspaceId: "ws-test",
      sessionId: "load-test",
    });

    expect(session2.metadata.claudeSessionId).toBe("loaded-sess");
    expect(session2.metadata.messageCount).toBe(1);
  });
});
