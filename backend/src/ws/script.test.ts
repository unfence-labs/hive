import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import WebSocket from "ws";
import type { ScriptProcess } from "../services/script-runner.js";

const mocks = vi.hoisted(() => ({
  isAuthorized: vi.fn(),
  getWorkspace: vi.fn(),
  getScriptProcess: vi.fn(),
}));

vi.mock("../utils/auth.js", () => ({
  isAuthorized: mocks.isAuthorized,
}));

vi.mock("../workspaces/workspace-manager.js", () => ({
  getWorkspace: mocks.getWorkspace,
}));

vi.mock("../services/script-runner.js", () => ({
  getScriptProcess: mocks.getScriptProcess,
}));

import { scriptWsRoutes } from "./script.js";

let app: FastifyInstance;
let address: string;

beforeEach(async () => {
  mocks.isAuthorized.mockReset();
  mocks.getWorkspace.mockReset();
  mocks.getScriptProcess.mockReset();
  mocks.isAuthorized.mockReturnValue(true);
  mocks.getWorkspace.mockResolvedValue({
    projectState: { id: "proj-1" },
    workspace: { id: "ws-1" },
  });
  mocks.getScriptProcess.mockReturnValue(undefined);

  app = Fastify();
  await app.register(websocket, { options: { maxPayload: 10 * 1024 * 1024 } });
  await app.register((instance: FastifyInstance) =>
    scriptWsRoutes(instance, { authToken: "secret" }),
  );
  address = await app.listen({ port: 0, host: "127.0.0.1" });
});

afterEach(async () => {
  await app.close();
});

function createMockProcess(overrides?: Partial<ScriptProcess>): ScriptProcess {
  const base: ScriptProcess = {
    pty: {
      pid: 1234,
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      onData: vi.fn(() => ({ dispose: vi.fn() })),
      onExit: vi.fn(() => ({ dispose: vi.fn() })),
    } as unknown as ScriptProcess["pty"],
    type: "setup",
    state: "running",
    outputBuffer: [],
    listeners: new Map(),
    exitListeners: new Map(),
  };

  return {
    ...base,
    ...overrides,
  };
}

async function connectScriptWs(
  path: string,
): Promise<{
  ws: WebSocket;
  jsonMessages: Array<Record<string, unknown>>;
  binaryMessages: string[];
  closed: Promise<{ code: number; reason: Buffer }>;
}> {
  const url = address.replace("http://", "ws://");
  const ws = new WebSocket(`${url}${path}`);
  const jsonMessages: Array<Record<string, unknown>> = [];
  const binaryMessages: string[] = [];

  ws.on("message", (data, isBinary) => {
    if (isBinary) {
      binaryMessages.push((data as Buffer).toString("utf-8"));
      return;
    }
    jsonMessages.push(JSON.parse(data.toString()) as Record<string, unknown>);
  });

  const opened = new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  const closed = new Promise<{ code: number; reason: Buffer }>((resolve) => {
    ws.once("close", (code, reason) => resolve({ code, reason }));
  });

  await opened;
  return { ws, jsonMessages, binaryMessages, closed };
}

function waitForCondition(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      clearInterval(interval);
      reject(new Error("Timed out waiting for condition"));
    }, timeoutMs);

    const interval = setInterval(() => {
      if (!predicate()) return;
      clearTimeout(timer);
      clearInterval(interval);
      resolve();
    }, 10);
  });
}

describe("script WS routes", () => {
  it("rejects unauthorized websocket connections", async () => {
    mocks.isAuthorized.mockReturnValue(false);
    const { ws, jsonMessages, closed } = await connectScriptWs("/ws/script/ws-1?type=setup");
    const result = await closed;

    expect(jsonMessages[0]).toEqual({ type: "error", message: "Unauthorized" });
    expect(result.code).toBe(1008);
    expect(result.reason.toString()).toBe("Unauthorized");
    ws.terminate();
  });

  it("rejects missing or invalid script type", async () => {
    const { ws, jsonMessages, closed } = await connectScriptWs("/ws/script/ws-1");
    const result = await closed;

    expect(jsonMessages[0]).toEqual({
      type: "error",
      message: "Missing 'type' query param",
    });
    expect(result.code).toBe(1008);
    expect(result.reason.toString()).toBe("Invalid type");
    ws.terminate();
  });

  it("returns error when workspace does not exist", async () => {
    mocks.getWorkspace.mockResolvedValue(null);
    const { ws, jsonMessages, closed } = await connectScriptWs("/ws/script/ws-1?type=setup");
    const result = await closed;

    expect(jsonMessages[0]).toEqual({ type: "error", message: "Workspace not found" });
    expect(result.code).toBe(1008);
    expect(result.reason.toString()).toBe("Workspace not found");
    ws.terminate();
  });

  it("returns error when no script process exists", async () => {
    mocks.getScriptProcess.mockReturnValue(undefined);
    const { ws, jsonMessages, closed } = await connectScriptWs("/ws/script/ws-1?type=setup");
    const result = await closed;

    expect(jsonMessages[0]).toEqual({
      type: "error",
      message: "No setup script process found",
    });
    expect(result.code).toBe(1008);
    expect(result.reason.toString()).toBe("No script process");
    ws.terminate();
  });

  it("replays buffered output and sends immediate exit for finished scripts", async () => {
    const proc = createMockProcess({
      state: "done",
      exitCode: 0,
      outputBuffer: ["line-1", "line-2"],
    });
    mocks.getScriptProcess.mockReturnValue(proc);

    const { ws, jsonMessages, binaryMessages } = await connectScriptWs("/ws/script/ws-1?type=setup");
    await waitForCondition(() => binaryMessages.length > 0 && jsonMessages.length > 0);

    expect(binaryMessages[0]).toBe("line-1\nline-2");
    expect(jsonMessages).toContainEqual({ type: "exit", code: 0 });
    expect(jsonMessages).not.toContainEqual({ type: "ready" });
    expect(proc.listeners.size).toBe(0);
    expect(proc.exitListeners.size).toBe(0);
    ws.terminate();
  });

  it("streams live output, forwards terminal input, and cleans listeners on close", async () => {
    const proc = createMockProcess({
      state: "running",
      type: "run",
      outputBuffer: ["boot"],
    });
    mocks.getScriptProcess.mockReturnValue(proc);

    const { ws, jsonMessages, binaryMessages } = await connectScriptWs("/ws/script/ws-1?type=run");
    await waitForCondition(() => jsonMessages.some((m) => m.type === "ready"));

    expect(binaryMessages[0]).toBe("boot");
    expect(proc.listeners.size).toBe(1);
    expect(proc.exitListeners.size).toBe(1);

    ws.send(Buffer.from("y\n"));
    await waitForCondition(() => (proc.pty.write as ReturnType<typeof vi.fn>).mock.calls.length > 0);
    expect(proc.pty.write).toHaveBeenCalledWith("y\n");

    ws.send(JSON.stringify({ type: "resize", cols: 999, rows: 0 }));
    await waitForCondition(() => (proc.pty.resize as ReturnType<typeof vi.fn>).mock.calls.length > 0);
    expect(proc.pty.resize).toHaveBeenCalledWith(500, 1);

    ws.send("not-json");

    const liveListener = [...proc.listeners.values()][0];
    expect(liveListener).toBeDefined();
    liveListener?.("live\n");

    const exitListener = [...proc.exitListeners.values()][0];
    expect(exitListener).toBeDefined();
    exitListener?.(3);

    await waitForCondition(() =>
      binaryMessages.some((m) => m.includes("live")) &&
      jsonMessages.some((m) => m.type === "exit" && m.code === 3),
    );

    ws.close();
    await waitForCondition(() => proc.listeners.size === 0 && proc.exitListeners.size === 0);
  });
});
