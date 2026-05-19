import { EventEmitter } from "node:events";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

import { spawn } from "node:child_process";
import { CodexAppServerSession } from "./codex-app-server.js";

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
  const proc = new EventEmitter() as ChildProcessWithoutNullStreams & {
    _stdout: ReturnType<typeof createMockStream>;
    _stderr: ReturnType<typeof createMockStream>;
    _stdinWrite: ReturnType<typeof vi.fn>;
    kill: ReturnType<typeof vi.fn>;
  };
  proc._stdout = createMockStream();
  proc._stderr = createMockStream();
  proc.stdout = proc._stdout as unknown as ChildProcessWithoutNullStreams["stdout"];
  proc.stderr = proc._stderr as unknown as ChildProcessWithoutNullStreams["stderr"];
  proc._stdinWrite = vi.fn();
  proc.stdin = {
    write: proc._stdinWrite,
    writable: true,
  } as unknown as ChildProcessWithoutNullStreams["stdin"];
  proc.kill = vi.fn(() => true);
  return proc;
}

function parseWrites(proc: ReturnType<typeof createMockProcess>): Array<Record<string, unknown>> {
  return proc._stdinWrite.mock.calls.flatMap((call) => {
    const raw = String(call[0]).trim();
    if (!raw) return [];
    try {
      return [JSON.parse(raw) as Record<string, unknown>];
    } catch {
      return [];
    }
  });
}

async function waitForMethod(proc: ReturnType<typeof createMockProcess>, method: string): Promise<{ id: number }> {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    for (const write of parseWrites(proc)) {
      if (write.method === method && typeof write.id === "number") {
        return { id: write.id };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${method}`);
}

async function waitForResponse(proc: ReturnType<typeof createMockProcess>, id: number): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    const response = parseWrites(proc).find((write) => write.id === id && !write.method);
    if (response) return response;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for response ${id}`);
}

function appServerResponse(id: number, result: unknown): string {
  return JSON.stringify({ id, result }) + "\n";
}

function appServerRequest(id: number, method: string, params: unknown = {}): string {
  return JSON.stringify({ id, method, params }) + "\n";
}

async function initializeSession(session: CodexAppServerSession, proc: ReturnType<typeof createMockProcess>): Promise<void> {
  const started = session.startTurn({
    cwd: "/tmp/project",
    content: "hello",
    model: "gpt-5.5",
  });

  const initialize = await waitForMethod(proc, "initialize");
  proc._stdout.push(appServerResponse(initialize.id, {
    userAgent: "codex-test",
    codexHome: "/tmp/codex",
    platformFamily: "unix",
    platformOs: "linux",
  }));

  const threadStart = await waitForMethod(proc, "thread/start");
  proc._stdout.push(appServerResponse(threadStart.id, { thread: { id: "thread-1" } }));

  const turnStart = await waitForMethod(proc, "turn/start");
  proc._stdout.push(appServerResponse(turnStart.id, { turn: { id: "turn-1" } }));
  await started;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CodexAppServerSession request handling", () => {
  it("auto-accepts known command and file approval requests", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const session = new CodexAppServerSession();
    await initializeSession(session, proc);

    proc._stdout.push(appServerRequest(100, "item/commandExecution/requestApproval"));
    proc._stdout.push(appServerRequest(101, "item/fileChange/requestApproval"));
    proc._stdout.push(appServerRequest(102, "execCommandApproval"));
    proc._stdout.push(appServerRequest(103, "applyPatchApproval"));

    await expect(waitForResponse(proc, 100)).resolves.toMatchObject({ id: 100, result: { decision: "accept" } });
    await expect(waitForResponse(proc, 101)).resolves.toMatchObject({ id: 101, result: { decision: "accept" } });
    await expect(waitForResponse(proc, 102)).resolves.toMatchObject({ id: 102, result: { decision: "approved" } });
    await expect(waitForResponse(proc, 103)).resolves.toMatchObject({ id: 103, result: { decision: "approved" } });
  });

  it("rejects known unsupported request paths with clear errors", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const session = new CodexAppServerSession();
    const events: unknown[] = [];
    session.on("agent_event", (event) => events.push(event));
    await initializeSession(session, proc);

    const unsupported = [
      "item/permissions/requestApproval",
      "item/tool/requestUserInput",
      "mcpServer/elicitation/request",
      "item/tool/call",
    ];

    for (const [index, method] of unsupported.entries()) {
      proc._stdout.push(appServerRequest(200 + index, method));
      const response = await waitForResponse(proc, 200 + index);
      expect(response).toMatchObject({
        id: 200 + index,
        error: expect.objectContaining({
          message: expect.stringContaining("not supported by Hive"),
        }),
      });
    }
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "diagnostic",
          severity: "error",
          title: "Unsupported App Server request",
          method: "item/permissions/requestApproval",
        }),
      ]),
    );
  });

  it("does not auto-accept unknown request types", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const session = new CodexAppServerSession();
    await initializeSession(session, proc);

    proc._stdout.push(appServerRequest(300, "unknown/request"));

    await expect(waitForResponse(proc, 300)).resolves.toMatchObject({
      id: 300,
      error: expect.objectContaining({
        message: "unknown/request is not supported by Hive",
      }),
    });
  });
});

describe("CodexAppServerSession normalized events", () => {
  it("emits diagnostics for unsupported notifications and protocol warnings", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const session = new CodexAppServerSession();
    const events: unknown[] = [];
    session.on("agent_event", (event) => events.push(event));
    await initializeSession(session, proc);

    proc._stdout.push(JSON.stringify({
      method: "warning",
      params: { message: "Codex warning", authToken: "secret-token" },
    }) + "\n");
    proc._stdout.push(JSON.stringify({
      method: "turn/diff/updated",
      params: { changedFiles: 2, apiKey: "secret-key" },
    }) + "\n");

    expect(events).toEqual([
      expect.objectContaining({
        type: "diagnostic",
        severity: "warning",
        title: "Codex warning",
        message: "Codex warning",
        source: "codex_app_server",
        method: "warning",
        details: expect.stringContaining("[redacted]"),
      }),
      expect.objectContaining({
        type: "diagnostic",
        severity: "info",
        title: "Unsupported App Server event",
        message: "Hive does not render \"turn/diff/updated\" yet.",
        source: "codex_app_server",
        method: "turn/diff/updated",
        details: expect.stringContaining("[redacted]"),
      }),
    ]);
  });

  it("keeps protocol error notifications non-terminal and emits diagnostics", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const session = new CodexAppServerSession();
    const events: unknown[] = [];
    const errors: Error[] = [];
    session.on("agent_event", (event) => events.push(event));
    session.on("error", (err) => errors.push(err));
    await initializeSession(session, proc);

    proc._stdout.push(JSON.stringify({
      method: "error",
      params: {
        error: {
          message: "Rate limited",
          additionalDetails: "try again later",
        },
        apiKey: "secret-key",
      },
    }) + "\n");

    expect(errors).toEqual([]);
    expect(events).toEqual([
      expect.objectContaining({
        type: "diagnostic",
        severity: "error",
        title: "Codex error",
        message: "Rate limited: try again later",
        source: "codex_app_server",
        method: "error",
        details: expect.stringContaining("[redacted]"),
      }),
    ]);
  });

  it("emits diagnostics for unsupported item types", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const session = new CodexAppServerSession();
    const events: unknown[] = [];
    session.on("agent_event", (event) => events.push(event));
    await initializeSession(session, proc);

    proc._stdout.push(JSON.stringify({
      method: "item/started",
      params: {
        item: {
          type: "imageView",
          id: "image-1",
          path: "/tmp/screenshot.png",
        },
      },
    }) + "\n");

    expect(events).toEqual([
      expect.objectContaining({
        type: "diagnostic",
        severity: "info",
        title: "Unsupported App Server item",
        message: "Hive does not render Codex item type \"imageView\" yet.",
        source: "codex_app_server",
        method: "item/imageView",
      }),
    ]);
  });

  it("renders collab agent tool calls through the existing Agent tool UI path", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const session = new CodexAppServerSession();
    const assistantEvents: unknown[] = [];
    const userEvents: unknown[] = [];
    const diagnostics: unknown[] = [];
    session.on("assistant", (event) => assistantEvents.push(event));
    session.on("user", (event) => userEvents.push(event));
    session.on("agent_event", (event) => diagnostics.push(event));
    await initializeSession(session, proc);

    proc._stdout.push(JSON.stringify({
      method: "item/started",
      params: {
        item: {
          type: "collabAgentToolCall",
          id: "collab-1",
          tool: "spawnAgent",
          status: "inProgress",
          senderThreadId: "thread-1",
          receiverThreadIds: ["thread-2"],
          prompt: "Inspect the auth flow\nReturn findings only.",
          model: "gpt-5.5",
          reasoningEffort: "medium",
        },
      },
    }) + "\n");
    proc._stdout.push(JSON.stringify({
      method: "item/completed",
      params: {
        item: {
          type: "collabAgentToolCall",
          id: "collab-1",
          tool: "spawnAgent",
          status: "completed",
          senderThreadId: "thread-1",
          receiverThreadIds: ["thread-2"],
          prompt: "Inspect the auth flow\nReturn findings only.",
          agentsStates: {
            "thread-2": { status: "completed", message: "No findings." },
          },
        },
      },
    }) + "\n");

    expect(diagnostics).toEqual([]);
    expect(assistantEvents).toEqual([
      expect.objectContaining({
        type: "assistant",
        message: expect.objectContaining({
          id: "collab-1",
          content: [
            expect.objectContaining({
              type: "tool_use",
              id: "collab-1",
              name: "Agent",
              input: expect.stringContaining("\"subagent_type\":\"Agent\""),
            }),
          ],
        }),
      }),
    ]);
    expect(assistantEvents[0]).toEqual(expect.objectContaining({
      message: expect.objectContaining({
        content: [
          expect.objectContaining({
            input: expect.stringContaining("\"description\":\"Inspect the auth flow\""),
          }),
        ],
      }),
    }));
    expect(userEvents).toEqual([
      expect.objectContaining({
        type: "user",
        message: expect.objectContaining({
          content: [
            expect.objectContaining({
              type: "tool_result",
              tool_use_id: "collab-1",
              content: expect.any(String),
            }),
          ],
        }),
      }),
    ]);
    const output = ((userEvents[0] as {
      message: { content: Array<{ content: string }> };
    }).message.content[0]?.content);
    const outputBlocks = JSON.parse(output) as Array<{ type: string; text: string }>;
    expect(outputBlocks).toEqual([
      expect.objectContaining({
        type: "text",
        text: expect.stringContaining("\"status\": \"completed\""),
      }),
    ]);
  });

  it("emits rich command, file, and plan events while preserving turn completion", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const session = new CodexAppServerSession();
    const events: unknown[] = [];
    session.on("agent_event", (event) => events.push(event));
    await initializeSession(session, proc);

    proc._stdout.push(JSON.stringify({
      method: "item/started",
      params: {
        item: {
          type: "commandExecution",
          id: "cmd-1",
          command: "npm test",
          cwd: "/tmp/project",
          status: "inProgress",
        },
      },
    }) + "\n");
    proc._stdout.push(JSON.stringify({
      method: "item/commandExecution/outputDelta",
      params: { itemId: "cmd-1", delta: "ok\n" },
    }) + "\n");
    proc._stdout.push(JSON.stringify({
      method: "item/fileChange/patchUpdated",
      params: {
        itemId: "file-1",
        changes: [{ path: "src/app.ts", diff: "+hello", kind: { type: "modify" } }],
      },
    }) + "\n");
    proc._stdout.push(JSON.stringify({
      method: "turn/plan/updated",
      params: {
        turnId: "turn-1",
        plan: [{ step: "Run tests", status: "completed" }],
      },
    }) + "\n");

    expect(events).toEqual([
      {
        type: "command_execution_updated",
        id: "cmd-1",
        command: "npm test",
        cwd: "/tmp/project",
        status: "inProgress",
        exitCode: undefined,
        durationMs: undefined,
      },
      {
        type: "command_execution_updated",
        id: "cmd-1",
        outputDelta: "ok\n",
        output: "ok\n",
      },
      {
        type: "file_change_updated",
        id: "file-1",
        path: "src/app.ts",
        diff: "+hello",
        files: [{ path: "src/app.ts", diff: "+hello", kind: "modify", status: undefined }],
        status: "modify",
      },
      {
        type: "plan_updated",
        id: "codex-plan-turn-1",
        steps: [{ text: "Run tests", status: "completed" }],
      },
    ]);
  });
});
