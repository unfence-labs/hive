import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import WebSocket from "ws";
import type { PtyProcess } from "../services/pty-process.js";

const mocks = vi.hoisted(() => ({
  isAuthorized: vi.fn(),
  getWorkspace: vi.fn(),
  getTerminalProcess: vi.fn(),
}));

vi.mock("../utils/auth.js", () => ({
  isAuthorized: mocks.isAuthorized,
}));

vi.mock("../workspaces/workspace-manager.js", () => ({
  getWorkspace: mocks.getWorkspace,
}));

vi.mock("../services/terminal-runner.js", () => ({
  getTerminalProcess: mocks.getTerminalProcess,
}));

import { terminalWsRoutes } from "./terminal.js";

let app: FastifyInstance;

beforeEach(async () => {
  mocks.isAuthorized.mockReset();
  mocks.getWorkspace.mockReset();
  mocks.getTerminalProcess.mockReset();
  mocks.isAuthorized.mockReturnValue(true);
  mocks.getWorkspace.mockResolvedValue({
    projectState: { id: "proj-1" },
    workspace: { id: "ws-1" },
  });
  mocks.getTerminalProcess.mockReturnValue(undefined);

  app = Fastify();
  await app.register(websocket, { options: { maxPayload: 10 * 1024 * 1024 } });
  await app.register((instance: FastifyInstance) =>
    terminalWsRoutes(instance, { auth: { expectedToken: "secret" } }),
  );
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

function createMockProcess(overrides?: Partial<PtyProcess>): PtyProcess {
  const base: PtyProcess = {
    pty: {
      pid: 1234,
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      onData: vi.fn(() => ({ dispose: vi.fn() })),
      onExit: vi.fn(() => ({ dispose: vi.fn() })),
    } as unknown as PtyProcess["pty"],
    state: "running",
    outputBuffer: "",
    listeners: new Map(),
    exitListeners: new Map(),
  };

  return {
    ...base,
    ...overrides,
  };
}

async function connectTerminalWs(
  path: string,
): Promise<{
  ws: WebSocket;
  jsonMessages: Array<Record<string, unknown>>;
  binaryMessages: string[];
  closed: Promise<{ code: number; reason: Buffer }>;
}> {
  const jsonMessages: Array<Record<string, unknown>> = [];
  const binaryMessages: string[] = [];
  const ws = await app.injectWS(path, {}, {
    onInit: (clientWs) => {
      clientWs.on("message", (data: Buffer, isBinary: boolean) => {
        if (isBinary) {
          binaryMessages.push((data as Buffer).toString("utf-8"));
          return;
        }
        jsonMessages.push(JSON.parse(data.toString()) as Record<string, unknown>);
      });
    },
  });

  const closed = new Promise<{ code: number; reason: Buffer }>((resolve) => {
    ws.once("close", (code, reason) => resolve({ code, reason }));
  });
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

describe("terminal WS routes", () => {
  it("rejects unauthorized websocket connections", async () => {
    mocks.isAuthorized.mockReturnValue(false);
    const { ws, jsonMessages, closed } = await connectTerminalWs(
      "/ws/terminal/ws-1?sessionId=sess-1",
    );
    const result = await closed;

    expect(jsonMessages[0]).toEqual({ type: "error", message: "Unauthorized" });
    expect(result.code).toBe(1008);
    expect(result.reason.toString()).toBe("Unauthorized");
    ws.terminate();
  });

  it("rejects missing sessionId", async () => {
    const { ws, jsonMessages, closed } = await connectTerminalWs("/ws/terminal/ws-1");
    const result = await closed;

    expect(jsonMessages[0]).toEqual({
      type: "error",
      message: "Missing 'sessionId' query param",
    });
    expect(result.code).toBe(1008);
    expect(result.reason.toString()).toBe("Invalid sessionId");
    ws.terminate();
  });

  it("returns error when workspace does not exist", async () => {
    mocks.getWorkspace.mockResolvedValue(null);
    const { ws, jsonMessages, closed } = await connectTerminalWs(
      "/ws/terminal/ws-1?sessionId=sess-1",
    );
    const result = await closed;

    expect(jsonMessages[0]).toEqual({ type: "error", message: "Workspace not found" });
    expect(result.code).toBe(1008);
    expect(result.reason.toString()).toBe("Workspace not found");
    ws.terminate();
  });

  it("returns error when no terminal process exists", async () => {
    mocks.getTerminalProcess.mockReturnValue(undefined);
    const { ws, jsonMessages, closed } = await connectTerminalWs(
      "/ws/terminal/ws-1?sessionId=sess-1",
    );
    const result = await closed;

    expect(jsonMessages[0]).toEqual({
      type: "error",
      message: "No terminal process found",
    });
    expect(result.code).toBe(1008);
    expect(result.reason.toString()).toBe("No terminal process");
    ws.terminate();
  });

  it("resolves the PTY by session id", async () => {
    const proc = createMockProcess({ state: "running" });
    mocks.getTerminalProcess.mockReturnValue(proc);

    const { ws, jsonMessages } = await connectTerminalWs(
      "/ws/terminal/ws-1?sessionId=sess-1",
    );
    await waitForCondition(() => jsonMessages.some((m) => m.type === "ready"));

    expect(mocks.getTerminalProcess).toHaveBeenCalledWith("ws-1", "sess-1");
    ws.terminate();
  });

  it("replays buffered output and sends immediate exit for finished processes", async () => {
    const proc = createMockProcess({
      state: "done",
      exitCode: 0,
      outputBuffer: "line-1\r\nline-2\r\n",
    });
    mocks.getTerminalProcess.mockReturnValue(proc);

    const { ws, jsonMessages, binaryMessages } = await connectTerminalWs(
      "/ws/terminal/ws-1?sessionId=sess-1",
    );
    await waitForCondition(() => binaryMessages.length > 0 && jsonMessages.length > 0);

    expect(binaryMessages[0]).toBe("line-1\r\nline-2\r\n");
    expect(jsonMessages).toContainEqual({ type: "exit", code: 0 });
    expect(jsonMessages).not.toContainEqual({ type: "ready" });
    expect(proc.listeners.size).toBe(0);
    expect(proc.exitListeners.size).toBe(0);
    ws.terminate();
  });

  it("streams live output, forwards terminal input, and reports exit", async () => {
    const proc = createMockProcess({
      state: "running",
      outputBuffer: "boot",
    });
    mocks.getTerminalProcess.mockReturnValue(proc);

    const { ws, jsonMessages, binaryMessages } = await connectTerminalWs(
      "/ws/terminal/ws-1?sessionId=sess-1",
    );
    await new Promise((r) => setTimeout(r, 25));
    expect(jsonMessages).toContainEqual({ type: "ready" });

    expect(binaryMessages[0]).toBe("boot");
    expect(proc.listeners.size).toBe(1);
    expect(proc.exitListeners.size).toBe(1);

    ws.send(Buffer.from("ls\n"), { binary: true });
    ws.send(JSON.stringify({ type: "resize", cols: 100, rows: 40 }));

    const liveListener = [...proc.listeners.values()][0];
    expect(liveListener).toBeDefined();
    liveListener?.("live\n");

    const exitListener = [...proc.exitListeners.values()][0];
    expect(exitListener).toBeDefined();
    exitListener?.(3);

    await new Promise((r) => setTimeout(r, 25));
    expect(binaryMessages.some((m) => m.includes("live"))).toBe(true);
    expect(jsonMessages.some((m) => m.type === "exit" && m.code === 3)).toBe(true);

    ws.terminate();
  });
});
