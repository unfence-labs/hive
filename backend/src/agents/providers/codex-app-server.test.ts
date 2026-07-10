import { EventEmitter } from "node:events";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

import { spawn } from "node:child_process";
import { MAX_AGENT_OUTPUT_CHARS } from "../bounded-output.js";
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

async function waitForNthMethod(
  proc: ReturnType<typeof createMockProcess>,
  method: string,
  occurrence: number,
): Promise<{ id: number }> {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    const writes = parseWrites(proc).filter(
      (write): write is { id: number; method: string } => write.method === method && typeof write.id === "number",
    );
    if (writes.length >= occurrence) {
      return { id: writes[occurrence - 1].id };
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${method} occurrence ${occurrence}`);
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

  it("requests full access by default on thread/start and turn/start", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const session = new CodexAppServerSession();
    await initializeSession(session, proc);

    const writes = parseWrites(proc);
    const threadStart = writes.find((w) => w.method === "thread/start");
    const turnStart = writes.find((w) => w.method === "turn/start");
    expect((threadStart?.params as { sandbox?: string }).sandbox).toBe("danger-full-access");
    expect((turnStart?.params as { sandboxPolicy?: { type?: string } }).sandboxPolicy?.type).toBe("dangerFullAccess");
    expect((turnStart?.params as { summary?: string }).summary).toBe("auto");
  });

  it("uses the read-only sandbox on thread/start and turn/start when readOnly", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const session = new CodexAppServerSession();

    const started = session.startTurn({
      cwd: "/tmp/project",
      content: "review only",
      model: "gpt-5.5",
      readOnly: true,
    });

    const initialize = await waitForMethod(proc, "initialize");
    proc._stdout.push(appServerResponse(initialize.id, {
      userAgent: "codex-test",
      codexHome: "/tmp/codex",
      platformFamily: "unix",
      platformOs: "linux",
    }));
    const threadStartReq = await waitForMethod(proc, "thread/start");
    proc._stdout.push(appServerResponse(threadStartReq.id, { thread: { id: "thread-1" } }));
    const turnStartReq = await waitForMethod(proc, "turn/start");
    proc._stdout.push(appServerResponse(turnStartReq.id, { turn: { id: "turn-1" } }));
    await started;

    const writes = parseWrites(proc);
    const threadStart = writes.find((w) => w.method === "thread/start");
    const turnStart = writes.find((w) => w.method === "turn/start");
    expect((threadStart?.params as { sandbox?: string }).sandbox).toBe("read-only");
    expect((turnStart?.params as { sandboxPolicy?: { type?: string } }).sandboxPolicy?.type).toBe("readOnly");
  });

  it("sets a goal on a materialized thread without starting a turn", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const session = new CodexAppServerSession({ enableGoals: true });
    const events: unknown[] = [];
    session.on("agent_event", (event) => events.push(event));

    const pending = session.setGoal(
      { objective: "Ship backend support", status: "active" },
      { cwd: "/tmp/project", model: "gpt-5.5" },
    );

    const initialize = await waitForMethod(proc, "initialize");
    proc._stdout.push(appServerResponse(initialize.id, {
      userAgent: "codex-test",
      codexHome: "/tmp/codex",
      platformFamily: "unix",
      platformOs: "linux",
    }));

    const threadStart = await waitForMethod(proc, "thread/start");
    proc._stdout.push(appServerResponse(threadStart.id, { thread: { id: "thread-goal" } }));

    const goalSet = await waitForMethod(proc, "thread/goal/set");
    const goalSetWrite = parseWrites(proc).find((write) => write.method === "thread/goal/set");
    expect(goalSetWrite).toMatchObject({
      params: {
        threadId: "thread-goal",
        objective: "Ship backend support",
        status: "active",
      },
    });
    proc._stdout.push(appServerResponse(goalSet.id, {
      goal: {
        threadId: "thread-goal",
        objective: "Ship backend support",
        status: "active",
      },
    }));

    await expect(pending).resolves.toEqual({
      threadId: "thread-goal",
      goal: {
        threadId: "thread-goal",
        objective: "Ship backend support",
        status: "active",
      },
    });
    expect(parseWrites(proc).filter((write) => write.method === "turn/start")).toHaveLength(0);
    expect(events).toEqual([
      expect.objectContaining({
        type: "goal_updated",
        active: true,
        threadId: "thread-goal",
        objective: "Ship backend support",
        status: "active",
      }),
    ]);

    proc._stdout.push(JSON.stringify({
      method: "thread/goal/updated",
      params: {
        goal: {
          threadId: "thread-goal",
          objective: "Ship backend support",
          status: "active",
        },
      },
    }) + "\n");
    expect(events).toHaveLength(1);

    proc._stdout.push(JSON.stringify({
      method: "thread/goal/updated",
      params: {
        goal: {
          threadId: "thread-goal",
          objective: "Ship backend support",
          status: "active",
          tokensUsed: 10,
        },
      },
    }) + "\n");
    expect(events).toEqual([
      expect.objectContaining({
        type: "goal_updated",
        active: true,
        threadId: "thread-goal",
        objective: "Ship backend support",
        status: "active",
      }),
      expect.objectContaining({
        type: "goal_updated",
        active: true,
        threadId: "thread-goal",
        objective: "Ship backend support",
        status: "active",
        tokensUsed: 10,
      }),
    ]);
  });

  it("clears a goal on a materialized thread without starting a turn", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const session = new CodexAppServerSession({ enableGoals: true });
    const events: unknown[] = [];
    session.on("agent_event", (event) => events.push(event));

    const pending = session.clearGoal({ cwd: "/tmp/project", model: "gpt-5.5" });

    const initialize = await waitForMethod(proc, "initialize");
    proc._stdout.push(appServerResponse(initialize.id, {
      userAgent: "codex-test",
      codexHome: "/tmp/codex",
      platformFamily: "unix",
      platformOs: "linux",
    }));
    const threadStart = await waitForMethod(proc, "thread/start");
    proc._stdout.push(appServerResponse(threadStart.id, { thread: { id: "thread-goal-clear" } }));
    const goalClear = await waitForMethod(proc, "thread/goal/clear");
    const goalClearWrite = parseWrites(proc).find((write) => write.method === "thread/goal/clear");
    expect(goalClearWrite).toMatchObject({
      params: { threadId: "thread-goal-clear" },
    });
    proc._stdout.push(appServerResponse(goalClear.id, {}));

    await expect(pending).resolves.toEqual({ threadId: "thread-goal-clear", goal: null });
    expect(parseWrites(proc).filter((write) => write.method === "turn/start")).toHaveLength(0);
    expect(events).toEqual([
      expect.objectContaining({
        type: "goal_updated",
        active: false,
        threadId: "thread-goal-clear",
      }),
    ]);

    proc._stdout.push(JSON.stringify({
      method: "thread/goal/cleared",
      params: {
        threadId: "thread-goal-clear",
      },
    }) + "\n");
    expect(events).toHaveLength(1);
  });

  it("emits goal state from get responses without waiting for notifications", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const session = new CodexAppServerSession({ enableGoals: true });
    const events: unknown[] = [];
    session.on("agent_event", (event) => events.push(event));

    const first = session.getGoal({ cwd: "/tmp/project", model: "gpt-5.5" });

    const initialize = await waitForMethod(proc, "initialize");
    proc._stdout.push(appServerResponse(initialize.id, {
      userAgent: "codex-test",
      codexHome: "/tmp/codex",
      platformFamily: "unix",
      platformOs: "linux",
    }));
    const threadStart = await waitForMethod(proc, "thread/start");
    proc._stdout.push(appServerResponse(threadStart.id, { thread: { id: "thread-goal-get" } }));
    const firstGoalGet = await waitForMethod(proc, "thread/goal/get");
    proc._stdout.push(appServerResponse(firstGoalGet.id, {
      goal: {
        threadId: "thread-goal-get",
        objective: "Keep the UI current",
        status: "active",
      },
    }));

    await expect(first).resolves.toEqual({
      threadId: "thread-goal-get",
      goal: {
        threadId: "thread-goal-get",
        objective: "Keep the UI current",
        status: "active",
      },
    });

    const second = session.getGoal({ cwd: "/tmp/project", model: "gpt-5.5" });
    const secondGoalGet = await waitForNthMethod(proc, "thread/goal/get", 2);
    proc._stdout.push(appServerResponse(secondGoalGet.id, { goal: null }));

    await expect(second).resolves.toEqual({ threadId: "thread-goal-get", goal: null });
    expect(events).toEqual([
      expect.objectContaining({
        type: "goal_updated",
        active: true,
        threadId: "thread-goal-get",
        objective: "Keep the UI current",
        status: "active",
      }),
      expect.objectContaining({
        type: "goal_updated",
        active: false,
        threadId: "thread-goal-get",
      }),
    ]);
    expect(parseWrites(proc).filter((write) => write.method === "turn/start")).toHaveLength(0);
  });

  it("emits repeated explicit goal reads when the goal state is unchanged", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const session = new CodexAppServerSession({ enableGoals: true });
    const events: unknown[] = [];
    session.on("agent_event", (event) => events.push(event));
    const goal = {
      threadId: "thread-goal-repeat",
      objective: "Keep the UI current",
      status: "active",
    };

    const first = session.getGoal({ cwd: "/tmp/project", model: "gpt-5.5" });

    const initialize = await waitForMethod(proc, "initialize");
    proc._stdout.push(appServerResponse(initialize.id, {
      userAgent: "codex-test",
      codexHome: "/tmp/codex",
      platformFamily: "unix",
      platformOs: "linux",
    }));
    const threadStart = await waitForMethod(proc, "thread/start");
    proc._stdout.push(appServerResponse(threadStart.id, { thread: { id: "thread-goal-repeat" } }));
    const firstGoalGet = await waitForMethod(proc, "thread/goal/get");
    proc._stdout.push(appServerResponse(firstGoalGet.id, { goal }));

    await expect(first).resolves.toEqual({ threadId: "thread-goal-repeat", goal });
    proc._stdout.push(JSON.stringify({
      method: "thread/goal/updated",
      params: { goal },
    }) + "\n");
    expect(events).toHaveLength(1);

    const second = session.getGoal({ cwd: "/tmp/project", model: "gpt-5.5" });
    const secondGoalGet = await waitForNthMethod(proc, "thread/goal/get", 2);
    proc._stdout.push(appServerResponse(secondGoalGet.id, { goal }));

    await expect(second).resolves.toEqual({ threadId: "thread-goal-repeat", goal });
    expect(events).toEqual([
      expect.objectContaining({
        type: "goal_updated",
        active: true,
        threadId: "thread-goal-repeat",
        objective: "Keep the UI current",
        status: "active",
      }),
      expect.objectContaining({
        type: "goal_updated",
        active: true,
        threadId: "thread-goal-repeat",
        objective: "Keep the UI current",
        status: "active",
      }),
    ]);

    proc._stdout.push(JSON.stringify({
      method: "thread/goal/updated",
      params: { goal },
    }) + "\n");
    expect(events).toHaveLength(2);
    expect(parseWrites(proc).filter((write) => write.method === "turn/start")).toHaveLength(0);
  });

  it("does not suppress a genuine identical-state goal notification after a new turn", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const session = new CodexAppServerSession({ enableGoals: true });
    const events: unknown[] = [];
    session.on("agent_event", (event) => events.push(event));
    const goal = {
      threadId: "thread-goal-turnreset",
      objective: "Keep the UI current",
      status: "active" as const,
    };

    const read = session.getGoal({ cwd: "/tmp/project", model: "gpt-5.5" });
    const initialize = await waitForMethod(proc, "initialize");
    proc._stdout.push(appServerResponse(initialize.id, {
      userAgent: "codex-test",
      codexHome: "/tmp/codex",
      platformFamily: "unix",
      platformOs: "linux",
    }));
    const threadStart = await waitForMethod(proc, "thread/start");
    proc._stdout.push(appServerResponse(threadStart.id, { thread: { id: "thread-goal-turnreset" } }));
    const goalGet = await waitForMethod(proc, "thread/goal/get");
    proc._stdout.push(appServerResponse(goalGet.id, { goal }));
    await expect(read).resolves.toEqual({ threadId: "thread-goal-turnreset", goal });
    expect(events).toHaveLength(1);

    // A new user turn is a context boundary: it must drop the read's pending
    // echo key so the next genuine same-state notification is not swallowed.
    const turn = session.startTurn({ cwd: "/tmp/project", content: "carry on", model: "gpt-5.5" });
    const turnStart = await waitForMethod(proc, "turn/start");
    proc._stdout.push(appServerResponse(turnStart.id, { turn: { id: "turn-after-read" } }));
    await turn;

    proc._stdout.push(JSON.stringify({
      method: "thread/goal/updated",
      params: { goal },
    }) + "\n");
    expect(events).toHaveLength(2);
  });

  it("auto-accepts known command and file approval requests", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const session = new CodexAppServerSession();
    const events: unknown[] = [];
    session.on("agent_event", (event) => events.push(event));
    await initializeSession(session, proc);

    proc._stdout.push(appServerRequest(100, "item/commandExecution/requestApproval"));
    await expect(waitForResponse(proc, 100)).resolves.toMatchObject({ id: 100, result: { decision: "accept" } });

    proc._stdout.push(JSON.stringify({
      method: "serverRequest/resolved",
      params: { threadId: "thread-1", requestId: "100" },
    }) + "\n");
    expect(events).toEqual([]);

    proc._stdout.push(appServerRequest(101, "item/fileChange/requestApproval"));
    proc._stdout.push(appServerRequest(102, "execCommandApproval"));
    proc._stdout.push(appServerRequest(103, "applyPatchApproval"));

    await expect(waitForResponse(proc, 101)).resolves.toMatchObject({ id: 101, result: { decision: "accept" } });
    await expect(waitForResponse(proc, 102)).resolves.toMatchObject({ id: 102, result: { decision: "approved" } });
    await expect(waitForResponse(proc, 103)).resolves.toMatchObject({ id: 103, result: { decision: "approved" } });
    expect(events).toEqual([]);
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

  it("ignores turn lifecycle notifications from sub-agent threads", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const session = new CodexAppServerSession();
    const turnStartedEvents: unknown[] = [];
    const resultEvents: Array<Record<string, unknown>> = [];
    session.on("turn_started", (event) => turnStartedEvents.push(event));
    session.on("result", (event) => resultEvents.push(event as unknown as Record<string, unknown>));
    await initializeSession(session, proc);

    // The App Server auto-attaches the client to spawned sub-agent threads and
    // forwards their turn lifecycle too. Those must never hijack active-turn
    // tracking: before this guard, the sub-thread's turn/started overwrote
    // activeTurnId and the main turn/completed was dropped as stale (ghost turn).
    proc._stdout.push(JSON.stringify({
      method: "turn/started",
      params: { threadId: "thread-child", turn: { id: "turn-child" } },
    }) + "\n");
    proc._stdout.push(JSON.stringify({
      method: "turn/completed",
      params: { threadId: "thread-child", turn: { id: "turn-child", status: "completed" } },
    }) + "\n");
    proc._stdout.push(JSON.stringify({
      method: "turn/completed",
      params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed", durationMs: 42 } },
    }) + "\n");

    await waitForCondition(() => resultEvents.length === 1);
    expect(turnStartedEvents).toEqual([]);
    expect(session.capturedThreadId).toBe("thread-1");
    expect(resultEvents).toEqual([
      expect.objectContaining({
        type: "result",
        status: "completed",
        turn_id: "turn-1",
        session_id: "thread-1",
        duration_ms: 42,
      }),
    ]);
  });

  it("does not adopt foreign thread ids from thread/started notifications", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const session = new CodexAppServerSession();
    await initializeSession(session, proc);

    proc._stdout.push(JSON.stringify({
      method: "thread/started",
      params: { thread: { id: "thread-child" } },
    }) + "\n");

    await waitForCondition(() => parseWrites(proc).length > 0);
    expect(session.capturedThreadId).toBe("thread-1");
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
    proc._stdout.push(JSON.stringify({
      method: "serverRequest/resolved",
      params: { threadId: "thread-1", requestId: "req-1" },
    }) + "\n");
    proc._stdout.push(JSON.stringify({
      method: "thread/compacted",
      params: { threadId: "thread-1" },
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

  it.each([
    ["interacted", "item/completed"],
    ["interrupted", "item/completed"],
  ] as const)("emits %s sub-agent activity without a diagnostic", async (activityKind, method) => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const session = new CodexAppServerSession();
    const events: unknown[] = [];
    session.on("agent_event", (event) => events.push(event));
    await initializeSession(session, proc);

    proc._stdout.push(JSON.stringify({
      method,
      params: {
        item: {
          type: "subAgentActivity",
          id: `subagent-activity-${activityKind}`,
          kind: activityKind,
          agentThreadId: "thread-child",
          agentPath: `/root/${activityKind}`,
        },
      },
    }) + "\n");

    expect(events).toEqual([{
      type: "subagent_activity_updated",
      id: `subagent-activity-${activityKind}`,
      activityKind,
      agentThreadId: "thread-child",
      agentPath: `/root/${activityKind}`,
    }]);
    expect(events.some((event) => (event as { type?: string }).type === "diagnostic")).toBe(false);
  });

  it("renders a v2 sub-agent spawn (\"started\" activity) as an Agent tool call", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const session = new CodexAppServerSession();
    const events: unknown[] = [];
    const assistantEvents: unknown[] = [];
    const userEvents: unknown[] = [];
    session.on("agent_event", (event) => events.push(event));
    session.on("assistant", (event) => assistantEvents.push(event));
    session.on("user", (event) => userEvents.push(event));
    await initializeSession(session, proc);

    proc._stdout.push(JSON.stringify({
      method: "item/completed",
      params: {
        item: {
          type: "subAgentActivity",
          id: "spawn-1",
          kind: "started",
          agentThreadId: "thread-child",
          agentPath: "/root/worker",
        },
      },
    }) + "\n");

    expect(assistantEvents).toEqual([
      expect.objectContaining({
        type: "assistant",
        message: expect.objectContaining({
          id: "spawn-1",
          content: [
            expect.objectContaining({ type: "tool_use", id: "spawn-1", name: "Agent" }),
          ],
        }),
      }),
    ]);
    expect((assistantEvents[0] as {
      message: { content: Array<{ parentToolUseId?: string }> };
    }).message.content[0].parentToolUseId).toBeUndefined();
    expect(userEvents).toEqual([
      expect.objectContaining({
        type: "user",
        message: expect.objectContaining({
          content: [
            expect.objectContaining({ type: "tool_result", tool_use_id: "spawn-1" }),
          ],
        }),
      }),
    ]);
    expect(events.some((event) => (event as { type?: string }).type === "subagent_activity_updated")).toBe(false);
    expect(events.some((event) => (event as { type?: string }).type === "diagnostic")).toBe(false);
  });

  it("owns child thread items after a v2 sub-agent spawn", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const session = new CodexAppServerSession();
    const events: unknown[] = [];
    const assistantEvents: unknown[] = [];
    session.on("agent_event", (event) => events.push(event));
    session.on("assistant", (event) => assistantEvents.push(event));
    await initializeSession(session, proc);

    proc._stdout.push(JSON.stringify({
      method: "item/completed",
      params: {
        item: {
          type: "subAgentActivity",
          id: "spawn-1",
          kind: "started",
          agentThreadId: "thread-child",
          agentPath: "/root/worker",
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
    proc._stdout.push(JSON.stringify({
      method: "item/completed",
      params: {
        threadId: "thread-child",
        item: {
          type: "agentMessage",
          id: "child-msg-1",
          text: "done",
        },
      },
    }) + "\n");

    expect(assistantEvents).toEqual([
      expect.objectContaining({
        message: expect.objectContaining({
          content: [expect.objectContaining({ type: "tool_use", id: "spawn-1", name: "Agent" })],
        }),
      }),
      expect.objectContaining({
        message: expect.objectContaining({
          content: [
            expect.objectContaining({
              type: "tool_use",
              id: "child-cmd-1",
              name: "Bash",
              parentToolUseId: "spawn-1",
            }),
          ],
        }),
      }),
    ]);
    expect(events.some((event) => (event as { type?: string }).type === "command_execution_updated")).toBe(false);
    expect(assistantEvents.some((event) => {
      const content = (event as { message: { content: Array<{ type?: string }> } }).message.content;
      return content.some((block) => block.type === "text");
    })).toBe(false);
  });

  it("replays registered child threads when a v2 wait completes", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const session = new CodexAppServerSession();
    const assistantEvents: Array<{ message: { content: Array<Record<string, unknown>> } }> = [];
    session.on("assistant", (event) => assistantEvents.push(event as never));
    await initializeSession(session, proc);

    proc._stdout.push(JSON.stringify({
      method: "item/completed",
      params: {
        item: {
          type: "subAgentActivity",
          id: "spawn-1",
          kind: "started",
          agentThreadId: "thread-child",
          agentPath: "/root/worker",
        },
      },
    }) + "\n");
    proc._stdout.push(JSON.stringify({
      method: "item/completed",
      params: {
        threadId: "thread-1",
        item: {
          type: "collabAgentToolCall",
          id: "collab-wait-1",
          tool: "wait",
          status: "completed",
          receiverThreadIds: [],
        },
      },
    }) + "\n");

    const read = await waitForMethod(proc, "thread/read");
    expect(parseWrites(proc).find((write) => write.id === read.id)).toEqual(
      expect.objectContaining({ params: expect.objectContaining({ threadId: "thread-child" }) }),
    );
    proc._stdout.push(appServerResponse(read.id, {
      thread: {
        id: "thread-child",
        turns: [{
          id: "turn-child",
          items: [{
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

    await waitForCondition(() =>
      assistantEvents.some((event) => event.message.content.some((block) => block.id === "child-cmd-1")),
    );
    const blocks = assistantEvents.flatMap((event) => event.message.content);
    expect(blocks.find((block) => block.id === "child-cmd-1")).toEqual(
      expect.objectContaining({ parentToolUseId: "spawn-1" }),
    );
  });

  it("emits a diagnostic instead of sub-agent activity for an unknown activity kind", async () => {
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
          type: "subAgentActivity",
          id: "subagent-unknown",
          kind: "delegated",
          agentThreadId: "thread-child",
          agentPath: "/root/worker",
        },
      },
    }) + "\n");

    expect(events).toEqual([
      expect.objectContaining({
        type: "diagnostic",
        severity: "info",
        title: "Unsupported App Server item",
        message: "Hive does not render sub-agent activity kind \"delegated\" yet.",
        method: "item/subAgentActivity",
      }),
    ]);
    expect(events.some((event) => (event as { type?: string }).type === "subagent_activity_updated")).toBe(false);
  });

  it("emits a diagnostic instead of sub-agent activity for a malformed payload", async () => {
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
          type: "subAgentActivity",
          id: "subagent-missing-path",
          kind: "started",
          agentThreadId: "thread-child",
        },
      },
    }) + "\n");

    expect(events).toEqual([
      expect.objectContaining({
        type: "diagnostic",
        severity: "info",
        title: "Unsupported App Server item",
        method: "item/subAgentActivity",
      }),
    ]);
    expect(events.some((event) => (event as { type?: string }).type === "subagent_activity_updated")).toBe(false);
  });

  it("updates sub-agent activity on item completion without inferring completion", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const session = new CodexAppServerSession();
    const events: unknown[] = [];
    session.on("agent_event", (event) => events.push(event));
    await initializeSession(session, proc);

    const item = {
      type: "subAgentActivity",
      id: "subagent-activity-1",
      agentThreadId: "thread-child",
      agentPath: "/root/worker",
    };
    proc._stdout.push(JSON.stringify({
      method: "item/started",
      params: { item: { ...item, kind: "interacted" } },
    }) + "\n");
    proc._stdout.push(JSON.stringify({
      method: "item/completed",
      params: { item: { ...item, kind: "interrupted" } },
    }) + "\n");

    expect(events).toEqual([
      {
        type: "subagent_activity_updated",
        id: item.id,
        activityKind: "interacted",
        agentThreadId: item.agentThreadId,
        agentPath: item.agentPath,
      },
      {
        type: "subagent_activity_updated",
        id: item.id,
        activityKind: "interrupted",
        agentThreadId: item.agentThreadId,
        agentPath: item.agentPath,
      },
    ]);
    expect(events.some((event) => (event as { type?: string }).type === "diagnostic")).toBe(false);
  });

  it("emits context compaction updates across the item lifecycle without a diagnostic", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const session = new CodexAppServerSession();
    const events: unknown[] = [];
    session.on("agent_event", (event) => events.push(event));
    await initializeSession(session, proc);

    const item = { type: "contextCompaction", id: "compaction-1" };
    proc._stdout.push(JSON.stringify({
      method: "item/started",
      params: { item },
    }) + "\n");
    proc._stdout.push(JSON.stringify({
      method: "item/completed",
      params: { item },
    }) + "\n");

    expect(events).toEqual([
      { type: "context_compaction_updated", id: "compaction-1", status: "inProgress" },
      { type: "context_compaction_updated", id: "compaction-1", status: "completed" },
    ]);
    expect(events.some((event) => (event as { type?: string }).type === "diagnostic")).toBe(false);
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

  it("resolves relative image view paths against the turn cwd", async () => {
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
          path: "vesu.png",
        },
      },
    }) + "\n");

    expect(events).toEqual([{
      type: "image_view_updated",
      id: "image-1",
      path: "/tmp/project/vesu.png",
      relativePath: "vesu.png",
    }]);
  });

  it("flags relative image view paths outside the workspace", async () => {
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
          path: "../elsewhere.png",
        },
      },
    }) + "\n");

    expect(events).toEqual([{
      type: "image_view_updated",
      id: "image-1",
      path: "/tmp/elsewhere.png",
      outsideWorkspace: true,
    }]);
  });

  it("keeps sub-agent image views and generations out of the main stream", async () => {
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
          type: "collabAgentToolCall",
          id: "collab-1",
          tool: "spawnAgent",
          status: "inProgress",
          receiverThreadIds: ["thread-child"],
          prompt: "Inspect assets",
        },
      },
    }) + "\n");
    // The sub-agent views the same image the parent will also view: without
    // the parent filter both rendered as identical top-level tiles.
    proc._stdout.push(JSON.stringify({
      method: "item/completed",
      params: {
        threadId: "thread-child",
        item: {
          type: "imageView",
          id: "child-image-1",
          path: "/tmp/project/assets/logo.png",
        },
      },
    }) + "\n");
    proc._stdout.push(JSON.stringify({
      method: "item/completed",
      params: {
        threadId: "thread-child",
        item: {
          type: "imageGeneration",
          id: "child-gen-1",
          status: "completed",
          savedPath: "/tmp/project/assets/generated.png",
        },
      },
    }) + "\n");
    proc._stdout.push(JSON.stringify({
      method: "item/completed",
      params: {
        threadId: "thread-1",
        item: {
          type: "imageView",
          id: "main-image-1",
          path: "/tmp/project/assets/logo.png",
        },
      },
    }) + "\n");

    const imageEvents = events.filter((event) =>
      ["image_view_updated", "image_generation_updated"].includes((event as { type: string }).type),
    );
    expect(imageEvents).toEqual([
      expect.objectContaining({ type: "image_view_updated", id: "main-image-1" }),
    ]);
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

  it("resolves relative image generation saved paths against the turn cwd", async () => {
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
          savedPath: "generated/logo.png",
        },
      },
    }) + "\n");

    expect(events).toEqual([{
      type: "image_generation_updated",
      id: "gen-1",
      status: "completed",
      revisedPrompt: undefined,
      result: undefined,
      savedPath: "/tmp/project/generated/logo.png",
      relativePath: "generated/logo.png",
    }]);
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

  it("preserves Codex reasoning item identities across streamed deltas", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const session = new CodexAppServerSession();
    const assistantEvents: Array<{ message: { id: string; content: unknown[] } }> = [];
    const diagnostics: unknown[] = [];
    session.on("assistant", (event) => assistantEvents.push(event as never));
    session.on("agent_event", (event) => diagnostics.push(event));
    await initializeSession(session, proc);

    proc._stdout.push(JSON.stringify({
      method: "item/reasoning/summaryPartAdded",
      params: { itemId: "reasoning-item-1" },
    }) + "\n");
    proc._stdout.push(JSON.stringify({
      method: "item/reasoning/summaryTextDelta",
      params: { itemId: "reasoning-item-1", delta: "Inspect " },
    }) + "\n");
    proc._stdout.push(JSON.stringify({
      method: "item/reasoning/textDelta",
      params: { itemId: "reasoning-item-1", delta: "state" },
    }) + "\n");
    proc._stdout.push(JSON.stringify({
      method: "item/reasoning/summaryTextDelta",
      params: { itemId: "reasoning-item-2", delta: "Check clients" },
    }) + "\n");

    expect(assistantEvents.map((event) => event.message.id)).toEqual([
      "reasoning-item-1",
      "reasoning-item-1",
      "reasoning-item-2",
    ]);
    // Trailing whitespace is held back by the separator filter and re-emitted
    // with the next delta; accumulated content is unchanged.
    expect(assistantEvents.map((event) => event.message.content)).toEqual([
      [{ type: "thinking", thinking: "Inspect" }],
      [{ type: "thinking", thinking: " state" }],
      [{ type: "thinking", thinking: "Check clients" }],
    ]);
    expect(diagnostics).toEqual([]);
  });

  it("strips summary part separators from streamed reasoning deltas", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const session = new CodexAppServerSession();
    const assistantEvents: Array<{ message: { content: unknown[] } }> = [];
    session.on("assistant", (event) => assistantEvents.push(event as never));
    await initializeSession(session, proc);

    // OpenAI streams the `<!-- -->` part separator token-split across deltas.
    proc._stdout.push(JSON.stringify({
      method: "item/reasoning/summaryTextDelta",
      params: { itemId: "reasoning-item-1", delta: "**First part**" },
    }) + "\n");
    proc._stdout.push(JSON.stringify({
      method: "item/reasoning/summaryTextDelta",
      params: { itemId: "reasoning-item-1", delta: "\n\n<!-" },
    }) + "\n");
    proc._stdout.push(JSON.stringify({
      method: "item/reasoning/summaryTextDelta",
      params: { itemId: "reasoning-item-1", delta: "- -->\n\nSecond part" },
    }) + "\n");
    // A trailing separator (and the tail still held at completion) never emits.
    proc._stdout.push(JSON.stringify({
      method: "item/reasoning/summaryTextDelta",
      params: { itemId: "reasoning-item-1", delta: "\n\n<!-- -->" },
    }) + "\n");
    proc._stdout.push(JSON.stringify({
      method: "item/completed",
      params: { threadId: "thread-1", item: { id: "reasoning-item-1", type: "reasoning" } },
    }) + "\n");

    expect(assistantEvents.map((event) => event.message.content)).toEqual([
      [{ type: "thinking", thinking: "**First part**" }],
      [{ type: "thinking", thinking: "\n\nSecond part" }],
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

  it("suppresses sub-agent activity from receiver threads", async () => {
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
          type: "subAgentActivity",
          id: "child-subagent-1",
          kind: "interacted",
          agentThreadId: "thread-grandchild",
          agentPath: "/root/worker/nested",
        },
      },
    }) + "\n");
    proc._stdout.push(JSON.stringify({
      method: "item/started",
      params: {
        threadId: "thread-1",
        item: {
          type: "subAgentActivity",
          id: "main-subagent-1",
          kind: "interacted",
          agentThreadId: "thread-child",
          agentPath: "/root/worker",
        },
      },
    }) + "\n");

    expect(events).toEqual([{
      type: "subagent_activity_updated",
      id: "main-subagent-1",
      activityKind: "interacted",
      agentThreadId: "thread-child",
      agentPath: "/root/worker",
    }]);
  });

  it("registers grandchild threads from foreign started activities without rendering them", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const session = new CodexAppServerSession();
    const events: unknown[] = [];
    const assistantEvents: unknown[] = [];
    session.on("agent_event", (event) => events.push(event));
    session.on("assistant", (event) => assistantEvents.push(event));
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
    // A v2 spawn observed inside the child thread must stay out of the main
    // stream but still register the grandchild thread under its spawn call.
    proc._stdout.push(JSON.stringify({
      method: "item/completed",
      params: {
        threadId: "thread-child",
        item: {
          type: "subAgentActivity",
          id: "grandchild-spawn-1",
          kind: "started",
          agentThreadId: "thread-grandchild",
          agentPath: "/root/worker/nested",
        },
      },
    }) + "\n");
    proc._stdout.push(JSON.stringify({
      method: "item/started",
      params: {
        threadId: "thread-grandchild",
        item: {
          type: "commandExecution",
          id: "grandchild-cmd-1",
          command: "npm test",
          cwd: "/tmp/project",
          status: "inProgress",
        },
      },
    }) + "\n");
    proc._stdout.push(JSON.stringify({
      method: "item/completed",
      params: {
        threadId: "thread-grandchild",
        item: {
          type: "commandExecution",
          id: "grandchild-cmd-1",
          command: "npm test",
          cwd: "/tmp/project",
          status: "completed",
          aggregatedOutput: "ok",
          exitCode: 0,
        },
      },
    }) + "\n");

    const toolUseBlocks = assistantEvents
      .flatMap((event) => (event as { message: { content: Array<Record<string, unknown>> } }).message.content)
      .filter((block) => block.type === "tool_use");
    expect(toolUseBlocks.find((block) => block.id === "grandchild-spawn-1")).toBeUndefined();
    expect(events.some((event) => (event as { type?: string }).type === "subagent_activity_updated")).toBe(false);
    expect(toolUseBlocks.find((block) => block.id === "grandchild-cmd-1")).toEqual(
      expect.objectContaining({ parentToolUseId: "grandchild-spawn-1" }),
    );
  });

  it("parents live receiver-thread tools under documented Codex collab tool calls", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const session = new CodexAppServerSession();
    const assistantEvents: unknown[] = [];
    const diagnostics: unknown[] = [];
    session.on("assistant", (event) => assistantEvents.push(event));
    session.on("agent_event", (event) => diagnostics.push(event));
    await initializeSession(session, proc);

    proc._stdout.push(JSON.stringify({
      method: "item/started",
      params: {
        threadId: "thread-1",
        item: {
          type: "collabToolCall",
          id: "collab-1",
          tool: "spawnAgent",
          status: "inProgress",
          receiverThreadId: "thread-child",
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
    expect(diagnostics).not.toContainEqual(expect.objectContaining({ method: "item/collabToolCall" }));
  });

  it("does not re-emit a previous turn's sub-agent tools when closeAgent replays later", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const session = new CodexAppServerSession();
    const assistantEvents: Array<{ message: { content: Array<Record<string, unknown>> } }> = [];
    session.on("assistant", (event) => assistantEvents.push(event as never));
    await initializeSession(session, proc);

    // Turn 1: spawn a sub-agent and stream one of its commands live.
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
    proc._stdout.push(JSON.stringify({
      method: "turn/completed",
      params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed" } },
    }) + "\n");

    // Turn 2: the model closes the sub-agent; Hive replays the child thread.
    proc._stdout.push(JSON.stringify({
      method: "turn/started",
      params: { threadId: "thread-1", turn: { id: "turn-2" } },
    }) + "\n");
    proc._stdout.push(JSON.stringify({
      method: "item/completed",
      params: {
        threadId: "thread-1",
        item: {
          type: "collabAgentToolCall",
          id: "collab-close-1",
          tool: "closeAgent",
          status: "completed",
          receiverThreadIds: ["thread-child"],
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
            type: "commandExecution",
            id: "child-cmd-1",
            command: "npm test",
            cwd: "/tmp/project",
            status: "completed",
            aggregatedOutput: "ok",
            exitCode: 0,
          }, {
            type: "commandExecution",
            id: "child-cmd-2",
            command: "npm run lint",
            cwd: "/tmp/project",
            status: "completed",
            aggregatedOutput: "clean",
            exitCode: 0,
          }],
        }],
      },
    }));

    // The never-seen item is caught up, nested under the ORIGINAL Agent card.
    await waitForCondition(() =>
      assistantEvents.some((event) => event.message.content.some((block) => block.id === "child-cmd-2")),
    );
    const blocks = assistantEvents.flatMap((event) => event.message.content);
    expect(blocks.find((block) => block.id === "child-cmd-2")).toEqual(
      expect.objectContaining({ parentToolUseId: "collab-1" }),
    );
    // The previous turn's tool is NOT re-emitted (it used to duplicate here),
    // and nothing nests under the Close Agent card.
    expect(blocks.filter((block) => block.id === "child-cmd-1")).toHaveLength(1);
    expect(blocks.filter((block) => block.parentToolUseId === "collab-close-1")).toHaveLength(0);
  });

  it("does not re-emit a previous user turn's sub-agent tools when closeAgent replays later", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const session = new CodexAppServerSession();
    const assistantEvents: Array<{ message: { content: Array<Record<string, unknown>> } }> = [];
    const resultEvents: unknown[] = [];
    session.on("assistant", (event) => assistantEvents.push(event as never));
    session.on("result", (event) => resultEvents.push(event));
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
    proc._stdout.push(JSON.stringify({
      method: "turn/completed",
      params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed" } },
    }) + "\n");
    await waitForCondition(() => resultEvents.length === 1);

    const secondStarted = session.startTurn({
      cwd: "/tmp/project",
      content: "follow up",
      model: "gpt-5.5",
    });
    const secondTurnStart = await waitForNthMethod(proc, "turn/start", 2);
    expect(parseWrites(proc).filter((write) => write.method === "thread/start")).toHaveLength(1);
    proc._stdout.push(appServerResponse(secondTurnStart.id, { turn: { id: "turn-2" } }));
    await secondStarted;

    proc._stdout.push(JSON.stringify({
      method: "item/completed",
      params: {
        threadId: "thread-1",
        item: {
          type: "collabAgentToolCall",
          id: "collab-close-1",
          tool: "closeAgent",
          status: "completed",
          receiverThreadIds: ["thread-child"],
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
            type: "commandExecution",
            id: "child-cmd-1",
            command: "npm test",
            cwd: "/tmp/project",
            status: "completed",
            aggregatedOutput: "ok",
            exitCode: 0,
          }, {
            type: "commandExecution",
            id: "child-cmd-2",
            command: "npm run lint",
            cwd: "/tmp/project",
            status: "completed",
            aggregatedOutput: "clean",
            exitCode: 0,
          }],
        }],
      },
    }));

    await waitForCondition(() =>
      assistantEvents.some((event) => event.message.content.some((block) => block.id === "child-cmd-2")),
    );
    const toolUseBlocks = assistantEvents
      .flatMap((event) => event.message.content)
      .filter((block) => block.type === "tool_use");
    expect(toolUseBlocks.filter((block) => block.id === "child-cmd-1")).toHaveLength(1);
    expect(toolUseBlocks.filter((block) => block.id === "child-cmd-2")).toHaveLength(1);
  });

  it("keeps live receiver-thread tools under the spawning Agent card after a wait completes", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const session = new CodexAppServerSession();
    const assistantEvents: Array<{ message: { content: Array<Record<string, unknown>> } }> = [];
    session.on("assistant", (event) => assistantEvents.push(event as never));
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
    // A completed wait used to re-parent thread-child onto the Wait card.
    proc._stdout.push(JSON.stringify({
      method: "item/completed",
      params: {
        threadId: "thread-1",
        item: {
          type: "collabAgentToolCall",
          id: "collab-wait-1",
          tool: "wait",
          status: "completed",
          receiverThreadIds: ["thread-child"],
        },
      },
    }) + "\n");
    const read = await waitForMethod(proc, "thread/read");
    proc._stdout.push(appServerResponse(read.id, { thread: { id: "thread-child", turns: [] } }));

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
      assistantEvents.some((event) => event.message.content.some((block) => block.id === "child-cmd-late")),
    );
    const lateChild = assistantEvents
      .flatMap((event) => event.message.content)
      .find((block) => block.id === "child-cmd-late");
    expect(lateChild).toEqual(expect.objectContaining({ parentToolUseId: "collab-1" }));
  });

  it("keeps live receiver-thread tools under a fallback closeAgent card when spawn was missed", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const session = new CodexAppServerSession();
    const assistantEvents: Array<{ message: { content: Array<Record<string, unknown>> } }> = [];
    session.on("assistant", (event) => assistantEvents.push(event as never));
    await initializeSession(session, proc);

    proc._stdout.push(JSON.stringify({
      method: "item/completed",
      params: {
        threadId: "thread-1",
        item: {
          type: "collabAgentToolCall",
          id: "collab-close-1",
          tool: "closeAgent",
          status: "completed",
          receiverThreadIds: ["thread-child"],
        },
      },
    }) + "\n");
    const read = await waitForMethod(proc, "thread/read");
    proc._stdout.push(appServerResponse(read.id, { thread: { id: "thread-child", turns: [] } }));

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
      assistantEvents.some((event) => event.message.content.some((block) => block.id === "child-cmd-late")),
    );
    const lateChild = assistantEvents
      .flatMap((event) => event.message.content)
      .find((block) => block.id === "child-cmd-late");
    expect(lateChild).toEqual(expect.objectContaining({ parentToolUseId: "collab-close-1" }));
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
    proc._stdout.push(JSON.stringify({
      method: "item/completed",
      params: {
        threadId: "thread-1",
        item: {
          type: "collabAgentToolCall",
          id: "collab-wait-1",
          tool: "wait",
          status: "completed",
          receiverThreadIds: ["thread-child"],
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
            expect.objectContaining({ type: "tool_use", id: "collab-wait-1", name: "Agent" }),
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

  it("replays documented Codex collab tool call receiver-thread tools under the spawning parent", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const session = new CodexAppServerSession();
    const assistantEvents: unknown[] = [];
    const diagnostics: unknown[] = [];
    session.on("assistant", (event) => assistantEvents.push(event));
    session.on("agent_event", (event) => diagnostics.push(event));
    await initializeSession(session, proc);

    proc._stdout.push(JSON.stringify({
      method: "item/completed",
      params: {
        threadId: "thread-1",
        item: {
          type: "collabToolCall",
          id: "collab-1",
          tool: "spawnAgent",
          status: "completed",
          receiverThreadId: "thread-child",
          prompt: "Inspect auth",
        },
      },
    }) + "\n");
    proc._stdout.push(JSON.stringify({
      method: "item/completed",
      params: {
        threadId: "thread-1",
        item: {
          type: "collabToolCall",
          id: "collab-wait-1",
          tool: "wait",
          status: "completed",
          receiverThreadId: "thread-child",
        },
      },
    }) + "\n");

    const read = await waitForMethod(proc, "thread/read");
    expect(parseWrites(proc).find((write) => write.id === read.id)).toMatchObject({
      method: "thread/read",
      params: { threadId: "thread-child", includeTurns: true },
    });
    proc._stdout.push(appServerResponse(read.id, {
      thread: {
        id: "thread-child",
        turns: [{
          id: "turn-child",
          items: [{
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

    await waitForCondition(() =>
      assistantEvents.some((event) =>
        JSON.stringify(event).includes("child-cmd-1")),
    );
    expect(assistantEvents).toEqual(expect.arrayContaining([
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
    ]));
    expect(diagnostics).not.toContainEqual(expect.objectContaining({ method: "item/collabToolCall" }));
  });

  it("does not replay receiver threads when spawnAgent completes", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const session = new CodexAppServerSession();
    const resultEvents: unknown[] = [];
    session.on("result", (event) => resultEvents.push(event));
    await initializeSession(session, proc);

    // spawnAgent completes at thread creation; the child has no history yet,
    // so reading it is useless and races Codex's rollout flush.
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
    proc._stdout.push(JSON.stringify({
      method: "turn/completed",
      params: { turn: { id: "turn-1", status: "completed" } },
    }) + "\n");

    await waitForCondition(() => resultEvents.length === 1);
    expect(parseWrites(proc).filter((write) => write.method === "thread/read")).toHaveLength(0);
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

  it("ignores foreign-thread token usage updates when completing the main turn", async () => {
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
          modelContextWindow: 400_000,
        },
      },
    }) + "\n");
    proc._stdout.push(JSON.stringify({
      method: "thread/tokenUsage/updated",
      params: {
        threadId: "thread-child",
        turnId: "turn-child",
        tokenUsage: {
          last: {
            totalTokens: 1_000,
            inputTokens: 800,
            cachedInputTokens: 10,
            outputTokens: 50,
            reasoningOutputTokens: 5,
          },
          modelContextWindow: 10_000,
        },
      },
    }) + "\n");
    proc._stdout.push(JSON.stringify({
      method: "turn/completed",
      params: {
        threadId: "thread-1",
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

  it("does not surface benign too-young-thread replay errors", async () => {
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
          id: "collab-wait-1",
          tool: "wait",
          status: "completed",
          receiverThreadIds: ["thread-child"],
        },
      },
    }) + "\n");
    const firstRead = await waitForMethod(proc, "thread/read");
    proc._stdout.push(appServerError(
      firstRead.id,
      "thread thread-child is not materialized yet; includeTurns is unavailable before first user message",
    ));

    proc._stdout.push(JSON.stringify({
      method: "item/completed",
      params: {
        threadId: "thread-1",
        item: {
          type: "collabAgentToolCall",
          id: "collab-close-1",
          tool: "closeAgent",
          status: "completed",
          receiverThreadIds: ["thread-child"],
        },
      },
    }) + "\n");
    await waitForCondition(() =>
      parseWrites(proc).filter((write) => write.method === "thread/read").length === 2,
    );
    const secondRead = parseWrites(proc).filter((write) => write.method === "thread/read")[1] as { id: number };
    proc._stdout.push(appServerError(
      secondRead.id,
      "failed to read thread: thread-store internal error: failed to read thread /tmp/rollout-x.jsonl: rollout at /tmp/rollout-x.jsonl is empty",
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

  it("bounds the accumulated command output before emitting it", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const session = new CodexAppServerSession();
    const events: unknown[] = [];
    session.on("agent_event", (event) => events.push(event));
    await initializeSession(session, proc);

    const largeOutput = "x".repeat(MAX_AGENT_OUTPUT_CHARS + 2048);
    proc._stdout.push(JSON.stringify({
      method: "item/commandExecution/outputDelta",
      params: { itemId: "cmd-large", delta: largeOutput },
    }) + "\n");

    const event = events.find((entry) =>
      (entry as { type?: string; id?: string }).type === "command_execution_updated" &&
      (entry as { id?: string }).id === "cmd-large"
    ) as { output?: string; outputDelta?: string } | undefined;

    expect(event?.output).toContain("Output truncated by Hive");
    expect(event?.output?.length).toBeLessThanOrEqual(MAX_AGENT_OUTPUT_CHARS);
  });

  it("ignores plan updates from sub-agent threads", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const session = new CodexAppServerSession();
    const events: unknown[] = [];
    session.on("agent_event", (event) => events.push(event));
    await initializeSession(session, proc);

    // A sub-agent maintaining its own plan must not surface as a parasitic card
    // in the main task tracker; only the main thread's plan is emitted.
    proc._stdout.push(JSON.stringify({
      method: "turn/plan/updated",
      params: {
        threadId: "thread-child",
        turnId: "turn-child",
        plan: [{ step: "Child step", status: "inProgress" }],
      },
    }) + "\n");
    proc._stdout.push(JSON.stringify({
      method: "turn/plan/updated",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        plan: [{ step: "Run tests", status: "completed" }],
      },
    }) + "\n");

    const planEvents = events.filter((event) => (event as { type: string }).type === "plan_updated");
    expect(planEvents).toEqual([
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
