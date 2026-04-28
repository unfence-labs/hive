import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import { createServer } from "node:net";
import WebSocket, { WebSocketServer } from "ws";
import { browserSessionManager } from "../services/browser-session-manager.js";
import { browserWsRoutes, type BrowserViewportSetter } from "./browser.js";
import type { BrowserStatusPayload } from "../types.js";

let app: FastifyInstance;
let upstream: WebSocketServer | undefined;
let setViewport: Mock<BrowserViewportSetter>;

beforeEach(async () => {
  browserSessionManager._clearForTests();
  setViewport = vi.fn<BrowserViewportSetter>().mockResolvedValue(undefined);
  app = Fastify();
  await app.register(websocket, { options: { maxPayload: 10 * 1024 * 1024 } });
  await app.register((instance: FastifyInstance) => browserWsRoutes(instance, { authToken: "secret", setViewport }));
  await app.ready();
});

afterEach(async () => {
  upstream?.close();
  upstream = undefined;
  browserSessionManager._clearForTests();
  await app.close();
});

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

async function allocatePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve, reject) => {
    server.close((err) => err ? reject(err) : resolve());
  });
  if (!port) throw new Error("Failed to allocate port");
  return port;
}

async function startUpstream(port = 0): Promise<{ port: number; messages: string[] }> {
  const messages: string[] = [];
  upstream = new WebSocketServer({ host: "127.0.0.1", port });
  await new Promise<void>((resolve) => upstream?.once("listening", resolve));
  upstream.on("connection", (socket) => {
    socket.on("message", (data) => {
      messages.push(data.toString());
    });
  });
  const address = upstream.address();
  if (typeof address !== "object" || !address) throw new Error("Missing upstream address");
  return { port: address.port, messages };
}

async function connectBrowserWs(path: string): Promise<{
  ws: WebSocket;
  jsonMessages: Array<Record<string, unknown>>;
  closed: Promise<{ code: number; reason: Buffer }>;
}> {
  const jsonMessages: Array<Record<string, unknown>> = [];
  const ws = await app.injectWS(path, {}, {
    onInit: (clientWs) => {
      clientWs.on("message", (data: Buffer) => {
        jsonMessages.push(JSON.parse(data.toString()) as Record<string, unknown>);
      });
    },
  });
  const closed = new Promise<{ code: number; reason: Buffer }>((resolve) => {
    ws.once("close", (code, reason) => resolve({ code, reason }));
  });
  return { ws, jsonMessages, closed };
}

describe("browser WS route", () => {
  it("rejects unauthorized websocket connections", async () => {
    browserSessionManager._registerForTests("ws-1", "session-1", 1234, "active");
    const { ws, jsonMessages, closed } = await connectBrowserWs("/ws/browser/ws-1/session-1");
    const result = await closed;

    expect(jsonMessages[0]).toEqual({ type: "error", message: "Unauthorized" });
    expect(result.code).toBe(1008);
    ws.terminate();
  });

  it("rejects unknown browser sessions", async () => {
    const { ws, jsonMessages, closed } = await connectBrowserWs("/ws/browser/ws-1/missing?token=secret");
    const result = await closed;

    expect(jsonMessages[0]).toEqual({ type: "error", message: "Browser session not found" });
    expect(result.code).toBe(1008);
    ws.terminate();
  });

  it("proxies upstream stream messages and ignores client input", async () => {
    const upstreamInfo = await startUpstream();
    browserSessionManager._registerForTests("ws-1", "session-1", upstreamInfo.port, "active");

    const { ws, jsonMessages } = await connectBrowserWs("/ws/browser/ws-1/session-1?token=secret");
    await waitForCondition(() => (upstream?.clients.size ?? 0) === 1);
    const upstreamClient = Array.from(upstream!.clients)[0];
    upstreamClient.send(JSON.stringify({ type: "url", url: "http://localhost:5173" }));
    ws.send(JSON.stringify({ type: "click", x: 10, y: 10 }));

    await waitForCondition(() => jsonMessages.length > 0);
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(jsonMessages[0]).toEqual({ type: "url", url: "http://localhost:5173" });
    expect(upstreamInfo.messages).toHaveLength(0);
    ws.terminate();
  });

  it("handles viewport resize messages without forwarding them upstream", async () => {
    const upstreamInfo = await startUpstream();
    browserSessionManager._registerForTests("ws-1", "session-1", upstreamInfo.port, "active");

    const { ws } = await connectBrowserWs("/ws/browser/ws-1/session-1?token=secret");
    await waitForCondition(() => (upstream?.clients.size ?? 0) === 1);
    ws.send(JSON.stringify({ type: "viewport_resize", width: 420.4, height: 260.2 }));

    await waitForCondition(() => setViewport.mock.calls.length === 1);
    expect(setViewport).toHaveBeenCalledWith("ws-1", "session-1", { width: 420, height: 260 });
    expect(upstreamInfo.messages).toHaveLength(0);
    ws.terminate();
  });

  it("marks the browser stream as stopped when the upstream stream closes", async () => {
    const upstreamInfo = await startUpstream();
    browserSessionManager._registerForTests("ws-1", "session-1", upstreamInfo.port, "active");
    browserSessionManager.markStreaming("ws-1", "session-1", true);
    const statuses: BrowserStatusPayload[] = [];
    browserSessionManager.on("status", (_workspaceId, status) => statuses.push(status));

    const { ws } = await connectBrowserWs("/ws/browser/ws-1/session-1?token=secret");
    await waitForCondition(() => (upstream?.clients.size ?? 0) === 1);
    Array.from(upstream!.clients)[0].close();

    await waitForCondition(() => statuses.some((status) => status.streaming === false));
    expect(statuses.at(-1)).toMatchObject({
      sessionId: "session-1",
      state: "active",
      streaming: false,
    });
    ws.terminate();
  });

  it("waits for the agent-browser upstream to become ready before marking the stream stopped", async () => {
    const port = await allocatePort();
    browserSessionManager._registerForTests("ws-1", "session-1", port, "active");
    browserSessionManager.markStreaming("ws-1", "session-1", true);
    const statuses: BrowserStatusPayload[] = [];
    browserSessionManager.on("status", (_workspaceId, status) => statuses.push(status));

    const { ws, jsonMessages } = await connectBrowserWs("/ws/browser/ws-1/session-1?token=secret");
    await new Promise((resolve) => setTimeout(resolve, 75));
    expect(statuses.some((status) => status.streaming === false)).toBe(false);

    await startUpstream(port);
    await waitForCondition(() => (upstream?.clients.size ?? 0) === 1);
    const upstreamClient = Array.from(upstream!.clients)[0];
    upstreamClient.send(JSON.stringify({
      type: "status",
      connected: true,
      screencasting: false,
    }));
    upstreamClient.send(JSON.stringify({
      type: "frame",
      data: "abc123",
    }));

    await waitForCondition(() => jsonMessages.some((message) => message.type === "frame"));
    expect(statuses.some((status) => status.streaming === false)).toBe(false);
    expect(statuses.at(-1)).toMatchObject({
      sessionId: "session-1",
      state: "active",
      streaming: true,
    });
    ws.terminate();
  });

  it("reconnects when upstream accepts before the browser has launched", async () => {
    const upstreamInfo = await startUpstream();
    browserSessionManager._registerForTests("ws-1", "session-1", upstreamInfo.port, "active");
    browserSessionManager.markStreaming("ws-1", "session-1", true);
    const statuses: BrowserStatusPayload[] = [];
    browserSessionManager.on("status", (_workspaceId, status) => statuses.push(status));
    let connectionCount = 0;
    upstream!.on("connection", (socket) => {
      connectionCount += 1;
      if (connectionCount === 1) {
        socket.send(JSON.stringify({ type: "error", message: "Browser not launched" }));
        return;
      }
      socket.send(JSON.stringify({ type: "frame", data: "ready" }));
    });

    const { ws, jsonMessages } = await connectBrowserWs("/ws/browser/ws-1/session-1?token=secret");

    await waitForCondition(() => jsonMessages.some((message) => message.type === "frame"));
    expect(connectionCount).toBeGreaterThanOrEqual(2);
    expect(jsonMessages.some((message) => message.type === "error")).toBe(false);
    expect(statuses.some((status) => status.streaming === false)).toBe(false);
    ws.terminate();
  });
});
