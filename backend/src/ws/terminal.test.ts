import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import WebSocket from "ws";

// ── Mocks ────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  isAuthorized: vi.fn(),
  getWorkspace: vi.fn(),
  ptySpawn: vi.fn(),
  getDataDir: vi.fn(),
}));

vi.mock("../utils/auth.js", () => ({
  isAuthorized: mocks.isAuthorized,
}));

vi.mock("../workspaces/workspace-manager.js", () => ({
  getWorkspace: mocks.getWorkspace,
}));

vi.mock("../state/state.js", () => ({
  getDataDir: mocks.getDataDir,
}));

// Build a fake PTY that can emit data and exit events
function createFakePty() {
  let dataHandler: ((data: string) => void) | null = null;
  let exitHandler: ((e: { exitCode: number }) => void) | null = null;
  const killed = { value: false };

  return {
    instance: {
      onData: vi.fn((cb: (data: string) => void) => {
        dataHandler = cb;
      }),
      onExit: vi.fn((cb: (e: { exitCode: number }) => void) => {
        exitHandler = cb;
      }),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(() => {
        killed.value = true;
      }),
    },
    emitData: (data: string) => dataHandler?.(data),
    emitExit: (exitCode: number) => exitHandler?.({ exitCode }),
    killed,
  };
}

vi.mock("node-pty", () => ({
  default: { spawn: mocks.ptySpawn },
  spawn: mocks.ptySpawn,
}));

import { terminalRoutes, _clearActivePtys } from "./terminal.js";

let app: FastifyInstance;
let address: string;

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.isAuthorized.mockReturnValue(true);
  mocks.getDataDir.mockReturnValue("/tmp/test-data");
  mocks.getWorkspace.mockResolvedValue({
    projectState: { id: "proj-1" },
    workspace: { name: "workspace-tokyo" },
  });

  const fake = createFakePty();
  mocks.ptySpawn.mockReturnValue(fake.instance);

  app = Fastify();
  await app.register(websocket, { options: { maxPayload: 10 * 1024 * 1024 } });
  await app.register((instance: FastifyInstance) =>
    terminalRoutes(instance, { authToken: "secret", dataDir: "/tmp/test-data" }),
  );
  address = await app.listen({ port: 0, host: "127.0.0.1" });
});

afterEach(async () => {
  _clearActivePtys();
  await app.close();
});

async function connectTerminalWs(
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
    try {
      jsonMessages.push(JSON.parse(data.toString()) as Record<string, unknown>);
    } catch {
      // ignore non-JSON text frames
    }
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

describe("terminal WS routes", () => {
  it("rejects unauthorized connections", async () => {
    mocks.isAuthorized.mockReturnValue(false);
    const { ws, jsonMessages, closed } = await connectTerminalWs("/ws/terminal/ws-1");
    const result = await closed;

    expect(jsonMessages[0]).toEqual({ type: "error", message: "Unauthorized" });
    expect(result.code).toBe(1008);
    ws.terminate();
  });

  it("rejects unknown workspace", async () => {
    mocks.getWorkspace.mockResolvedValue(null);
    const { ws, jsonMessages, closed } = await connectTerminalWs("/ws/terminal/ws-unknown");
    const result = await closed;

    expect(jsonMessages[0]).toEqual({ type: "error", message: "Workspace not found" });
    expect(result.code).toBe(1008);
    ws.terminate();
  });

  it("sends ready message after successful connection", async () => {
    const fake = createFakePty();
    mocks.ptySpawn.mockReturnValue(fake.instance);

    const { ws, jsonMessages } = await connectTerminalWs("/ws/terminal/ws-1");
    await waitForCondition(() => jsonMessages.some((m) => m.type === "ready"));

    expect(jsonMessages).toContainEqual({ type: "ready" });
    ws.close();
  });

  it("spawns PTY with correct shell and cwd", async () => {
    const fake = createFakePty();
    mocks.ptySpawn.mockReturnValue(fake.instance);

    const { ws } = await connectTerminalWs("/ws/terminal/ws-1");
    await waitForCondition(() => mocks.ptySpawn.mock.calls.length > 0);

    const spawnCall = mocks.ptySpawn.mock.calls[0];
    expect(spawnCall[1]).toEqual(["-l"]); // login shell
    expect(spawnCall[2].cols).toBe(80);
    expect(spawnCall[2].rows).toBe(24);
    expect(spawnCall[2].cwd).toContain("workspace-tokyo");
    ws.close();
  });

  it("forwards PTY output as binary WebSocket frames", async () => {
    const fake = createFakePty();
    mocks.ptySpawn.mockReturnValue(fake.instance);

    const { ws, binaryMessages } = await connectTerminalWs("/ws/terminal/ws-1");
    await waitForCondition(() => mocks.ptySpawn.mock.calls.length > 0);

    fake.emitData("hello world");
    await waitForCondition(() => binaryMessages.length > 0);

    expect(binaryMessages[0]).toBe("hello world");
    ws.close();
  });

  it("forwards binary WebSocket messages to PTY write", async () => {
    const fake = createFakePty();
    mocks.ptySpawn.mockReturnValue(fake.instance);

    const { ws } = await connectTerminalWs("/ws/terminal/ws-1");
    await waitForCondition(() => mocks.ptySpawn.mock.calls.length > 0);

    ws.send(Buffer.from("ls -la\n"));
    await waitForCondition(() => fake.instance.write.mock.calls.length > 0);

    expect(fake.instance.write).toHaveBeenCalledWith("ls -la\n");
    ws.close();
  });

  it("handles resize messages with value clamping", async () => {
    const fake = createFakePty();
    mocks.ptySpawn.mockReturnValue(fake.instance);

    const { ws } = await connectTerminalWs("/ws/terminal/ws-1");
    await waitForCondition(() => mocks.ptySpawn.mock.calls.length > 0);

    // Normal resize
    ws.send(JSON.stringify({ type: "resize", cols: 120, rows: 40 }));
    await waitForCondition(() => fake.instance.resize.mock.calls.length > 0);
    expect(fake.instance.resize).toHaveBeenCalledWith(120, 40);

    // Resize with out-of-range values → clamped
    ws.send(JSON.stringify({ type: "resize", cols: 999, rows: 0 }));
    await waitForCondition(() => fake.instance.resize.mock.calls.length > 1);
    expect(fake.instance.resize).toHaveBeenCalledWith(500, 1);

    ws.close();
  });

  it("ignores malformed JSON messages silently", async () => {
    const fake = createFakePty();
    mocks.ptySpawn.mockReturnValue(fake.instance);

    const { ws, jsonMessages } = await connectTerminalWs("/ws/terminal/ws-1");
    await waitForCondition(() => jsonMessages.some((m) => m.type === "ready"));

    // Send invalid JSON — should not crash
    ws.send("not-json{{{");
    // Send a valid resize after to verify connection still works
    ws.send(JSON.stringify({ type: "resize", cols: 100, rows: 50 }));
    await waitForCondition(() => fake.instance.resize.mock.calls.length > 0);

    expect(fake.instance.resize).toHaveBeenCalledWith(100, 50);
    ws.close();
  });

  it("ignores non-resize JSON messages", async () => {
    const fake = createFakePty();
    mocks.ptySpawn.mockReturnValue(fake.instance);

    const { ws } = await connectTerminalWs("/ws/terminal/ws-1");
    await waitForCondition(() => mocks.ptySpawn.mock.calls.length > 0);

    ws.send(JSON.stringify({ type: "unknown", data: "test" }));
    // Small wait to ensure nothing crashes
    await new Promise((r) => setTimeout(r, 50));

    expect(fake.instance.resize).not.toHaveBeenCalled();
    ws.close();
  });

  it("sends exit message when PTY exits", async () => {
    const fake = createFakePty();
    mocks.ptySpawn.mockReturnValue(fake.instance);

    const { ws, jsonMessages } = await connectTerminalWs("/ws/terminal/ws-1");
    await waitForCondition(() => jsonMessages.some((m) => m.type === "ready"));

    fake.emitExit(0);
    await waitForCondition(() => jsonMessages.some((m) => m.type === "exit"));

    expect(jsonMessages).toContainEqual({ type: "exit", code: 0 });
    ws.close();
  });

  it("sends non-zero exit code when PTY exits with error", async () => {
    const fake = createFakePty();
    mocks.ptySpawn.mockReturnValue(fake.instance);

    const { ws, jsonMessages } = await connectTerminalWs("/ws/terminal/ws-1");
    await waitForCondition(() => jsonMessages.some((m) => m.type === "ready"));

    fake.emitExit(127);
    await waitForCondition(() => jsonMessages.some((m) => m.type === "exit"));

    expect(jsonMessages).toContainEqual({ type: "exit", code: 127 });
    ws.close();
  });

  it("kills PTY when WebSocket closes", async () => {
    const fake = createFakePty();
    mocks.ptySpawn.mockReturnValue(fake.instance);

    const { ws, closed } = await connectTerminalWs("/ws/terminal/ws-1");
    await waitForCondition(() => mocks.ptySpawn.mock.calls.length > 0);

    ws.close();
    await closed;
    // Give cleanup a moment
    await new Promise((r) => setTimeout(r, 50));

    expect(fake.instance.kill).toHaveBeenCalled();
  });

  it("kills existing PTY when new connection arrives for same workspace", async () => {
    const fake1 = createFakePty();
    const fake2 = createFakePty();

    mocks.ptySpawn
      .mockReturnValueOnce(fake1.instance)
      .mockReturnValueOnce(fake2.instance);

    const conn1 = await connectTerminalWs("/ws/terminal/ws-1");
    await waitForCondition(() => conn1.jsonMessages.some((m) => m.type === "ready"));

    // Second connection should kill the first PTY
    const conn2 = await connectTerminalWs("/ws/terminal/ws-1");
    await waitForCondition(() => conn2.jsonMessages.some((m) => m.type === "ready"));

    expect(fake1.instance.kill).toHaveBeenCalled();

    conn1.ws.terminate();
    conn2.ws.close();
  });

  it("sends error and closes 1011 when PTY spawn fails", async () => {
    mocks.ptySpawn.mockImplementation(() => {
      throw new Error("spawn failed: ENOENT");
    });

    const { ws, jsonMessages, closed } = await connectTerminalWs("/ws/terminal/ws-1");
    const result = await closed;

    expect(jsonMessages[0]).toEqual({ type: "error", message: "spawn failed: ENOENT" });
    expect(result.code).toBe(1011);
    ws.terminate();
  });

  it("supports query token for auth", async () => {
    mocks.isAuthorized.mockImplementation(
      (_headers: unknown, _authToken: unknown, queryToken: unknown) => queryToken === "secret",
    );

    const { ws, jsonMessages } = await connectTerminalWs("/ws/terminal/ws-1?token=secret");
    await waitForCondition(() => jsonMessages.some((m) => m.type === "ready"));

    expect(jsonMessages).toContainEqual({ type: "ready" });
    ws.close();
  });
});
