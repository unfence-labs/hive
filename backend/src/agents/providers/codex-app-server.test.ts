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

async function waitForCondition(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for condition");
}

function appServerResponse(id: number, result: unknown): string {
  return JSON.stringify({ id, result }) + "\n";
}

function appServerError(id: number, message: string): string {
  return JSON.stringify({ id, error: { message } }) + "\n";
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
  it("spawns app-server with the goals feature enabled", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const session = new CodexAppServerSession({ enableGoals: true });
    await initializeSession(session, proc);

    expect(mockSpawn).toHaveBeenCalledWith(
      "codex",
      ["app-server", "--enable", "goals", "--listen", "stdio://"],
      expect.objectContaining({ stdio: ["pipe", "pipe", "pipe"] }),
    );
  });

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

  it("emits native turn_started events with thread and turn ids", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const session = new CodexAppServerSession();
    const events: unknown[] = [];
    session.on("turn_started", (event) => events.push(event));
    await initializeSession(session, proc);

    proc._stdout.push(JSON.stringify({
      method: "turn/started",
      params: {
        threadId: "thread-1",
        turn: { id: "turn-2" },
      },
    }) + "\n");

    await waitForCondition(() => events.length === 1);
    expect(events).toEqual([{ threadId: "thread-1", turnId: "turn-2" }]);
    expect(session.capturedThreadId).toBe("thread-1");
    expect(session.capturedTurnId).toBe("turn-2");
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
      method: "unknown/notification",
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
        message: "Hive does not render \"unknown/notification\" yet.",
        source: "codex_app_server",
        method: "unknown/notification",
        details: expect.stringContaining("[redacted]"),
      }),
    ]);
  });

  it("absorbs empty terminal interaction polls but keeps non-empty interactions diagnostic-only", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const session = new CodexAppServerSession();
    const events: unknown[] = [];
    session.on("agent_event", (event) => events.push(event));
    await initializeSession(session, proc);

    proc._stdout.push(JSON.stringify({
      method: "item/commandExecution/terminalInteraction",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "cmd-1",
        processId: "123",
        stdin: "",
      },
    }) + "\n");

    expect(events).toEqual([]);

    proc._stdout.push(JSON.stringify({
      method: "item/commandExecution/terminalInteraction",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "cmd-1",
        processId: "123",
        stdin: "q\n",
      },
    }) + "\n");

    expect(events).toEqual([
      expect.objectContaining({
        type: "diagnostic",
        severity: "info",
        title: "Unsupported App Server event",
        message: "Hive does not render \"item/commandExecution/terminalInteraction\" yet.",
        source: "codex_app_server",
        method: "item/commandExecution/terminalInteraction",
        details: expect.stringContaining("\"stdin\": \"q\\n\""),
      }),
    ]);
  });

  it("ignores known App Server status notifications that do not belong in chat", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const session = new CodexAppServerSession();
    const events: unknown[] = [];
    session.on("agent_event", (event) => events.push(event));
    await initializeSession(session, proc);

    proc._stdout.push(JSON.stringify({
      method: "remoteControl/status/changed",
      params: { status: "connected", serverName: "Codex" },
    }) + "\n");
    proc._stdout.push(JSON.stringify({
      method: "thread/status/changed",
      params: { thread: { id: "thread-1", status: "idle" } },
    }) + "\n");
    proc._stdout.push(JSON.stringify({
      method: "mcpServer/startupStatus/updated",
      params: { serverName: "filesystem", status: "ready" },
    }) + "\n");
    proc._stdout.push(JSON.stringify({
      method: "account/rateLimits/updated",
      params: { primary: { remaining: 0, resetAt: "2026-05-19T00:00:00Z" } },
    }) + "\n");
    proc._stdout.push(JSON.stringify({
      method: "turn/diff/updated",
      params: { threadId: "thread-1", turnId: "turn-1", diff: "diff --git a/app.ts b/app.ts" },
    }) + "\n");
    proc._stdout.push(JSON.stringify({
      method: "thread/settings/updated",
      params: {
        threadId: "thread-1",
        threadSettings: {
          cwd: "/tmp/workspace",
          approvalPolicy: "never",
          sandboxPolicy: { type: "dangerFullAccess" },
          model: "gpt-5.5",
          effort: "high",
        },
      },
    }) + "\n");

    expect(events).toEqual([]);
  });

  it("emits diagnostics for failed App Server status notifications", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const session = new CodexAppServerSession();
    const events: unknown[] = [];
    session.on("agent_event", (event) => events.push(event));
    await initializeSession(session, proc);

    proc._stdout.push(JSON.stringify({
      method: "mcpServer/startupStatus/updated",
      params: {
        serverName: "filesystem",
        startupStatus: { state: "failed" },
        message: "MCP server failed to start",
      },
    }) + "\n");
    proc._stdout.push(JSON.stringify({
      method: "thread/status/changed",
      params: {
        thread: { id: "thread-1", status: "systemError" },
        message: "Thread entered systemError",
      },
    }) + "\n");

    expect(events).toEqual([
      expect.objectContaining({
        type: "diagnostic",
        severity: "warning",
        title: "Codex MCP startup status",
        message: "MCP server failed to start",
        source: "codex_app_server",
        method: "mcpServer/startupStatus/updated",
      }),
      expect.objectContaining({
        type: "diagnostic",
        severity: "error",
        title: "Codex thread status",
        message: "Thread entered systemError",
        source: "codex_app_server",
        method: "thread/status/changed",
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
          type: "mysteryItem",
          id: "mystery-1",
        },
      },
    }) + "\n");

    expect(events).toEqual([
      expect.objectContaining({
        type: "diagnostic",
        severity: "info",
        title: "Unsupported App Server item",
        message: "Hive does not render Codex item type \"mysteryItem\" yet.",
        source: "codex_app_server",
        method: "item/mysteryItem",
      }),
    ]);
  });

  it("emits image view activities with workspace-relative paths", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const session = new CodexAppServerSession();
    const events: unknown[] = [];
    session.on("agent_event", (event) => events.push(event));
    await initializeSession(session, proc);

    proc._stdout.push(JSON.stringify({
      method: "item/completed",
      params: {
        item: {
          type: "imageView",
          id: "image-1",
          path: "/tmp/project/assets/screenshot.png",
        },
      },
    }) + "\n");

    expect(events).toEqual([{
      type: "image_view_updated",
      id: "image-1",
      path: "/tmp/project/assets/screenshot.png",
      relativePath: "assets/screenshot.png",
    }]);
  });

  it("flags image views outside the workspace without a relative path", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const session = new CodexAppServerSession();
    const events: unknown[] = [];
    session.on("agent_event", (event) => events.push(event));
    await initializeSession(session, proc);

    proc._stdout.push(JSON.stringify({
      method: "item/completed",
      params: {
        item: {
          type: "imageView",
          id: "image-1",
          path: "/var/data/elsewhere.png",
        },
      },
    }) + "\n");

    expect(events).toEqual([{
      type: "image_view_updated",
      id: "image-1",
      path: "/var/data/elsewhere.png",
      outsideWorkspace: true,
    }]);
  });

  it("emits image generation progress and completion", async () => {
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
          type: "imageGeneration",
          id: "gen-1",
        },
      },
    }) + "\n");
    proc._stdout.push(JSON.stringify({
      method: "item/completed",
      params: {
        item: {
          type: "imageGeneration",
          id: "gen-1",
          status: "completed",
          revisedPrompt: "A hive logo in watercolor",
          result: "aGVsbG8=",
          savedPath: "/tmp/project/generated/logo.png",
        },
      },
    }) + "\n");

    expect(events).toEqual([
      {
        type: "image_generation_updated",
        id: "gen-1",
        status: "inProgress",
        revisedPrompt: undefined,
        result: undefined,
        savedPath: undefined,
        relativePath: undefined,
      },
      {
        type: "image_generation_updated",
        id: "gen-1",
        status: "completed",
        revisedPrompt: "A hive logo in watercolor",
        result: "aGVsbG8=",
        savedPath: "/tmp/project/generated/logo.png",
        relativePath: "generated/logo.png",
      },
    ]);
  });

  it("drops oversized inline image generation results", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const session = new CodexAppServerSession();
    const events: unknown[] = [];
    session.on("agent_event", (event) => events.push(event));
    await initializeSession(session, proc);

    proc._stdout.push(JSON.stringify({
      method: "item/completed",
      params: {
        item: {
          type: "imageGeneration",
          id: "gen-1",
          status: "completed",
          result: "a".repeat(300_000),
        },
      },
    }) + "\n");

    expect(events).toEqual([
      expect.objectContaining({
        type: "image_generation_updated",
        id: "gen-1",
        status: "completed",
        result: undefined,
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

  it("labels Codex collab wait operations without showing Agent Wait", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const session = new CodexAppServerSession();
    const assistantEvents: unknown[] = [];
    session.on("assistant", (event) => assistantEvents.push(event));
    await initializeSession(session, proc);

    proc._stdout.push(JSON.stringify({
      method: "item/started",
      params: {
        item: {
          type: "collabAgentToolCall",
          id: "collab-wait-1",
          tool: "wait",
          status: "inProgress",
          senderThreadId: "thread-1",
          receiverThreadIds: ["thread-2"],
        },
      },
    }) + "\n");

    expect(assistantEvents).toEqual([
      expect.objectContaining({
        type: "assistant",
        message: expect.objectContaining({
          id: "collab-wait-1",
          content: [
            expect.objectContaining({
              type: "tool_use",
              id: "collab-wait-1",
              name: "Agent",
              input: expect.stringContaining("\"subagent_type\":\"Wait\""),
            }),
          ],
        }),
      }),
    ]);
    expect(assistantEvents[0]).toEqual(expect.objectContaining({
      message: expect.objectContaining({
        content: [
          expect.objectContaining({
            input: expect.stringContaining("\"description\":\"\""),
          }),
        ],
      }),
    }));
  });

  it("parents live receiver-thread tools under Codex collab agent calls", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const session = new CodexAppServerSession();
    const assistantEvents: unknown[] = [];
    const userEvents: unknown[] = [];
    session.on("assistant", (event) => assistantEvents.push(event));
    session.on("user", (event) => userEvents.push(event));
    await initializeSession(session, proc);

    proc._stdout.push(JSON.stringify({
      method: "item/started",
      params: {
        threadId: "thread-1",
        item: {
          type: "collabAgentToolCall",
          id: "collab-1",
          tool: "spawnAgent",
          status: "inProgress",
          receiverThreadIds: ["thread-child"],
          prompt: "Inspect auth",
        },
      },
    }) + "\n");
    proc._stdout.push(JSON.stringify({
      method: "item/started",
      params: {
        threadId: "thread-child",
        item: {
          type: "collabAgentToolCall",
          id: "collab-self",
          tool: "spawnAgent",
          status: "inProgress",
          receiverThreadIds: ["thread-child"],
          prompt: "Inspect auth",
        },
      },
    }) + "\n");
    proc._stdout.push(JSON.stringify({
      method: "item/started",
      params: {
        threadId: "thread-child",
        item: {
          type: "commandExecution",
          id: "child-cmd-1",
          command: "npm test",
          cwd: "/tmp/project",
          status: "inProgress",
        },
      },
    }) + "\n");
    proc._stdout.push(JSON.stringify({
      method: "item/completed",
      params: {
        threadId: "thread-child",
        item: {
          type: "commandExecution",
          id: "child-cmd-1",
          command: "npm test",
          cwd: "/tmp/project",
          status: "completed",
          aggregatedOutput: "ok",
          exitCode: 0,
        },
      },
    }) + "\n");

    expect(assistantEvents).toEqual([
      expect.objectContaining({
        message: expect.objectContaining({
          content: [
            expect.objectContaining({ type: "tool_use", id: "collab-1", name: "Agent" }),
          ],
        }),
      }),
      expect.objectContaining({
        message: expect.objectContaining({
          content: [
            expect.objectContaining({
              type: "tool_use",
              id: "child-cmd-1",
              name: "Bash",
              parentToolUseId: "collab-1",
            }),
          ],
        }),
      }),
    ]);
    expect(userEvents).toEqual([
      expect.objectContaining({
        message: expect.objectContaining({
          content: [
            expect.objectContaining({
              type: "tool_result",
              tool_use_id: "child-cmd-1",
              content: "ok",
            }),
          ],
        }),
      }),
    ]);
  });

  it("preserves collab parent mapping across a turn boundary (goal continuation)", async () => {
    // With goals, a single prompt spans several autonomous turns. A sub-agent
    // spawned in one turn can emit live items in a later turn; the per-turn reset
    // on turn/started must NOT wipe the collab parent map or those child tool
    // calls would render top-level instead of nested under their Agent call.
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const session = new CodexAppServerSession();
    const assistantEvents: unknown[] = [];
    session.on("assistant", (event) => assistantEvents.push(event));
    await initializeSession(session, proc);

    // Turn 1: the collab sub-agent is spawned, mapping thread-child -> collab-1.
    proc._stdout.push(JSON.stringify({
      method: "turn/started",
      params: { threadId: "thread-1", turn: { id: "turn-1" } },
    }) + "\n");
    proc._stdout.push(JSON.stringify({
      method: "item/started",
      params: {
        threadId: "thread-1",
        item: {
          type: "collabAgentToolCall",
          id: "collab-1",
          tool: "spawnAgent",
          status: "inProgress",
          receiverThreadIds: ["thread-child"],
          prompt: "Inspect auth",
        },
      },
    }) + "\n");

    // Turn 2 begins (new turnId) — this triggers the per-turn reset.
    proc._stdout.push(JSON.stringify({
      method: "turn/started",
      params: { threadId: "thread-1", turn: { id: "turn-2" } },
    }) + "\n");

    // The sub-agent thread emits a live command in the NEW turn.
    proc._stdout.push(JSON.stringify({
      method: "item/started",
      params: {
        threadId: "thread-child",
        item: {
          type: "commandExecution",
          id: "child-cmd-late",
          command: "npm test",
          cwd: "/tmp/project",
          status: "inProgress",
        },
      },
    }) + "\n");

    await waitForCondition(() =>
      assistantEvents.some((event) =>
        (event as { message?: { content?: Array<{ id?: string }> } }).message?.content?.some(
          (block) => block.id === "child-cmd-late",
        ),
      ),
    );

    const lateChild = assistantEvents
      .flatMap((event) => (event as { message?: { content?: Array<Record<string, unknown>> } }).message?.content ?? [])
      .find((block) => block.id === "child-cmd-late");
    expect(lateChild).toEqual(
      expect.objectContaining({ id: "child-cmd-late", name: "Bash", parentToolUseId: "collab-1" }),
    );
  });

  it("emits Codex commandActions on command execution activity events", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const session = new CodexAppServerSession();
    const events: unknown[] = [];
    session.on("agent_event", (event) => events.push(event));
    await initializeSession(session, proc);

    proc._stdout.push(JSON.stringify({
      method: "item/started",
      params: {
        threadId: "thread-1",
        item: {
          type: "commandExecution",
          id: "cmd-read-1",
          command: "sed -n '1,40p' package.json",
          cwd: "/tmp/project",
          status: "inProgress",
          commandActions: [{
            type: "read",
            command: "sed -n '1,40p' package.json",
            name: "sed",
            path: "/tmp/project/package.json",
          }],
        },
      },
    }) + "\n");
    proc._stdout.push(JSON.stringify({
      method: "item/completed",
      params: {
        threadId: "thread-1",
        item: {
          type: "commandExecution",
          id: "cmd-read-1",
          command: "sed -n '1,40p' package.json",
          cwd: "/tmp/project",
          status: "completed",
          aggregatedOutput: "{ \"name\": \"demo\" }\n",
          exitCode: 0,
          commandActions: [{
            type: "read",
            command: "sed -n '1,40p' package.json",
            name: "sed",
            path: "/tmp/project/package.json",
          }],
        },
      },
    }) + "\n");

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "command_execution_updated",
        id: "cmd-read-1",
        status: "inProgress",
        commandActions: [{
          type: "read",
          command: "sed -n '1,40p' package.json",
          name: "sed",
          path: "/tmp/project/package.json",
        }],
      }),
      expect.objectContaining({
        type: "command_execution_updated",
        id: "cmd-read-1",
        output: "{ \"name\": \"demo\" }\n",
        commandActions: [{
          type: "read",
          command: "sed -n '1,40p' package.json",
          name: "sed",
          path: "/tmp/project/package.json",
        }],
      }),
    ]));
  });

  it("renders child read commandActions as nested Read tools", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const session = new CodexAppServerSession();
    const assistantEvents: unknown[] = [];
    const userEvents: unknown[] = [];
    session.on("assistant", (event) => assistantEvents.push(event));
    session.on("user", (event) => userEvents.push(event));
    await initializeSession(session, proc);

    proc._stdout.push(JSON.stringify({
      method: "item/started",
      params: {
        threadId: "thread-1",
        item: {
          type: "collabAgentToolCall",
          id: "collab-1",
          tool: "spawnAgent",
          status: "inProgress",
          receiverThreadIds: ["thread-child"],
          prompt: "Inspect package metadata",
        },
      },
    }) + "\n");
    proc._stdout.push(JSON.stringify({
      method: "item/started",
      params: {
        threadId: "thread-child",
        item: {
          type: "commandExecution",
          id: "child-read-1",
          command: "cat package.json",
          status: "inProgress",
          commandActions: [{
            type: "read",
            command: "cat package.json",
            name: "cat",
            path: "/tmp/project/package.json",
          }],
        },
      },
    }) + "\n");
    proc._stdout.push(JSON.stringify({
      method: "item/completed",
      params: {
        threadId: "thread-child",
        item: {
          type: "commandExecution",
          id: "child-read-1",
          command: "cat package.json",
          status: "completed",
          aggregatedOutput: "{ \"name\": \"demo\" }\n",
          exitCode: 0,
          commandActions: [{
            type: "read",
            command: "cat package.json",
            name: "cat",
            path: "/tmp/project/package.json",
          }],
        },
      },
    }) + "\n");

    expect(assistantEvents).toEqual([
      expect.objectContaining({
        message: expect.objectContaining({
          content: [
            expect.objectContaining({ type: "tool_use", id: "collab-1", name: "Agent" }),
          ],
        }),
      }),
      expect.objectContaining({
        message: expect.objectContaining({
          content: [
            expect.objectContaining({
              type: "tool_use",
              id: "child-read-1",
              name: "Read",
              parentToolUseId: "collab-1",
              input: expect.stringContaining("\"file_path\":\"/tmp/project/package.json\""),
            }),
          ],
        }),
      }),
    ]);
    expect(userEvents).toEqual([
      expect.objectContaining({
        message: expect.objectContaining({
          content: [
            expect.objectContaining({
              type: "tool_result",
              tool_use_id: "child-read-1",
              content: "{ \"name\": \"demo\" }\n",
            }),
          ],
        }),
      }),
    ]);
  });

  it("replays completed receiver-thread tools before completing the Codex turn", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const session = new CodexAppServerSession();
    const assistantEvents: unknown[] = [];
    const resultEvents: unknown[] = [];
    session.on("assistant", (event) => assistantEvents.push(event));
    session.on("result", (event) => resultEvents.push(event));
    await initializeSession(session, proc);

    proc._stdout.push(JSON.stringify({
      method: "item/completed",
      params: {
        threadId: "thread-1",
        item: {
          type: "collabAgentToolCall",
          id: "collab-1",
          tool: "spawnAgent",
          status: "completed",
          receiverThreadIds: ["thread-child"],
          prompt: "Inspect auth",
        },
      },
    }) + "\n");

    const read = await waitForMethod(proc, "thread/read");
    proc._stdout.push(appServerResponse(read.id, {
      thread: {
        id: "thread-child",
        turns: [{
          id: "turn-child",
          items: [{
            type: "collabAgentToolCall",
            id: "collab-self",
            tool: "spawnAgent",
            status: "completed",
            receiverThreadIds: ["thread-child"],
            prompt: "Inspect auth",
          }, {
            type: "commandExecution",
            id: "child-cmd-1",
            command: "npm test",
            cwd: "/tmp/project",
            status: "completed",
            aggregatedOutput: "ok",
            exitCode: 0,
          }],
        }],
      },
    }));
    proc._stdout.push(JSON.stringify({
      method: "turn/completed",
      params: {
        turn: {
          id: "turn-1",
          status: "completed",
          durationMs: 123,
        },
      },
    }) + "\n");

    await waitForCondition(() => resultEvents.length === 1);
    expect(assistantEvents).toEqual([
      expect.objectContaining({
        message: expect.objectContaining({
          content: [
            expect.objectContaining({ type: "tool_use", id: "collab-1", name: "Agent" }),
          ],
        }),
      }),
      expect.objectContaining({
        message: expect.objectContaining({
          content: [
            expect.objectContaining({
              type: "tool_use",
              id: "child-cmd-1",
              name: "Bash",
              parentToolUseId: "collab-1",
            }),
          ],
        }),
      }),
    ]);
    expect(resultEvents).toEqual([
      expect.objectContaining({ type: "result", status: "completed", duration_ms: 123 }),
    ]);
  });

  it("emits context-window usage from token usage updates", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const session = new CodexAppServerSession();
    const resultEvents: unknown[] = [];
    session.on("result", (event) => resultEvents.push(event));
    await initializeSession(session, proc);

    proc._stdout.push(JSON.stringify({
      method: "thread/tokenUsage/updated",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        tokenUsage: {
          last: {
            totalTokens: 42_000,
            inputTokens: 36_000,
            cachedInputTokens: 5_000,
            outputTokens: 900,
            reasoningOutputTokens: 100,
          },
          total: {
            totalTokens: 80_000,
            inputTokens: 70_000,
            cachedInputTokens: 8_000,
            outputTokens: 1_800,
            reasoningOutputTokens: 200,
          },
          modelContextWindow: 400_000,
        },
      },
    }) + "\n");
    proc._stdout.push(JSON.stringify({
      method: "turn/completed",
      params: {
        turn: {
          id: "turn-1",
          status: "completed",
        },
      },
    }) + "\n");

    await waitForCondition(() => resultEvents.length === 1);
    expect(resultEvents[0]).toMatchObject({
      usage: {
        input_tokens: 36_000,
        cache_read_input_tokens: 5_000,
        output_tokens: 900,
        context_used_tokens: 42_000,
        context_window: 400_000,
      },
    });
  });

  it("does not surface unmaterialized receiver-thread replay errors", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const session = new CodexAppServerSession();
    const diagnostics: unknown[] = [];
    const resultEvents: unknown[] = [];
    session.on("agent_event", (event) => diagnostics.push(event));
    session.on("result", (event) => resultEvents.push(event));
    await initializeSession(session, proc);

    proc._stdout.push(JSON.stringify({
      method: "item/completed",
      params: {
        threadId: "thread-1",
        item: {
          type: "collabAgentToolCall",
          id: "collab-1",
          tool: "spawnAgent",
          status: "completed",
          receiverThreadIds: ["thread-child"],
          prompt: "Inspect auth",
        },
      },
    }) + "\n");

    const read = await waitForMethod(proc, "thread/read");
    proc._stdout.push(appServerError(
      read.id,
      "thread thread-child is not materialized yet; includeTurns is unavailable before first user message",
    ));
    proc._stdout.push(JSON.stringify({
      method: "turn/completed",
      params: {
        turn: {
          id: "turn-1",
          status: "completed",
          durationMs: 123,
        },
      },
    }) + "\n");

    await waitForCondition(() => resultEvents.length === 1);
    expect(diagnostics).toEqual([]);
    expect(resultEvents).toEqual([
      expect.objectContaining({ type: "result", status: "completed", duration_ms: 123 }),
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

  it("emits an interrupted result instead of an error when closed mid-turn", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const session = new CodexAppServerSession();
    const results: unknown[] = [];
    const errors: Error[] = [];
    session.on("result", (event) => results.push(event));
    session.on("error", (err) => errors.push(err));
    await initializeSession(session, proc);

    session.close();

    await waitForCondition(() => results.length === 1);
    expect(errors).toEqual([]);
    expect(results[0]).toMatchObject({
      type: "result",
      status: "interrupted",
      turn_id: "turn-1",
      session_id: "",
    });
    expect(session.capturedTurnId).toBeUndefined();
  });

  it("finalizes the turn when Codex rejects the interrupt for a turn it no longer tracks", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const session = new CodexAppServerSession();
    const results: unknown[] = [];
    const errors: Error[] = [];
    session.on("result", (event) => results.push(event));
    session.on("error", (err) => errors.push(err));
    await initializeSession(session, proc);

    session.interruptActiveTurn();
    const interrupt = await waitForMethod(proc, "turn/interrupt");
    proc._stdout.push(appServerError(interrupt.id, "no turn to stop"));

    await waitForCondition(() => results.length === 1);
    expect(errors).toEqual([]);
    expect(results[0]).toMatchObject({
      type: "result",
      status: "interrupted",
      turn_id: "turn-1",
      session_id: "",
    });
    expect(session.capturedTurnId).toBeUndefined();

    // A late turn/completed for the same turn must not double-finalize.
    proc._stdout.push(JSON.stringify({
      method: "turn/completed",
      params: { turn: { id: "turn-1", status: "completed" } },
    }) + "\n");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(results).toHaveLength(1);
  });

  it("normalizes native Codex goal notifications", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const session = new CodexAppServerSession();
    const events: unknown[] = [];
    session.on("agent_event", (event) => events.push(event));
    await initializeSession(session, proc);

    proc._stdout.push(JSON.stringify({
      method: "thread/goal/updated",
      params: {
        goal: {
          threadId: "thread-1",
          objective: "Implement the backend protocol foundation",
          status: "active",
          tokenBudget: null,
          tokensUsed: 1234,
          timeUsedSeconds: 45,
          createdAt: 1_779_300_000,
          updatedAt: 1_779_300_060,
        },
      },
    }) + "\n");
    proc._stdout.push(JSON.stringify({
      method: "thread/goal/cleared",
      params: {
        threadId: "thread-1",
      },
    }) + "\n");

    expect(events).toEqual([
      {
        type: "goal_updated",
        id: "codex-goal-thread-1",
        active: true,
        threadId: "thread-1",
        objective: "Implement the backend protocol foundation",
        status: "active",
        tokenBudget: null,
        tokensUsed: 1234,
        timeUsedSeconds: 45,
        createdAt: 1_779_300_000,
        updatedAt: 1_779_300_060,
      },
      {
        type: "goal_updated",
        id: "codex-goal-thread-1",
        active: false,
        threadId: "thread-1",
        objective: undefined,
        status: undefined,
        tokenBudget: undefined,
        tokensUsed: undefined,
        timeUsedSeconds: undefined,
        createdAt: undefined,
        updatedAt: undefined,
      },
    ]);
  });
});
