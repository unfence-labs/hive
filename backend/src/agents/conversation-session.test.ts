import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ChildProcess } from "node:child_process";
import type { WsOutgoing } from "../types.js";

// Mock child_process.spawn before importing the module under test
vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
  execFile: vi.fn((_cmd: string, _args: string[], cb: (err: null, res: { stdout: string; stderr: string }) => void) => cb(null, { stdout: "", stderr: "" })),
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

function assistantToolUseLine(toolUse: { id: string; name: string; input: unknown }): string {
  return JSON.stringify({
    type: "assistant",
    message: {
      id: "msg-1",
      role: "assistant",
      content: [{ type: "tool_use", ...toolUse }],
    },
  }) + "\n";
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
  // Let pending fire-and-forget async work (e.g. saveImagesToDisk) settle
  await new Promise((r) => setTimeout(r, 250));
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

  function createSession(opts?: { sessionId?: string; command?: string; skipPermissions?: boolean }) {
    return new ConversationSession({
      cwd: "/tmp/test",
      dataDir: tempDir,
      workspaceId: "ws-test",
      sessionId: opts?.sessionId,
      command: opts?.command,
      skipPermissions: opts?.skipPermissions,
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

  it("spawns correct CLI command for first message (--session-id)", () => {
    const session = createSession({ sessionId: "sess-1", command: "claude" });

    session.sendMessage("Hello");

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const args = mockSpawn.mock.calls[0][1] as string[];
    expect(args).toContain("--print");
    expect(args).toContain("--verbose");
    expect(args).toContain("--dangerously-skip-permissions");
    expect(args).toContain("--session-id");
    expect(args).not.toContain("--resume");
    expect(args.slice(-2)).toEqual(["-p", "Hello"]);
    expect(mockProc._stdinEnd).toHaveBeenCalledTimes(1);
  });

  it("omits --dangerously-skip-permissions when disabled", () => {
    const session = createSession({ sessionId: "sess-no-skip", command: "claude", skipPermissions: false });

    session.sendMessage("Hello");

    const args = mockSpawn.mock.calls[0]?.[1] as string[];
    expect(args).not.toContain("--dangerously-skip-permissions");
  });

  it("uses --permission-mode plan when plan mode is enabled", () => {
    const session = createSession({ sessionId: "sess-plan-mode", command: "claude", skipPermissions: true });

    session.sendMessage("Plan this", { planMode: true });

    const args = mockSpawn.mock.calls[0]?.[1] as string[];
    expect(args).toContain("--permission-mode");
    expect(args).toContain("plan");
    expect(args).not.toContain("--dangerously-skip-permissions");
  });

  it("sets MAX_THINKING_TOKENS=0 when thinking is disabled", () => {
    const session = createSession({ sessionId: "sess-think-off", command: "claude" });

    session.sendMessage("Hello", { thinkingEnabled: false });

    const spawnOpts = mockSpawn.mock.calls[0]?.[2] as { env?: NodeJS.ProcessEnv };
    expect(spawnOpts.env?.MAX_THINKING_TOKENS).toBe("0");
  });

  it("sets MAX_THINKING_TOKENS=31999 when thinking is enabled", () => {
    const session = createSession({ sessionId: "sess-think-on", command: "claude" });

    session.sendMessage("Hello", { thinkingEnabled: true });

    const spawnOpts = mockSpawn.mock.calls[0]?.[2] as { env?: NodeJS.ProcessEnv };
    expect(spawnOpts.env?.MAX_THINKING_TOKENS).toBe("31999");
  });

  it("does not override env when thinking option is omitted", () => {
    const session = createSession({ sessionId: "sess-think-default", command: "claude" });

    session.sendMessage("Hello");

    const spawnOpts = mockSpawn.mock.calls[0]?.[2] as { env?: NodeJS.ProcessEnv };
    expect(spawnOpts).not.toHaveProperty("env");
  });

  it("uses --resume with pre-generated session ID on second message", () => {
    const session = createSession({ sessionId: "sess-2" });

    session.sendMessage("First");

    // Capture the pre-generated session ID from the first call's --session-id arg
    const firstArgs = mockSpawn.mock.calls[0][1] as string[];
    const sessionIdIdx = firstArgs.indexOf("--session-id");
    const preGeneratedId = firstArgs[sessionIdIdx + 1];

    mockProc._stdout.push(assistantLine("Hello"));
    mockProc._stdout.push(resultLine(preGeneratedId));
    mockProc._emitClose(0);

    // Create a new mock for second call
    const mockProc2 = createMockProcess();
    mockSpawn.mockReturnValue(mockProc2);

    session.sendMessage("Second");

    expect(mockSpawn).toHaveBeenCalledTimes(2);
    const secondArgs = mockSpawn.mock.calls[1][1] as string[];
    expect(secondArgs).toContain("--resume");
    expect(secondArgs).toContain(preGeneratedId);
    expect(secondArgs).not.toContain("--session-id");
  });

  it("emits text_delta for assistant text", () => {
    const session = createSession({ sessionId: "sess-text-delta" });
    const messages: WsOutgoing[] = [];
    session.on("message", (msg) => messages.push(msg));

    session.sendMessage("Hi");
    mockProc._stdout.push(assistantLine("Hello!"));

    const textDeltas = messages.filter((m) => m.type === "text_delta");
    expect(textDeltas).toHaveLength(1);
    expect(textDeltas[0]).toEqual({ type: "text_delta", sessionId: "sess-text-delta", text: "Hello!" });
  });

  it("emits user_message when a turn starts", () => {
    const session = createSession({ sessionId: "sess-user-evt" });
    const messages: WsOutgoing[] = [];
    session.on("message", (msg) => messages.push(msg));

    session.sendMessage("Hello from user");

    const userEvents = messages.filter((m) => m.type === "user_message");
    expect(userEvents).toHaveLength(1);
    if (userEvents[0].type === "user_message") {
      expect(userEvents[0].message).toMatchObject({
        sessionId: "sess-user-evt",
        role: "user",
        content: "Hello from user",
      });
    }
  });

  it("emits tool_use for assistant tool calls", () => {
    const session = createSession({ sessionId: "sess-tool-use" });
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
      sessionId: "sess-tool-use",
      id: "toolu_abc",
      name: "Read",
      input: JSON.stringify({ file_path: "/foo" }, null, 2),
    });
  });

  it("emits tool_result for user messages", () => {
    const session = createSession({ sessionId: "sess-tool-result" });
    const messages: WsOutgoing[] = [];
    session.on("message", (msg) => messages.push(msg));

    session.sendMessage("Read a file");
    mockProc._stdout.push(userLine([{ tool_use_id: "toolu_abc", content: "file contents" }]));

    const toolResults = messages.filter((m) => m.type === "tool_result");
    expect(toolResults).toHaveLength(1);
    expect(toolResults[0]).toEqual({
      type: "tool_result",
      sessionId: "sess-tool-result",
      toolUseId: "toolu_abc",
      output: "file contents",
    });
  });

  it("assigns parentToolUseId for nested Task sub-tools and clears it when tasks complete", () => {
    const session = createSession();
    const messages: WsOutgoing[] = [];
    session.on("message", (msg) => messages.push(msg));

    session.sendMessage("Run nested tools");

    mockProc._stdout.push(
      assistantToolUseLine({ id: "task-root", name: "Task", input: { prompt: "Root task" } }),
    );
    mockProc._stdout.push(
      assistantToolUseLine({ id: "task-child", name: "Task", input: { prompt: "Child task" } }),
    );
    mockProc._stdout.push(
      assistantToolUseLine({ id: "read-child", name: "Read", input: { file_path: "/tmp/a.ts" } }),
    );
    mockProc._stdout.push(userLine([{ tool_use_id: "read-child", content: "read done" }]));
    mockProc._stdout.push(userLine([{ tool_use_id: "task-child", content: "child done" }]));
    mockProc._stdout.push(
      assistantToolUseLine({ id: "grep-root", name: "Grep", input: { pattern: "TODO" } }),
    );
    mockProc._stdout.push(userLine([{ tool_use_id: "grep-root", content: "grep done" }]));
    mockProc._stdout.push(userLine([{ tool_use_id: "task-root", content: "root done" }]));
    mockProc._stdout.push(
      assistantToolUseLine({ id: "bash-plain", name: "Bash", input: { command: "pwd" } }),
    );

    const toolUses = messages.filter((m) => m.type === "tool_use");
    expect(toolUses).toHaveLength(5);
    expect(toolUses[0]).toMatchObject({ id: "task-root", parentToolUseId: undefined });
    expect(toolUses[1]).toMatchObject({ id: "task-child", parentToolUseId: "task-root" });
    expect(toolUses[2]).toMatchObject({ id: "read-child", parentToolUseId: "task-child" });
    expect(toolUses[3]).toMatchObject({ id: "grep-root", parentToolUseId: "task-root" });
    expect(toolUses[4]).toMatchObject({ id: "bash-plain", parentToolUseId: undefined });
  });

  it("emits thinking events", () => {
    const session = createSession({ sessionId: "sess-thinking" });
    const messages: WsOutgoing[] = [];
    session.on("message", (msg) => messages.push(msg));

    session.sendMessage("Think about this");
    mockProc._stdout.push(thinkingAssistantLine("Hmm, let me think...", "Here's my answer."));

    const thinkingMsgs = messages.filter((m) => m.type === "thinking");
    expect(thinkingMsgs).toHaveLength(1);
    expect(thinkingMsgs[0]).toEqual({ type: "thinking", sessionId: "sess-thinking", text: "Hmm, let me think..." });
  });

  it("emits done on successful process close", async () => {
    const session = createSession();
    const messages: WsOutgoing[] = [];
    session.on("message", (msg) => messages.push(msg));

    session.sendMessage("Hi");
    mockProc._stdout.push(assistantLine("Hello!"));
    mockProc._stdout.push(resultLine());
    mockProc._emitClose(0);

    // Allow async persistence to settle
    await new Promise((r) => setTimeout(r, 50));

    const doneMsgs = messages.filter((m) => m.type === "done");
    expect(doneMsgs).toHaveLength(1);
    expect(doneMsgs[0]).toEqual(expect.objectContaining({
      type: "done",
      sessionId: session.sessionId,
    }));
    expect(session.status).toBe("idle");
  });

  it("tracks streamingStartedAt while streaming and resets it on close", async () => {
    const session = createSession();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);

    expect(session.streamingStartedAt).toBeNull();

    session.sendMessage("Hi");
    expect(session.status).toBe("streaming");
    expect(session.streamingStartedAt).toBe(1_700_000_000_000);

    mockProc._stdout.push(resultLine());
    mockProc._emitClose(0);
    await new Promise((r) => setTimeout(r, 50));

    expect(session.status).toBe("idle");
    expect(session.streamingStartedAt).toBeNull();
    nowSpy.mockRestore();
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
    expect(cancelledMsgs[0]).toEqual(expect.objectContaining({ sessionId: session.sessionId }));
  });

  it("stop() kills the process", () => {
    const session = createSession();
    session.sendMessage("Hi");
    session.stop();
    expect(mockProc.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("stop('park') does not surface cancelled or synthetic interruption when no output exists", async () => {
    const session = createSession({ sessionId: "park-no-cancel" });
    const messages: WsOutgoing[] = [];
    session.on("message", (msg) => messages.push(msg));

    session.sendMessage("Hi");
    session.stop("park");
    mockProc._emitClose(1);

    await new Promise((r) => setTimeout(r, 100));

    expect(messages.some((m) => m.type === "cancelled")).toBe(false);
    expect(messages.some((m) => m.type === "done")).toBe(false);

    const messagesPath = join(tempDir, "sessions", "park-no-cancel", "messages.jsonl");
    const raw = await readFile(messagesPath, "utf-8");
    const lines = raw.split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    const onlyMsg = JSON.parse(lines[0]);
    expect(onlyMsg).toMatchObject({ role: "user", content: "Hi" });
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
    expect(session.streamingStartedAt).not.toBeNull();
    mockProc.emit("error", new Error("spawn failed"));

    const err = await errorPromise;
    expect(err.message).toBe("spawn failed");
    expect(session.status).toBe("error");
    expect(session.streamingStartedAt).toBeNull();
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

  it("emits error messages from stderr", () => {
    const session = createSession();
    const messages: WsOutgoing[] = [];
    session.on("message", (msg) => messages.push(msg));

    session.sendMessage("Hi");
    mockProc._stderr.push("something went wrong");

    const errors = messages.filter((m) => m.type === "error");
    expect(errors).toHaveLength(1);
    if (errors[0].type === "error") {
      expect(errors[0].message).toContain("stderr:");
      expect(errors[0].message).toContain("something went wrong");
    }
  });

  it("defaults command to claude", () => {
    const session = createSession();
    session.sendMessage("Hi");
    expect(mockSpawn).toHaveBeenCalledWith(
      "claude",
      expect.any(Array),
      expect.any(Object),
    );
  });

  it("uses custom command when provided", () => {
    const session = createSession({ command: "bash" });
    session.sendMessage("Hi");
    expect(mockSpawn).toHaveBeenCalledWith(
      "bash",
      expect.any(Array),
      expect.any(Object),
    );
  });

  it("exposes metadata with correct workspaceId", () => {
    const session = createSession();
    expect(session.metadata.workspaceId).toBe("ws-test");
    expect(session.metadata.messageCount).toBe(0);
    expect(session.metadata.sessionId).toBe(session.sessionId);
  });

  it("persists cancelled message with cancelled flag", async () => {
    const session = createSession({ sessionId: "cancel-persist" });

    session.sendMessage("Hi");
    mockProc._stdout.push(assistantLine("Partial response"));
    mockProc._emitClose(1); // non-zero = cancelled

    await new Promise((r) => setTimeout(r, 100));

    const messagesPath = join(tempDir, "sessions", "cancel-persist", "messages.jsonl");
    const raw = await readFile(messagesPath, "utf-8");
    const lines = raw.split("\n").filter(Boolean);

    expect(lines.length).toBe(2);
    const assistantMsg = JSON.parse(lines[1]);
    expect(assistantMsg.cancelled).toBe(true);
  });

  it("persists an explicit interruption message when cancelled before any output", async () => {
    const session = createSession({ sessionId: "cancel-no-output" });

    session.sendMessage("Hi");
    mockProc._emitClose(1); // non-zero = cancelled

    await new Promise((r) => setTimeout(r, 100));

    const messagesPath = join(tempDir, "sessions", "cancel-no-output", "messages.jsonl");
    const raw = await readFile(messagesPath, "utf-8");
    const lines = raw.split("\n").filter(Boolean);

    expect(lines.length).toBe(2);
    const assistantMsg = JSON.parse(lines[1]);
    expect(assistantMsg).toMatchObject({
      role: "assistant",
      cancelled: true,
      content: "Generation interrupted before any output.",
    });
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

  it("saves metadata with pre-generated claudeSessionId", async () => {
    const session = createSession({ sessionId: "meta-test" });

    session.sendMessage("Hi");

    // Capture the pre-generated session ID
    const args = mockSpawn.mock.calls[0][1] as string[];
    const preGeneratedId = args[args.indexOf("--session-id") + 1];

    mockProc._stdout.push(assistantLine("Hello"));
    mockProc._stdout.push(resultLine(preGeneratedId));
    mockProc._emitClose(0);

    await new Promise((r) => setTimeout(r, 100));

    const metaPath = join(tempDir, "sessions", "meta-test", "metadata.json");
    const raw = await readFile(metaPath, "utf-8");
    const meta = JSON.parse(raw);

    expect(meta.sessionId).toBe("meta-test");
    expect(meta.claudeSessionId).toBe(preGeneratedId);
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

    // Capture the pre-generated session ID
    const args = mockSpawn.mock.calls[0][1] as string[];
    const preGeneratedId = args[args.indexOf("--session-id") + 1];

    mockProc._stdout.push(assistantLine("Hey"));
    mockProc._stdout.push(resultLine(preGeneratedId));
    mockProc._emitClose(0);
    await new Promise((r) => setTimeout(r, 100));

    // Load from disk
    const session2 = await ConversationSession.load({
      cwd: "/tmp/test",
      dataDir: tempDir,
      workspaceId: "ws-test",
      sessionId: "load-test",
    });

    expect(session2.metadata.claudeSessionId).toBe(preGeneratedId);
    expect(session2.metadata.messageCount).toBe(1);
  });

  it("kills blocking AskUserQuestion tool calls and emits tool_input_required", async () => {
    const session = createSession({ sessionId: "tool-input-required" });
    const messages: WsOutgoing[] = [];
    session.on("message", (msg) => messages.push(msg));

    session.sendMessage("Need your input");
    mockProc._stdout.push(
      assistantLine("I need info", {
        id: "toolu_ask",
        name: "AskUserQuestion",
        input: { questions: [{ question: "Choose", options: [{ label: "A" }] }] },
      }),
    );

    expect(mockProc.kill).toHaveBeenCalledWith("SIGKILL");

    mockProc._emitClose(137);
    await new Promise((r) => setTimeout(r, 50));

    const doneEvents = messages.filter((m) => m.type === "done");
    const cancelledEvents = messages.filter((m) => m.type === "cancelled");
    const requiredEvents = messages.filter((m) => m.type === "tool_input_required");

    expect(doneEvents).toHaveLength(1);
    expect(cancelledEvents).toHaveLength(0);
    expect(requiredEvents).toHaveLength(1);
    expect(requiredEvents[0]).toMatchObject({
      type: "tool_input_required",
      sessionId: "tool-input-required",
      toolName: "AskUserQuestion",
      toolUseId: "toolu_ask",
      input: { questions: [{ question: "Choose", options: [{ label: "A" }] }] },
    });
    expect(session.status).toBe("idle");
  });

  it("falls back to empty object when blocking tool input is invalid JSON", async () => {
    const session = createSession({ sessionId: "tool-input-invalid" });
    const messages: WsOutgoing[] = [];
    session.on("message", (msg) => messages.push(msg));

    session.sendMessage("Need your input");
    mockProc._stdout.push(
      assistantLine("Broken input", {
        id: "toolu_ask",
        name: "AskUserQuestion",
        input: "{bad-json",
      }),
    );

    mockProc._emitClose(137);
    await new Promise((r) => setTimeout(r, 50));

    const required = messages.find((m) => m.type === "tool_input_required");
    expect(required).toBeDefined();
    if (required?.type === "tool_input_required") {
      expect(required.input).toEqual({});
    }
  });

  it("formats AskUserQuestion answers with question and option labels", () => {
    const session = createSession({ sessionId: "respond-format" });
    const sendSpy = vi.spyOn(session, "sendMessage").mockImplementation(() => {});

    session.respondToToolInput("AskUserQuestion", {
      type: "answer",
      questions: [
        {
          question: "Preferred language?",
          options: [{ label: "TypeScript" }, { label: "Rust" }],
        },
        {
          question: "Why?",
          options: [],
        },
      ],
      answers: [
        { questionIndex: 0, selectedOptions: [1] },
        { questionIndex: 1, selectedOptions: [], customText: "Performance and safety" },
      ],
    });

    expect(sendSpy).toHaveBeenCalledWith(
      "Here are my answers to your questions:\n\"Preferred language?\" → Rust\n\"Why?\" → \"Performance and safety\"",
    );
  });

  it("falls back to numbered labels when question metadata is missing", () => {
    const session = createSession({ sessionId: "respond-fallback" });
    const sendSpy = vi.spyOn(session, "sendMessage").mockImplementation(() => {});

    session.respondToToolInput("AskUserQuestion", {
      type: "answer",
      answers: [{ questionIndex: 2, selectedOptions: [4] }],
    });

    expect(sendSpy).toHaveBeenCalledWith(
      "Here are my answers to your questions:\nQuestion 3 → Option 5",
    );
  });

  it("maps approve and reject tool responses to follow-up messages", () => {
    const session = createSession({ sessionId: "respond-actions" });
    const sendSpy = vi.spyOn(session, "sendMessage").mockImplementation(() => {});

    session.respondToToolInput("ExitPlanMode", { type: "approve" });
    session.respondToToolInput("AskUserQuestion", { type: "reject", message: "Not this option" });
    session.respondToToolInput("AskUserQuestion", { type: "reject" });

    expect(sendSpy).toHaveBeenNthCalledWith(
      1,
      "approved",
    );
    expect(sendSpy).toHaveBeenNthCalledWith(2, "Not this option");
    expect(sendSpy).toHaveBeenNthCalledWith(
      3,
      "I reject this. Please suggest an alternative approach.",
    );
  });

  // ── Image attachment tests ──────────────────────────────────────────

  it("emits user_message with URL-based images after saving to disk", async () => {
    const session = createSession({ sessionId: "img-user-msg" });
    const messages: WsOutgoing[] = [];
    session.on("message", (msg) => messages.push(msg));

    const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const images = [
      { name: "screenshot.png", mediaType: "image/png", dataUrl: `data:image/png;base64,${pngBase64}` },
    ];
    session.sendMessage("Analyze this", undefined, images);

    // Images are saved to disk before emitting — wait for the async save
    await new Promise((r) => setTimeout(r, 200));

    const userEvents = messages.filter((m) => m.type === "user_message");
    expect(userEvents).toHaveLength(1);
    if (userEvents[0].type === "user_message") {
      expect(userEvents[0].message.content).toBe("Analyze this");
      expect(userEvents[0].message.images).toHaveLength(1);
      // dataUrl should be an API path, not the original base64 (resized to .jpg)
      expect(userEvents[0].message.images![0].dataUrl).toMatch(
        /^\/api\/workspaces\/ws-test\/sessions\/img-user-msg\/attachments\/.+\.jpg$/,
      );
      expect(userEvents[0].message.images![0].name).toBe("screenshot.png");
      expect(userEvents[0].message.images![0].mediaType).toBe("image/png");
    }
  });

  it("does not include images field when no images are provided", () => {
    const session = createSession({ sessionId: "no-img" });
    const messages: WsOutgoing[] = [];
    session.on("message", (msg) => messages.push(msg));

    session.sendMessage("Hello");

    const userEvents = messages.filter((m) => m.type === "user_message");
    expect(userEvents).toHaveLength(1);
    if (userEvents[0].type === "user_message") {
      expect(userEvents[0].message.images).toBeUndefined();
    }
  });

  it("does not include images field when images array is empty", () => {
    const session = createSession({ sessionId: "empty-img" });
    const messages: WsOutgoing[] = [];
    session.on("message", (msg) => messages.push(msg));

    session.sendMessage("Hello", undefined, []);

    const userEvents = messages.filter((m) => m.type === "user_message");
    expect(userEvents).toHaveLength(1);
    if (userEvents[0].type === "user_message") {
      expect(userEvents[0].message.images).toBeUndefined();
    }
  });

  it("saves images to disk and builds augmented prompt", async () => {
    const session = createSession({ sessionId: "img-save" });
    const messages: WsOutgoing[] = [];
    session.on("message", (msg) => messages.push(msg));

    // Small valid base64 PNG pixel
    const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const images = [
      { name: "pixel.png", mediaType: "image/png", dataUrl: `data:image/png;base64,${pngBase64}` },
    ];

    session.sendMessage("Look at this", undefined, images);

    // Wait for async image save + spawnCli
    await new Promise((r) => setTimeout(r, 200));

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const args = mockSpawn.mock.calls[0][1] as string[];
    const promptArg = args[args.length - 1];
    expect(promptArg).toContain("Look at this");
    expect(promptArg).toContain("image(s)");
    expect(promptArg).toContain("Read tool");
    expect(promptArg).toContain(".jpg");
  });

  it("uses fallback prompt when images are sent without text", async () => {
    const session = createSession({ sessionId: "img-no-text" });

    const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const images = [
      { name: "pixel.png", mediaType: "image/png", dataUrl: `data:image/png;base64,${pngBase64}` },
    ];

    session.sendMessage("", undefined, images);
    await new Promise((r) => setTimeout(r, 200));

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const args = mockSpawn.mock.calls[0][1] as string[];
    const promptArg = args[args.length - 1];
    expect(promptArg).toContain("Please analyze the attached image(s)");
    expect(promptArg).toContain("Read tool");
  });

  it("skips images with invalid data URL format", async () => {
    const session = createSession({ sessionId: "img-invalid" });

    const images = [
      { name: "bad.png", mediaType: "image/png", dataUrl: "not-a-data-url" },
    ];

    session.sendMessage("Check this", undefined, images);
    await new Promise((r) => setTimeout(r, 200));

    // spawnCli still called but no file paths in the prompt since image was skipped
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const args = mockSpawn.mock.calls[0][1] as string[];
    const promptArg = args[args.length - 1];
    // The prompt should still indicate 0 images were attached effectively
    expect(promptArg).toContain("0 image(s)");
  });

  it("extracts file extension from mediaType", async () => {
    const session = createSession({ sessionId: "img-ext" });
    const { readdir } = await import("node:fs/promises");

    // Valid 1x1 JPEG (sharp can process this → outputs .jpg)
    const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const images = [
      { name: "photo.jpg", mediaType: "image/jpeg", dataUrl: `data:image/jpeg;base64,${pngBase64}` },
    ];

    session.sendMessage("Photo", undefined, images);
    await new Promise((r) => setTimeout(r, 200));

    const attachmentsDir = join(tempDir, "sessions", "img-ext", "attachments");
    const files = await readdir(attachmentsDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\.jpg$/);
  });

  it("creates attachments directory for multiple images", async () => {
    const session = createSession({ sessionId: "img-multi" });
    const { readdir } = await import("node:fs/promises");

    const base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const images = [
      { name: "a.png", mediaType: "image/png", dataUrl: `data:image/png;base64,${base64}` },
      { name: "b.png", mediaType: "image/png", dataUrl: `data:image/png;base64,${base64}` },
    ];

    session.sendMessage("Two images", undefined, images);
    await new Promise((r) => setTimeout(r, 200));

    const attachmentsDir = join(tempDir, "sessions", "img-multi", "attachments");
    const files = await readdir(attachmentsDir);
    expect(files).toHaveLength(2);
  });

  it("persists user message with API URL paths instead of base64", async () => {
    const session = createSession({ sessionId: "img-persist" });

    const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const images = [
      { name: "test.png", mediaType: "image/png", dataUrl: `data:image/png;base64,${pngBase64}` },
    ];

    session.sendMessage("With image", undefined, images);
    await new Promise((r) => setTimeout(r, 200));

    const messagesPath = join(tempDir, "sessions", "img-persist", "messages.jsonl");
    const raw = await readFile(messagesPath, "utf-8");
    const lines = raw.split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    const userMsg = JSON.parse(lines[0]);
    expect(userMsg.role).toBe("user");
    expect(userMsg.content).toBe("With image");
    expect(userMsg.images).toHaveLength(1);
    expect(userMsg.images[0].name).toBe("test.png");
    expect(userMsg.images[0].mediaType).toBe("image/png");
    // dataUrl should be an API path, not base64
    expect(userMsg.images[0].dataUrl).toMatch(/^\/api\/workspaces\//);
    expect(userMsg.images[0].dataUrl).not.toContain("base64");
  });

  it("emitted image URL matches the saved attachment filename on disk", async () => {
    const session = createSession({ sessionId: "img-url-match" });
    const messages: WsOutgoing[] = [];
    session.on("message", (msg) => messages.push(msg));
    const { readdir } = await import("node:fs/promises");

    const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const images = [
      { name: "pixel.png", mediaType: "image/png", dataUrl: `data:image/png;base64,${pngBase64}` },
    ];

    session.sendMessage("Match test", undefined, images);
    await new Promise((r) => setTimeout(r, 200));

    const attachmentsDir = join(tempDir, "sessions", "img-url-match", "attachments");
    const files = await readdir(attachmentsDir);
    expect(files).toHaveLength(1);

    const userEvents = messages.filter((m) => m.type === "user_message");
    if (userEvents[0].type === "user_message") {
      // The URL should end with the same filename that's on disk
      expect(userEvents[0].message.images![0].dataUrl).toContain(files[0]);
    }
  });

  it("persists durationMs from result event in assistant message", async () => {
    const session = createSession({ sessionId: "duration-persist" });

    session.sendMessage("Hi");
    mockProc._stdout.push(assistantLine("Reply"));
    mockProc._stdout.push(
      JSON.stringify({ type: "result", session_id: "s1", duration_ms: 2500 }) + "\n",
    );
    mockProc._emitClose(0);

    await new Promise((r) => setTimeout(r, 100));

    const messagesPath = join(tempDir, "sessions", "duration-persist", "messages.jsonl");
    const raw = await readFile(messagesPath, "utf-8");
    const lines = raw.split("\n").filter(Boolean);
    expect(lines.length).toBe(2);
    const assistantMsg = JSON.parse(lines[1]);
    expect(assistantMsg.durationMs).toBe(2500);
  });

  it("persists thinking content in assistant message", async () => {
    const session = createSession({ sessionId: "thinking-persist" });

    session.sendMessage("Think");
    mockProc._stdout.push(thinkingAssistantLine("Deep thought", "The answer"));
    mockProc._stdout.push(resultLine());
    mockProc._emitClose(0);

    await new Promise((r) => setTimeout(r, 100));

    const messagesPath = join(tempDir, "sessions", "thinking-persist", "messages.jsonl");
    const raw = await readFile(messagesPath, "utf-8");
    const lines = raw.split("\n").filter(Boolean);
    const assistantMsg = JSON.parse(lines[1]);
    expect(assistantMsg.thinkingContent).toBe("Deep thought");
    expect(assistantMsg.content).toBe("The answer");
  });

  it("persists tool calls in assistant message", async () => {
    const session = createSession({ sessionId: "toolcall-persist" });

    session.sendMessage("Do something");
    mockProc._stdout.push(
      assistantLine("Let me read.", { id: "toolu_1", name: "Read", input: { file_path: "/a" } }),
    );
    mockProc._stdout.push(userLine([{ tool_use_id: "toolu_1", content: "file data" }]));
    mockProc._stdout.push(resultLine());
    mockProc._emitClose(0);

    await new Promise((r) => setTimeout(r, 100));

    const messagesPath = join(tempDir, "sessions", "toolcall-persist", "messages.jsonl");
    const raw = await readFile(messagesPath, "utf-8");
    const lines = raw.split("\n").filter(Boolean);
    const assistantMsg = JSON.parse(lines[1]);
    expect(assistantMsg.toolCalls).toHaveLength(1);
    expect(assistantMsg.toolCalls[0].name).toBe("Read");
    expect(assistantMsg.toolCalls[0].output).toBe("file data");
  });

  it("kills blocking ExitPlanMode tool and emits tool_input_required", async () => {
    const session = createSession({ sessionId: "exit-plan-block" });
    const messages: WsOutgoing[] = [];
    session.on("message", (msg) => messages.push(msg));

    session.sendMessage("Plan this");
    mockProc._stdout.push(
      assistantToolUseLine({ id: "toolu_plan", name: "ExitPlanMode", input: { planFile: "plan.md" } }),
    );

    expect(mockProc.kill).toHaveBeenCalledWith("SIGKILL");

    mockProc._emitClose(137);
    await new Promise((r) => setTimeout(r, 50));

    const requiredEvents = messages.filter((m) => m.type === "tool_input_required");
    expect(requiredEvents).toHaveLength(1);
    expect(requiredEvents[0]).toMatchObject({
      type: "tool_input_required",
      sessionId: "exit-plan-block",
      toolName: "ExitPlanMode",
      toolUseId: "toolu_plan",
    });
    expect(session.status).toBe("idle");
  });

  // ── Conversation title tests ──────────────────────────────────────

  it("sets title from first user message", () => {
    const session = createSession({ sessionId: "title-set" });
    session.sendMessage("Fix the login bug");
    expect(session.metadata.title).toBe("Fix the login bug");
  });

  it("truncates title at 50 characters with ellipsis", () => {
    const session = createSession({ sessionId: "title-truncate" });
    const longMsg = "This is a very long message that definitely exceeds the fifty character limit by a lot";
    session.sendMessage(longMsg);
    expect(session.metadata.title).toBe("This is a very long message that definitely exc...");
    expect(session.metadata.title!.length).toBeLessThanOrEqual(50);
  });

  it("uses only the first line for title on multiline messages", () => {
    const session = createSession({ sessionId: "title-multiline" });
    session.sendMessage("First line\nSecond line\nThird line");
    expect(session.metadata.title).toBe("First line");
  });

  it("does not overwrite title on subsequent messages", () => {
    const session = createSession({ sessionId: "title-keep" });
    session.sendMessage("Original title");

    mockProc._stdout.push(assistantLine("OK"));
    mockProc._stdout.push(resultLine());
    mockProc._emitClose(0);

    const mockProc2 = createMockProcess();
    mockSpawn.mockReturnValue(mockProc2);

    session.sendMessage("Second message");
    expect(session.metadata.title).toBe("Original title");
  });

  it("persists title in metadata.json", async () => {
    const session = createSession({ sessionId: "title-persist" });
    session.sendMessage("Persist this title");

    mockProc._stdout.push(assistantLine("Done"));
    mockProc._stdout.push(resultLine());
    mockProc._emitClose(0);

    await new Promise((r) => setTimeout(r, 100));

    const metaPath = join(tempDir, "sessions", "title-persist", "metadata.json");
    const raw = await readFile(metaPath, "utf-8");
    const meta = JSON.parse(raw);
    expect(meta.title).toBe("Persist this title");
  });

  it("trims whitespace before setting title", () => {
    const session = createSession({ sessionId: "title-trim" });
    session.sendMessage("  padded message  \n  more lines  ");
    expect(session.metadata.title).toBe("padded message");
  });

  it("emits first_message event on first sendMessage", () => {
    const session = createSession({ sessionId: "first-msg-evt" });
    const firstMessages: string[] = [];
    session.on("first_message", (content) => firstMessages.push(content));

    session.sendMessage("Hello world");
    expect(firstMessages).toEqual(["Hello world"]);
  });

  it("does not emit first_message on second sendMessage", () => {
    const session = createSession({ sessionId: "no-second-evt" });
    const firstMessages: string[] = [];
    session.on("first_message", (content) => firstMessages.push(content));

    session.sendMessage("First");
    mockProc._stdout.push(assistantLine("OK"));
    mockProc._stdout.push(resultLine());
    mockProc._emitClose(0);

    const mockProc2 = createMockProcess();
    mockSpawn.mockReturnValue(mockProc2);

    session.sendMessage("Second");
    expect(firstMessages).toEqual(["First"]);
  });

  it("setTitle() updates metadata title", async () => {
    const session = createSession({ sessionId: "set-title" });
    session.sendMessage("Initial message");

    // Naive title should be set
    expect(session.metadata.title).toBe("Initial message");

    // Override with setTitle
    session.setTitle("AI-generated title");
    expect(session.metadata.title).toBe("AI-generated title");

    // Wait for persistence
    mockProc._emitClose(0);
    await new Promise((r) => setTimeout(r, 100));

    const metaPath = join(tempDir, "sessions", "set-title", "metadata.json");
    const raw = await readFile(metaPath, "utf-8");
    const meta = JSON.parse(raw);
    expect(meta.title).toBe("AI-generated title");
  });

  it("SIGKILL timeout fires after SIGTERM on stop()", async () => {
    vi.useFakeTimers();
    const session = createSession();
    session.sendMessage("Hi");

    // Override kill to not actually close the process
    mockProc.kill.mockReturnValue(true);
    session.stop();

    expect(mockProc.kill).toHaveBeenCalledWith("SIGTERM");

    vi.advanceTimersByTime(5000);

    // After 5s, SIGKILL should be attempted
    expect(mockProc.kill).toHaveBeenCalledWith("SIGKILL");

    vi.useRealTimers();
  });
});
