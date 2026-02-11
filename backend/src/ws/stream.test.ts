import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import WebSocket from "ws";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { createTempDir, createFixtureRepo } from "../utils/test-helpers.js";
import { createProject } from "../projects/project-manager.js";
import { createWorkspace } from "../workspaces/workspace-manager.js";
import { launchAgent, _clearActiveAgents } from "../agents/agent-manager.js";
import { streamRoutes } from "./stream.js";
import type { WsMessage } from "../types.js";

// Slow enough for WS to connect before output starts
const SLOW_CMD = {
  command: "bash",
  args: ["-c", "sleep 0.3; echo 'hello'; sleep 0.1; echo 'world'"],
};

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
  await app.register(streamRoutes);
  address = await app.listen({ port: 0, host: "127.0.0.1" });
});

afterEach(async () => {
  _clearActiveAgents();
  await new Promise((r) => setTimeout(r, 100));
  await app.close();
  await rm(tempDir, { recursive: true, force: true });
});

function connectWs(agentId: string): Promise<WebSocket> {
  const wsUrl = address.replace("http://", "ws://");
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${wsUrl}/ws/agents/${agentId}/stream`);
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

function collectMessages(ws: WebSocket, timeoutMs = 5000): Promise<WsMessage[]> {
  return new Promise((resolve) => {
    const messages: WsMessage[] = [];
    const timeout = setTimeout(() => {
      ws.close();
    }, timeoutMs);
    ws.on("message", (data) => {
      messages.push(JSON.parse(data.toString()));
    });
    ws.on("close", () => {
      clearTimeout(timeout);
      resolve(messages);
    });
  });
}

describe("WS /ws/agents/:agentId/stream", () => {
  it("streams agent output and sends exit message", async () => {
    const agent = await launchAgent(wsId, "test", dataDir, SLOW_CMD);

    const ws = await connectWs(agent.id);
    const messages = await collectMessages(ws);

    const stdoutMsgs = messages.filter((m) => m.type === "stdout");
    const exitMsg = messages.find((m) => m.type === "exit");

    expect(stdoutMsgs.length).toBeGreaterThan(0);
    const allOutput = stdoutMsgs.map((m) => m.data).join("");
    expect(allOutput).toContain("hello");
    expect(allOutput).toContain("world");

    expect(exitMsg).toBeDefined();
    expect(exitMsg!.code).toBe(0);
  });

  it("closes connection for non-existent agent", async () => {
    const ws = await connectWs("nonexistent");
    const messages = await collectMessages(ws, 2000);

    // Should receive a status message or just close
    if (messages.length > 0) {
      expect(messages[0].type).toBe("status");
    }
    // Connection should be closed
    expect(ws.readyState).toBe(WebSocket.CLOSED);
  });

  it("supports multiple clients for the same agent", async () => {
    const agent = await launchAgent(wsId, "multi", dataDir, SLOW_CMD);

    const ws1 = await connectWs(agent.id);
    const ws2 = await connectWs(agent.id);

    const [msgs1, msgs2] = await Promise.all([collectMessages(ws1), collectMessages(ws2)]);

    const out1 = msgs1.filter((m) => m.type === "stdout").map((m) => m.data).join("");
    const out2 = msgs2.filter((m) => m.type === "stdout").map((m) => m.data).join("");

    expect(out1).toContain("hello");
    expect(out2).toContain("hello");
  });
});
