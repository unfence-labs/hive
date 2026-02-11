import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import WebSocket from "ws";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { createTempDir, createFixtureRepo } from "../utils/test-helpers.js";
import { createProject } from "../projects/project-manager.js";
import { createWorkspace } from "../workspaces/workspace-manager.js";
import {
  getOrCreateSession,
  sendMessage,
  endSession,
  _clearActiveSessions,
} from "../agents/agent-manager.js";
import { streamRoutes } from "./stream.js";
import type { WsOutgoing } from "../types.js";

const CONV_CMD = { command: "bash" };

let tempDir: string;
let dataDir: string;
let app: ReturnType<typeof Fastify>;
let address: string;
let projectId: string;
let wsId: string;

beforeEach(async () => {
  tempDir = await createTempDir("hive-ws-stream-test-");
  dataDir = join(tempDir, "data");
  const fixtureDir = join(tempDir, "fixtures");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(dataDir, { recursive: true });
  await mkdir(fixtureDir, { recursive: true });
  const fixtureRepoUrl = await createFixtureRepo(fixtureDir);

  const project = await createProject(fixtureRepoUrl, dataDir);
  projectId = project.id;
  const workspace = await createWorkspace(projectId, dataDir);
  wsId = workspace.id;

  app = Fastify();
  await app.register(websocket);
  await app.register((instance: typeof app) =>
    streamRoutes(instance, { dataDir, sessionOptions: CONV_CMD }),
  );
  address = await app.listen({ port: 0, host: "127.0.0.1" });
});

afterEach(async () => {
  _clearActiveSessions();
  await new Promise((r) => setTimeout(r, 100));
  await app.close();
  await rm(tempDir, { recursive: true, force: true });
});

/** Connect a WebSocket and start collecting messages immediately. */
function connectSessionWs(workspaceId: string): {
  wsReady: Promise<WebSocket>;
  messages: WsOutgoing[];
} {
  const wsUrl = address.replace("http://", "ws://");
  const messages: WsOutgoing[] = [];
  const ws = new WebSocket(`${wsUrl}/ws/session/${workspaceId}`);
  ws.on("message", (data) => {
    messages.push(JSON.parse(data.toString()) as WsOutgoing);
  });
  const wsReady = new Promise<WebSocket>((resolve, reject) => {
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
  return { wsReady, messages };
}

/** Wait until a condition is met on the collected messages. */
function waitForMessage(
  messages: WsOutgoing[],
  predicate: (msgs: WsOutgoing[]) => boolean,
  timeoutMs = 3000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const interval = setInterval(() => {
      if (predicate(messages)) {
        clearInterval(interval);
        clearTimeout(timeout);
        resolve();
      }
    }, 20);
    const timeout = setTimeout(() => {
      clearInterval(interval);
      reject(new Error(`Timeout waiting for message. Got: ${JSON.stringify(messages)}`));
    }, timeoutMs);
  });
}

describe("WS /ws/session/:wsId", () => {
  it("sends idle status when no session exists", async () => {
    const { wsReady, messages } = connectSessionWs(wsId);
    const ws = await wsReady;

    await waitForMessage(messages, (msgs) => msgs.length >= 1);

    expect(messages[0]).toEqual({ type: "status", status: "idle", streaming: false });
    ws.close();
  });

  it("sends busy status + history when session exists", async () => {
    await getOrCreateSession(wsId, dataDir, CONV_CMD);

    const { wsReady, messages } = connectSessionWs(wsId);
    const ws = await wsReady;

    await waitForMessage(messages, (msgs) => msgs.length >= 1);

    expect(messages[0].type).toBe("status");
    if (messages[0].type === "status") {
      expect(messages[0].status).toBe("busy");
      expect(messages[0].sessionId).toBeTruthy();
      expect(messages[0].streaming).toBe(false);
    }

    ws.close();
    await endSession(wsId, dataDir);
  });

  it("auto-creates session on user_message", async () => {
    const { wsReady, messages } = connectSessionWs(wsId);
    const ws = await wsReady;

    await waitForMessage(messages, (msgs) => msgs.length >= 1); // initial status

    // Send user message — auto-creates session
    ws.send(JSON.stringify({ type: "user_message", content: "Hello" }));

    // Should get a status update with sessionId
    await waitForMessage(
      messages,
      (msgs) => msgs.some((m) => m.type === "status" && "sessionId" in m && m.sessionId),
    ).catch(() => {});

    // Session should exist now
    const statusMsgs = messages.filter(
      (m) => m.type === "status" && "sessionId" in m && m.sessionId,
    );
    expect(statusMsgs.length).toBeGreaterThanOrEqual(1);
    expect(
      statusMsgs.some((m) => m.type === "status" && m.streaming === true),
    ).toBe(true);

    ws.close();
    await endSession(wsId, dataDir).catch(() => {});
  });

  it("handles invalid JSON from client", async () => {
    await getOrCreateSession(wsId, dataDir, CONV_CMD);
    const { wsReady, messages } = connectSessionWs(wsId);
    const ws = await wsReady;

    await waitForMessage(messages, (msgs) => msgs.length >= 1);

    ws.send("not json at all");

    await waitForMessage(messages, (msgs) => msgs.some((m) => m.type === "error"));

    const errorMsg = messages.find((m) => m.type === "error");
    expect(errorMsg).toBeDefined();
    if (errorMsg?.type === "error") {
      expect(errorMsg.message).toContain("Invalid JSON");
    }

    ws.close();
    await endSession(wsId, dataDir);
  });

  it("handles stop command without error", async () => {
    await getOrCreateSession(wsId, dataDir, CONV_CMD);
    const { wsReady, messages } = connectSessionWs(wsId);
    const ws = await wsReady;

    await waitForMessage(messages, (msgs) => msgs.length >= 1);

    // Stop when not streaming — no-op, no error
    ws.send(JSON.stringify({ type: "stop" }));

    await new Promise((r) => setTimeout(r, 100));

    expect(ws.readyState).toBe(WebSocket.OPEN);

    ws.close();
    await endSession(wsId, dataDir);
  });

  it("broadcasts session events to multiple connected clients", async () => {
    await getOrCreateSession(wsId, dataDir, CONV_CMD);

    const first = connectSessionWs(wsId);
    const second = connectSessionWs(wsId);
    const ws1 = await first.wsReady;
    const ws2 = await second.wsReady;

    await waitForMessage(first.messages, (msgs) => msgs.length >= 1);
    await waitForMessage(second.messages, (msgs) => msgs.length >= 1);

    const firstCount = first.messages.length;
    const secondCount = second.messages.length;

    await sendMessage(wsId, "Hello from test", dataDir, CONV_CMD);

    await waitForMessage(first.messages, (msgs) => msgs.length > firstCount);
    await waitForMessage(second.messages, (msgs) => msgs.length > secondCount);

    const firstNew = first.messages.slice(firstCount);
    const secondNew = second.messages.slice(secondCount);
    expect(firstNew.length).toBeGreaterThan(0);
    expect(secondNew.length).toBeGreaterThan(0);

    ws1.close();
    ws2.close();
    await endSession(wsId, dataDir);
  });
});
