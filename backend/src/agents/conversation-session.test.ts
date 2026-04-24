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
import * as providerRegistry from "./providers/registry.js";

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

function geminiInitLine(sessionId: string, model = "gemini-3.1-pro-preview"): string {
  return JSON.stringify({ type: "init", session_id: sessionId, model }) + "\n";
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

  it("passes --effort with thinking level when provided", () => {
    const session = createSession({ sessionId: "sess-effort-low", command: "claude" });

    session.sendMessage("Hello", { thinkingLevel: "low" });

    const args = mockSpawn.mock.calls[0]?.[1] as string[];
    const idx = args.indexOf("--effort");
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(args[idx + 1]).toBe("low");
  });

  it("omits --effort when thinkingLevel is not provided", () => {
    const session = createSession({ sessionId: "sess-effort-default", command: "claude" });

    session.sendMessage("Hello");

    const args = mockSpawn.mock.calls[0]?.[1] as string[];
    expect(args).not.toContain("--effort");
  });

  it("always includes CLAUDE_CODE_ENABLE_TASKS in env", () => {
    const session = createSession({ sessionId: "sess-think-default", command: "claude" });

    session.sendMessage("Hello");

    const spawnOpts = mockSpawn.mock.calls[0]?.[2] as { env?: Record<string, string> };
    expect(spawnOpts.env).toBeDefined();
    expect(spawnOpts.env!.CLAUDE_CODE_ENABLE_TASKS).toBe("true");
  });

  it("merges provider env overrides with existing process env", () => {
    const key = "TEST_KEEP_ENV";
    const previousValue = process.env[key];
    process.env[key] = "keep-me";

    try {
      const session = createSession({ sessionId: "sess-env-merge", command: "claude" });
      session.sendMessage("Hello", { thinkingLevel: "high" });

      const spawnOpts = mockSpawn.mock.calls[0]?.[2] as { env?: Record<string, string | undefined> };
      expect(spawnOpts.env?.[key]).toBe("keep-me");
      expect(spawnOpts.env?.CLAUDE_CODE_ENABLE_TASKS).toBe("true");
    } finally {
      if (previousValue === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previousValue;
      }
    }
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

  it("uses Gemini init session_id for resume on second message", () => {
    const session = createSession({ sessionId: "gemini-resume" });

    session.sendMessage("First", { model: "gemini:gemini-3.1-pro-preview" });

    const firstArgs = mockSpawn.mock.calls[0][1] as string[];
    expect(firstArgs).not.toContain("-r");

    mockProc._stdout.push(geminiInitLine("gem-sess-123"));
    mockProc._emitClose(0);

    const mockProc2 = createMockProcess();
    mockSpawn.mockReturnValue(mockProc2);

    session.sendMessage("Second", { model: "gemini:gemini-3-flash-preview" });

    const secondArgs = mockSpawn.mock.calls[1][1] as string[];
    const resumeIdx = secondArgs.indexOf("-r");
    expect(resumeIdx).toBeGreaterThanOrEqual(0);
    expect(secondArgs[resumeIdx + 1]).toBe("gem-sess-123");
    expect(session.metadata.claudeSessionId).toBe("gem-sess-123");
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

  it("suppresses known Gemini stderr noise messages", () => {
    const session = createSession({ sessionId: "gemini-stderr-noise" });
    const messages: WsOutgoing[] = [];
    session.on("message", (msg) => messages.push(msg));

    session.sendMessage("Hi", { model: "gemini:gemini-3.1-pro-preview" });
    mockProc._stderr.push("Loaded cached credentials at /tmp/creds");
    mockProc._stderr.push("YOLO mode is enabled for this run");
    mockProc._stderr.push("Retrying with backoff in 1000ms");
    mockProc._stderr.push("GaxiosError: 429 Too Many Requests");

    const errors = messages.filter((m) => m.type === "error");
    expect(errors).toHaveLength(0);
  });

  it("still emits stderr errors for Gemini when message is not noise", () => {
    const session = createSession({ sessionId: "gemini-stderr-real" });
    const messages: WsOutgoing[] = [];
    session.on("message", (msg) => messages.push(msg));

    session.sendMessage("Hi", { model: "gemini:gemini-3.1-pro-preview" });
    mockProc._stderr.push("permission denied");

    const errors = messages.filter((m) => m.type === "error");
    expect(errors).toHaveLength(1);
    if (errors[0].type === "error") {
      expect(errors[0].message).toContain("stderr:");
      expect(errors[0].message).toContain("permission denied");
    }
  });

  it("sends Codex prompt through stdin", () => {
    const session = createSession({ sessionId: "codex-stdin" });

    session.sendMessage("Hi Codex", { model: "codex:gpt-5.5" });

    expect(mockSpawn).toHaveBeenCalledWith(
      "codex",
      expect.arrayContaining(["exec", "--json", "-"]),
      expect.any(Object),
    );
    expect(mockProc._stdinEnd).toHaveBeenCalledWith("Hi Codex");
  });

  it("suppresses known Codex stderr diagnostics", () => {
    const session = createSession({ sessionId: "codex-stderr-noise" });
    const messages: WsOutgoing[] = [];
    session.on("message", (msg) => messages.push(msg));

    session.sendMessage("Hi", { model: "codex:gpt-5.5" });
    mockProc._stderr.push("Reading additional input from stdin...");
    mockProc._stderr.push("2026-04-24T08:34:25.714940Z ERROR codex_core::tools::router: error=resources/templates/list failed: unknown MCP server 'openaiDeveloperDocs'");
    mockProc._stderr.push("2026-04-24T08:34:25.714946Z ERROR codex_core::tools::router: error=resources/list failed: unknown MCP server 'openaiDeveloperDocs'");

    const errors = messages.filter((m) => m.type === "error");
    expect(errors).toHaveLength(0);
  });

  it("still emits Codex stderr errors when message is not known noise", () => {
    const session = createSession({ sessionId: "codex-stderr-real" });
    const messages: WsOutgoing[] = [];
    session.on("message", (msg) => messages.push(msg));

    session.sendMessage("Hi", { model: "codex:gpt-5.5" });
    mockProc._stderr.push("permission denied");

    const errors = messages.filter((m) => m.type === "error");
    expect(errors).toHaveLength(1);
    if (errors[0].type === "error") {
      expect(errors[0].message).toContain("stderr:");
      expect(errors[0].message).toContain("permission denied");
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
    expect(assistantMsg.errorDetail).toContain("exit code 1");
  });

  it("persists stderr in cancellation diagnostics", async () => {
    const session = createSession({ sessionId: "cancel-with-stderr" });

    session.sendMessage("Hi");
    mockProc._stderr.push("permission denied");
    mockProc._emitClose(1); // non-zero = cancelled

    await new Promise((r) => setTimeout(r, 100));

    const messagesPath = join(tempDir, "sessions", "cancel-with-stderr", "messages.jsonl");
    const raw = await readFile(messagesPath, "utf-8");
    const lines = raw.split("\n").filter(Boolean);

    expect(lines.length).toBe(2);
    const assistantMsg = JSON.parse(lines[1]);
    expect(assistantMsg).toMatchObject({
      role: "assistant",
      cancelled: true,
      content: "Generation interrupted before any output.",
    });
    expect(assistantMsg.errorDetail).toContain("exit code 1");
    expect(assistantMsg.errorDetail).toContain("stderr: permission denied");
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

  it("getMessages() skips corrupted JSONL lines", async () => {
    const fs = await import("node:fs/promises");
    const sessionId = "corrupt-line-test";
    const session = createSession({ sessionId });

    // Write a valid message
    session.sendMessage("Hello");
    mockProc._stdout.push(assistantLine("World"));
    mockProc._stdout.push(resultLine());
    mockProc._emitClose(0);
    await new Promise((r) => setTimeout(r, 100));

    // Manually inject a corrupted line into the JSONL file
    const messagesPath = join(tempDir, "sessions", sessionId, "messages.jsonl");
    await fs.appendFile(messagesPath, "THIS IS NOT JSON\n", "utf-8");

    // Write another valid message via a fresh session
    const session2 = await ConversationSession.load({
      cwd: "/tmp/test",
      dataDir: tempDir,
      workspaceId: "ws-test",
      sessionId,
    });
    const messages = await session2.getMessages();
    // Should have the 2 valid messages, skipping the corrupted line
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("user");
    expect(messages[1].role).toBe("assistant");
  });

  it("appendMessage recovers from interrupted write (missing trailing newline)", async () => {
    const fs = await import("node:fs/promises");
    const sessionId = "interrupted-write-test";
    const session = createSession({ sessionId });

    // Write a first message normally
    session.sendMessage("First");
    mockProc._stdout.push(assistantLine("Reply"));
    mockProc._stdout.push(resultLine());
    mockProc._emitClose(0);
    await new Promise((r) => setTimeout(r, 100));

    // Simulate an interrupted write: append truncated JSON without trailing newline
    const messagesPath = join(tempDir, "sessions", sessionId, "messages.jsonl");
    await fs.appendFile(messagesPath, '{"id":"broken","role":"assistant","content":"trunc', "utf-8");

    // Load a fresh session and send a new message — it should not be concatenated
    mockProc = createMockProcess();
    mockSpawn.mockReturnValue(mockProc);
    const session2 = await ConversationSession.load({
      cwd: "/tmp/test",
      dataDir: tempDir,
      workspaceId: "ws-test",
      sessionId,
    });
    session2.sendMessage("Second");
    mockProc._stdout.push(assistantLine("Reply2"));
    mockProc._stdout.push(resultLine());
    mockProc._emitClose(0);
    await new Promise((r) => setTimeout(r, 100));

    const messages = await session2.getMessages();
    // 2 from first turn + corrupted line skipped + 2 from second turn = 4
    expect(messages).toHaveLength(4);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toBe("First");
    expect(messages[2].role).toBe("user");
    expect(messages[2].content).toBe("Second");
    expect(messages[3].role).toBe("assistant");
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
      "Plan approved. Proceed with implementation.",
      { planMode: false },
      undefined,
      expect.stringContaining("ExitPlanMode (unknown)"),
    );
    expect(sendSpy).toHaveBeenNthCalledWith(2, "Not this option");
    expect(sendSpy).toHaveBeenNthCalledWith(
      3,
      "I reject this. Please suggest an alternative approach.",
    );
  });

  it("includes the last blocking tool id when approving ExitPlanMode", () => {
    const session = createSession({ sessionId: "respond-approve-tool-id" });

    session.sendMessage("Plan this");
    mockProc._stdout.push(
      assistantToolUseLine({ id: "toolu_plan_42", name: "ExitPlanMode", input: { planFile: "plan.md" } }),
    );

    const sendSpy = vi.spyOn(session, "sendMessage").mockImplementation(() => {});
    session.respondToToolInput("ExitPlanMode", { type: "approve" });

    expect(sendSpy).toHaveBeenCalledWith(
      "Plan approved. Proceed with implementation.",
      { planMode: false },
      undefined,
      expect.stringContaining("ExitPlanMode (toolu_plan_42)"),
    );
  });

  it("sends 'Question dismissed.' for AskUserQuestion reject with [question_dismissed] marker", () => {
    const session = createSession({ sessionId: "ask-dismiss" });
    const sendSpy = vi.spyOn(session, "sendMessage").mockImplementation(() => {});

    session.respondToToolInput("AskUserQuestion", { type: "reject", message: "[question_dismissed]" });

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy).toHaveBeenCalledWith("Question dismissed.");
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

  it("emits plan_mode_changed for EnterPlanMode and ExitPlanMode tool use blocks", async () => {
    const session = createSession({ sessionId: "plan-mode-events" });
    const messages: WsOutgoing[] = [];
    session.on("message", (msg) => messages.push(msg));

    session.sendMessage("Plan this");
    mockProc._stdout.push(
      assistantToolUseLine({ id: "toolu_enter", name: "EnterPlanMode", input: {} }),
    );
    mockProc._stdout.push(
      assistantToolUseLine({ id: "toolu_exit", name: "ExitPlanMode", input: { plan: "Step 1" } }),
    );

    mockProc._emitClose(137);
    await new Promise((r) => setTimeout(r, 50));

    const planModeEvents = messages.filter((m) => m.type === "plan_mode_changed");
    expect(planModeEvents).toMatchObject([
      { type: "plan_mode_changed", sessionId: "plan-mode-events", active: true },
      { type: "plan_mode_changed", sessionId: "plan-mode-events", active: false },
    ]);
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

  it("drain waits for a streaming turn to exit before resolving", async () => {
    const session = createSession({ sessionId: "drain-waits" });
    session.sendMessage("Hello");

    let resolved = false;
    const drainPromise = session.drain().then(() => {
      resolved = true;
    });

    await Promise.resolve();
    expect(resolved).toBe(false);

    mockProc._stdout.push(assistantLine("Done"));
    mockProc._stdout.push(resultLine());
    mockProc._emitClose(0);

    await drainPromise;
    expect(resolved).toBe(true);
    expect(session.status).toBe("idle");
  });

  // ── Provider locking tests ───────────────────────────────────────

  it("locks provider on first sendMessage based on model prefix", () => {
    const session = createSession({ sessionId: "lock-test" });

    session.sendMessage("Hello", { model: "codex:gpt-5.3-codex" });
    expect(session.metadata.lockedProvider).toBe("codex");
  });

  it("defaults to claude provider when model has no prefix", () => {
    const session = createSession({ sessionId: "lock-default" });

    session.sendMessage("Hello", { model: "opus-4-7" });
    expect(session.metadata.lockedProvider).toBe("claude");
  });

  it("defaults to claude provider when no model specified", () => {
    const session = createSession({ sessionId: "lock-no-model" });

    session.sendMessage("Hello");
    expect(session.metadata.lockedProvider).toBe("claude");
  });

  it("resolves provider once per sendMessage call", () => {
    const resolveSpy = vi.spyOn(providerRegistry, "resolveProvider");
    const session = createSession({ sessionId: "resolve-once" });

    session.sendMessage("Hello", { model: "claude:opus-4-7" });

    expect(resolveSpy).toHaveBeenCalledTimes(1);
    expect(resolveSpy).toHaveBeenCalledWith("claude:opus-4-7");
  });

  it("throws when trying to switch providers mid-session", () => {
    const session = createSession({ sessionId: "lock-switch" });

    session.sendMessage("First", { model: "claude:opus-4-7" });

    mockProc._stdout.push(assistantLine("OK"));
    mockProc._stdout.push(resultLine());
    mockProc._emitClose(0);

    const mockProc2 = createMockProcess();
    mockSpawn.mockReturnValue(mockProc2);

    expect(() => session.sendMessage("Second", { model: "codex:gpt-5.3-codex" }))
      .toThrow('Provider mismatch: session locked to "claude"');
  });

  it("allows same provider on subsequent messages", () => {
    const session = createSession({ sessionId: "lock-same" });

    session.sendMessage("First", { model: "claude:opus-4-7" });

    mockProc._stdout.push(assistantLine("OK"));
    mockProc._stdout.push(resultLine());
    mockProc._emitClose(0);

    const mockProc2 = createMockProcess();
    mockSpawn.mockReturnValue(mockProc2);

    expect(() => session.sendMessage("Second", { model: "claude:sonnet-4-6" }))
      .not.toThrow();
  });

  it("skips provider locking in test mode (command=bash)", () => {
    const session = createSession({ sessionId: "lock-test-mode", command: "bash" });

    session.sendMessage("First", { model: "codex:gpt-5.3-codex" });
    expect(session.metadata.lockedProvider).toBeUndefined();
  });

  it("persists lockedProvider in metadata.json", async () => {
    const session = createSession({ sessionId: "lock-persist" });

    session.sendMessage("Hello", { model: "claude:opus-4-7" });
    mockProc._stdout.push(assistantLine("OK"));
    mockProc._stdout.push(resultLine());
    mockProc._emitClose(0);

    await new Promise((r) => setTimeout(r, 100));

    const metaPath = join(tempDir, "sessions", "lock-persist", "metadata.json");
    const raw = await readFile(metaPath, "utf-8");
    const meta = JSON.parse(raw);
    expect(meta.lockedProvider).toBe("claude");
  });

  // ── ExitPlanMode dismiss and reject responses ──────────────────────

  it("respondToToolInput ExitPlanMode dismiss persists a user message", async () => {
    const session = createSession({ sessionId: "plan-dismiss" });

    session.sendMessage("Plan this");
    mockProc._stdout.push(assistantLine("Planning"));
    mockProc._emitClose(0);
    await new Promise((r) => setTimeout(r, 100));

    session.respondToToolInput("ExitPlanMode", { type: "dismiss", message: "OK got it" });
    await new Promise((r) => setTimeout(r, 100));

    const messagesPath = join(tempDir, "sessions", "plan-dismiss", "messages.jsonl");
    const raw = await readFile(messagesPath, "utf-8");
    const lines = raw.split("\n").filter(Boolean);
    const dismissMsg = JSON.parse(lines[lines.length - 1]);
    expect(dismissMsg.role).toBe("user");
    expect(dismissMsg.content).toBe("OK got it");
  });

  it("respondToToolInput ExitPlanMode reject sends message with planMode", () => {
    const session = createSession({ sessionId: "plan-reject" });
    const sendSpy = vi.spyOn(session, "sendMessage").mockImplementation(() => {});

    session.respondToToolInput("ExitPlanMode", { type: "reject", message: "Change approach" });

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy).toHaveBeenCalledWith(
      "Change approach",
      { planMode: true },
      undefined,
      expect.stringContaining("IMPORTANT: You are still in plan mode"),
    );
  });

  it("respondToToolInput with AskUserQuestion answer preserves planMode from last message", () => {
    const session = createSession({ sessionId: "ask-plan" });
    const sendSpy = vi.spyOn(session, "sendMessage").mockImplementation(() => {});

    // Simulate that the last message was sent with planMode
    // The _lastPlanMode is set in sendMessage, but since we mock it after, we need to call it first
    // Actually, let's test the real flow
    sendSpy.mockRestore();

    session.sendMessage("Question", { planMode: true });

    mockProc._stdout.push(assistantLine("I need info"));
    mockProc._stdout.push(resultLine());
    mockProc._emitClose(0);

    const mockProc2 = createMockProcess();
    mockSpawn.mockReturnValue(mockProc2);

    const sendSpy2 = vi.spyOn(session, "sendMessage").mockImplementation(() => {});

    session.respondToToolInput("AskUserQuestion", {
      type: "answer",
      answers: [{ questionIndex: 0, selectedOptions: [0] }],
    });

    // Should carry forward planMode
    expect(sendSpy2).toHaveBeenCalledWith(
      expect.any(String),
      { planMode: true },
    );
  });

  // ── Token usage capture & forwarding ──────────────────────────────────

  it("captures inputTokens/outputTokens from assistant usage and includes them in done event", async () => {
    const session = createSession({ sessionId: "tok-done" });
    const messages: WsOutgoing[] = [];
    session.on("message", (msg) => messages.push(msg));

    session.sendMessage("Hi");
    mockProc._stdout.push(
      JSON.stringify({
        type: "assistant",
        message: {
          id: "msg-tok",
          role: "assistant",
          content: [{ type: "text", text: "Hello" }],
          usage: { input_tokens: 1500, output_tokens: 200 },
        },
      }) + "\n",
    );
    mockProc._stdout.push(resultLine("sess-123"));
    mockProc._emitClose(0);

    await new Promise((r) => setTimeout(r, 100));

    const doneMsgs = messages.filter((m) => m.type === "done");
    expect(doneMsgs).toHaveLength(1);
    expect(doneMsgs[0]).toMatchObject({
      type: "done",
      sessionId: "tok-done",
      inputTokens: 1500,
      outputTokens: 200,
    });
  });

  it("includes cache tokens in inputTokens total", async () => {
    const session = createSession({ sessionId: "tok-cache" });
    const messages: WsOutgoing[] = [];
    session.on("message", (msg) => messages.push(msg));

    session.sendMessage("Hi");
    mockProc._stdout.push(
      JSON.stringify({
        type: "assistant",
        message: {
          id: "msg-cache",
          role: "assistant",
          content: [{ type: "text", text: "Hello" }],
          usage: {
            input_tokens: 1000,
            output_tokens: 100,
            cache_creation_input_tokens: 500,
            cache_read_input_tokens: 300,
          },
        },
      }) + "\n",
    );
    mockProc._stdout.push(resultLine());
    mockProc._emitClose(0);

    await new Promise((r) => setTimeout(r, 100));

    const doneMsgs = messages.filter((m) => m.type === "done");
    expect(doneMsgs[0]).toMatchObject({
      inputTokens: 1800, // 1000 + 500 + 300
      outputTokens: 100,
    });
  });

  it("captures token usage from result event when assistant has no usage", async () => {
    const session = createSession({ sessionId: "tok-result" });
    const messages: WsOutgoing[] = [];
    session.on("message", (msg) => messages.push(msg));

    session.sendMessage("Hi");
    mockProc._stdout.push(assistantLine("Reply"));
    mockProc._stdout.push(
      JSON.stringify({
        type: "result",
        session_id: "s1",
        duration_ms: 500,
        usage: { input_tokens: 2000, output_tokens: 150 },
      }) + "\n",
    );
    mockProc._emitClose(0);

    await new Promise((r) => setTimeout(r, 100));

    const doneMsgs = messages.filter((m) => m.type === "done");
    expect(doneMsgs[0]).toMatchObject({
      inputTokens: 2000,
      outputTokens: 150,
      durationMs: 500,
    });
  });

  it("result event does NOT override assistant usage (assistant takes priority)", async () => {
    const session = createSession({ sessionId: "tok-override" });
    const messages: WsOutgoing[] = [];
    session.on("message", (msg) => messages.push(msg));

    session.sendMessage("Hi");
    // Assistant event with usage (actual context-window usage for last sub-call)
    mockProc._stdout.push(
      JSON.stringify({
        type: "assistant",
        message: {
          id: "msg-ov",
          role: "assistant",
          content: [{ type: "text", text: "Hello" }],
          usage: { input_tokens: 1000, output_tokens: 50 },
        },
      }) + "\n",
    );
    // Result event with higher (cumulative) usage — should be ignored
    mockProc._stdout.push(
      JSON.stringify({
        type: "result",
        session_id: "s1",
        usage: { input_tokens: 3000, output_tokens: 250 },
      }) + "\n",
    );
    mockProc._emitClose(0);

    await new Promise((r) => setTimeout(r, 100));

    const doneMsgs = messages.filter((m) => m.type === "done");
    expect(doneMsgs[0]).toMatchObject({
      inputTokens: 1000,
      outputTokens: 50,
    });
  });

  it("result event usage is used as fallback when assistant has cache tokens but result has different values", async () => {
    const session = createSession({ sessionId: "tok-cache-priority" });
    const messages: WsOutgoing[] = [];
    session.on("message", (msg) => messages.push(msg));

    session.sendMessage("Hi");
    // Assistant event with cache tokens — sets resultInputTokens to a defined value
    mockProc._stdout.push(
      JSON.stringify({
        type: "assistant",
        message: {
          id: "msg-cp",
          role: "assistant",
          content: [{ type: "text", text: "Hello" }],
          usage: {
            input_tokens: 500,
            output_tokens: 80,
            cache_creation_input_tokens: 200,
            cache_read_input_tokens: 100,
          },
        },
      }) + "\n",
    );
    // Result event with larger cumulative values — should be ignored
    mockProc._stdout.push(
      JSON.stringify({
        type: "result",
        session_id: "s1",
        usage: { input_tokens: 5000, output_tokens: 400 },
      }) + "\n",
    );
    mockProc._emitClose(0);

    await new Promise((r) => setTimeout(r, 100));

    const doneMsgs = messages.filter((m) => m.type === "done");
    expect(doneMsgs[0]).toMatchObject({
      inputTokens: 800, // 500 + 200 + 100 from assistant event
      outputTokens: 80,
    });
  });

  it("multiple assistant events: last assistant usage wins (tool use cycles)", async () => {
    const session = createSession({ sessionId: "tok-multi-assistant" });
    const messages: WsOutgoing[] = [];
    session.on("message", (msg) => messages.push(msg));

    session.sendMessage("Hi");

    // First assistant event — initial sub-call
    mockProc._stdout.push(
      JSON.stringify({
        type: "assistant",
        message: {
          id: "msg-1",
          role: "assistant",
          content: [{ type: "tool_use", id: "tu1", name: "Read", input: { path: "/tmp" } }],
          usage: { input_tokens: 120_000, output_tokens: 100 },
        },
      }) + "\n",
    );

    // Tool result
    mockProc._stdout.push(
      JSON.stringify({
        type: "user",
        message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu1", content: "file content" }] },
      }) + "\n",
    );

    // Second assistant event — larger context after tool result
    mockProc._stdout.push(
      JSON.stringify({
        type: "assistant",
        message: {
          id: "msg-2",
          role: "assistant",
          content: [{ type: "text", text: "Here's the file" }],
          usage: { input_tokens: 140_000, output_tokens: 200 },
        },
      }) + "\n",
    );

    // Result event with cumulative total — should be ignored since assistant had usage
    mockProc._stdout.push(
      JSON.stringify({
        type: "result",
        session_id: "s1",
        usage: { input_tokens: 260_000, output_tokens: 300 },
      }) + "\n",
    );
    mockProc._emitClose(0);

    await new Promise((r) => setTimeout(r, 100));

    const doneMsgs = messages.filter((m) => m.type === "done");
    // Should use the LAST assistant event (140K), not the cumulative result (260K)
    expect(doneMsgs[0]).toMatchObject({
      inputTokens: 140_000,
      outputTokens: 200,
    });
  });

  it("three tool call cycles: reports last sub-call context, not cumulative total", async () => {
    const session = createSession({ sessionId: "tok-3-cycles" });
    const messages: WsOutgoing[] = [];
    session.on("message", (msg) => messages.push(msg));

    session.sendMessage("Hi");

    // Cycle 1: 120K tokens
    mockProc._stdout.push(
      JSON.stringify({
        type: "assistant",
        message: {
          id: "msg-c1",
          role: "assistant",
          content: [{ type: "tool_use", id: "tu1", name: "Read", input: {} }],
          usage: { input_tokens: 120_000, output_tokens: 50 },
        },
      }) + "\n",
    );
    mockProc._stdout.push(userLine([{ tool_use_id: "tu1", content: "data" }]));

    // Cycle 2: 140K tokens (context grew)
    mockProc._stdout.push(
      JSON.stringify({
        type: "assistant",
        message: {
          id: "msg-c2",
          role: "assistant",
          content: [{ type: "tool_use", id: "tu2", name: "Grep", input: {} }],
          usage: { input_tokens: 140_000, output_tokens: 80 },
        },
      }) + "\n",
    );
    mockProc._stdout.push(userLine([{ tool_use_id: "tu2", content: "matches" }]));

    // Cycle 3: 174K tokens (context grew more)
    mockProc._stdout.push(
      JSON.stringify({
        type: "assistant",
        message: {
          id: "msg-c3",
          role: "assistant",
          content: [{ type: "text", text: "Done" }],
          usage: { input_tokens: 174_000, output_tokens: 120 },
        },
      }) + "\n",
    );

    // Result event: cumulative total across all cycles (434K)
    mockProc._stdout.push(
      JSON.stringify({
        type: "result",
        session_id: "s1",
        usage: { input_tokens: 434_000, output_tokens: 250 },
      }) + "\n",
    );
    mockProc._emitClose(0);

    await new Promise((r) => setTimeout(r, 100));

    const doneMsgs = messages.filter((m) => m.type === "done");
    // Must show the last sub-call (174K), NOT the cumulative 434K
    expect(doneMsgs[0]).toMatchObject({
      inputTokens: 174_000,
      outputTokens: 120,
    });
  });

  it("assistant usage with zero input_tokens still counts as defined (blocks result fallback)", async () => {
    const session = createSession({ sessionId: "tok-zero" });
    const messages: WsOutgoing[] = [];
    session.on("message", (msg) => messages.push(msg));

    session.sendMessage("Hi");
    mockProc._stdout.push(
      JSON.stringify({
        type: "assistant",
        message: {
          id: "msg-z",
          role: "assistant",
          content: [{ type: "text", text: "Hi" }],
          usage: { input_tokens: 0, output_tokens: 10 },
        },
      }) + "\n",
    );
    mockProc._stdout.push(
      JSON.stringify({
        type: "result",
        session_id: "s1",
        usage: { input_tokens: 5000, output_tokens: 300 },
      }) + "\n",
    );
    mockProc._emitClose(0);

    await new Promise((r) => setTimeout(r, 100));

    const doneMsgs = messages.filter((m) => m.type === "done");
    // 0 is a defined value — result should NOT override
    expect(doneMsgs[0]).toMatchObject({
      inputTokens: 0,
      outputTokens: 10,
    });
  });

  it("result event cache tokens are aggregated correctly when used as fallback", async () => {
    const session = createSession({ sessionId: "tok-result-cache" });
    const messages: WsOutgoing[] = [];
    session.on("message", (msg) => messages.push(msg));

    session.sendMessage("Hi");
    // Assistant line with NO usage
    mockProc._stdout.push(assistantLine("Reply"));
    mockProc._stdout.push(
      JSON.stringify({
        type: "result",
        session_id: "s1",
        usage: {
          input_tokens: 800,
          output_tokens: 60,
          cache_creation_input_tokens: 400,
          cache_read_input_tokens: 200,
        },
      }) + "\n",
    );
    mockProc._emitClose(0);

    await new Promise((r) => setTimeout(r, 100));

    const doneMsgs = messages.filter((m) => m.type === "done");
    expect(doneMsgs[0]).toMatchObject({
      inputTokens: 1400, // 800 + 400 + 200
      outputTokens: 60,
    });
  });

  it("result duration is always captured regardless of token priority", async () => {
    const session = createSession({ sessionId: "tok-duration" });
    const messages: WsOutgoing[] = [];
    session.on("message", (msg) => messages.push(msg));

    session.sendMessage("Hi");
    mockProc._stdout.push(
      JSON.stringify({
        type: "assistant",
        message: {
          id: "msg-d",
          role: "assistant",
          content: [{ type: "text", text: "Reply" }],
          usage: { input_tokens: 5000, output_tokens: 100 },
        },
      }) + "\n",
    );
    // Result event: tokens should be ignored, but duration should be captured
    mockProc._stdout.push(
      JSON.stringify({
        type: "result",
        session_id: "s1",
        duration_ms: 3500,
        usage: { input_tokens: 9000, output_tokens: 500 },
      }) + "\n",
    );
    mockProc._emitClose(0);

    await new Promise((r) => setTimeout(r, 100));

    const doneMsgs = messages.filter((m) => m.type === "done");
    expect(doneMsgs[0]).toMatchObject({
      inputTokens: 5000, // from assistant, not result
      outputTokens: 100,
      durationMs: 3500, // from result — always captured
    });
  });

  it("persists correct tokens in messages.jsonl when result has higher values", async () => {
    const session = createSession({ sessionId: "tok-persist-priority" });

    session.sendMessage("Hi");
    mockProc._stdout.push(
      JSON.stringify({
        type: "assistant",
        message: {
          id: "msg-pp",
          role: "assistant",
          content: [{ type: "text", text: "Hi back" }],
          usage: { input_tokens: 80_000, output_tokens: 400 },
        },
      }) + "\n",
    );
    mockProc._stdout.push(
      JSON.stringify({
        type: "result",
        session_id: "s1",
        usage: { input_tokens: 250_000, output_tokens: 1200 },
      }) + "\n",
    );
    mockProc._emitClose(0);

    await new Promise((r) => setTimeout(r, 100));

    const messagesPath = join(tempDir, "sessions", "tok-persist-priority", "messages.jsonl");
    const raw = await readFile(messagesPath, "utf-8");
    const lines = raw.split("\n").filter(Boolean);
    const assistantMsg = JSON.parse(lines[1]);
    // Persisted value should be from assistant event (80K), not result (250K)
    expect(assistantMsg.inputTokens).toBe(80_000);
    expect(assistantMsg.outputTokens).toBe(400);
  });

  it("persists inputTokens/outputTokens in assistant message", async () => {
    const session = createSession({ sessionId: "tok-persist" });

    session.sendMessage("Hi");
    mockProc._stdout.push(
      JSON.stringify({
        type: "assistant",
        message: {
          id: "msg-tp",
          role: "assistant",
          content: [{ type: "text", text: "Hi back" }],
          usage: { input_tokens: 5000, output_tokens: 400 },
        },
      }) + "\n",
    );
    mockProc._stdout.push(resultLine());
    mockProc._emitClose(0);

    await new Promise((r) => setTimeout(r, 100));

    const messagesPath = join(tempDir, "sessions", "tok-persist", "messages.jsonl");
    const raw = await readFile(messagesPath, "utf-8");
    const lines = raw.split("\n").filter(Boolean);
    expect(lines.length).toBe(2);

    const assistantMsg = JSON.parse(lines[1]);
    expect(assistantMsg.inputTokens).toBe(5000);
    expect(assistantMsg.outputTokens).toBe(400);
  });

  it("done event has no token fields when no usage data is available", async () => {
    const session = createSession({ sessionId: "tok-none" });
    const messages: WsOutgoing[] = [];
    session.on("message", (msg) => messages.push(msg));

    session.sendMessage("Hi");
    mockProc._stdout.push(assistantLine("Reply"));
    mockProc._stdout.push(resultLine());
    mockProc._emitClose(0);

    await new Promise((r) => setTimeout(r, 100));

    const doneMsgs = messages.filter((m) => m.type === "done");
    expect(doneMsgs).toHaveLength(1);
    if (doneMsgs[0].type === "done") {
      expect(doneMsgs[0].inputTokens).toBeUndefined();
      expect(doneMsgs[0].outputTokens).toBeUndefined();
    }
  });
});
