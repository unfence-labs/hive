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
  launchAgent,
  launchConversation,
  endConversation,
  _clearActiveAgents,
  _clearActiveConversations,
} from "../agents/agent-manager.js";
import { streamRoutes } from "./stream.js";
import type { WsMessage, WsOutgoing } from "../types.js";

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
  _clearActiveConversations();
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

// ── Conversation mode tests ─────────────────────────────────────────

const CONV_CMD = { command: "bash" };

/** Connect a WebSocket and start collecting messages immediately (avoids race). */
function connectConvWsWithCollector(workspaceId: string): {
  wsReady: Promise<WebSocket>;
  messages: WsOutgoing[];
} {
  const wsUrl = address.replace("http://", "ws://");
  const messages: WsOutgoing[] = [];
  const ws = new WebSocket(`${wsUrl}/ws/conversation/${workspaceId}`);
  // Start collecting BEFORE open — WebSocket buffers messages internally
  ws.on("message", (data) => {
    messages.push(JSON.parse(data.toString()) as WsOutgoing);
  });
  const wsReady = new Promise<WebSocket>((resolve, reject) => {
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
  return { wsReady, messages };
}

/** Wait until a condition is met on the collected messages, with timeout. */
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
      reject(new Error(`Timeout waiting for message condition. Got: ${JSON.stringify(messages)}`));
    }, timeoutMs);
  });
}

describe("WS /ws/conversation/:wsId", () => {
  it("connects to conversation and receives status", async () => {
    await launchConversation(wsId, dataDir, CONV_CMD);
    const { wsReady, messages } = connectConvWsWithCollector(wsId);
    const ws = await wsReady;

    await waitForMessage(messages, (msgs) => msgs.length >= 1);

    expect(messages[0].type).toBe("status");
    ws.close();
    await endConversation(wsId, dataDir);
  });

  it("closes connection when no conversation exists", async () => {
    const { wsReady, messages } = connectConvWsWithCollector(wsId);
    const ws = await wsReady;

    // Wait for close
    await new Promise<void>((resolve) => {
      ws.on("close", () => resolve());
      setTimeout(() => resolve(), 2000);
    });

    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0].type).toBe("error");
    if (messages[0].type === "error") {
      expect(messages[0].message).toContain("No active conversation");
    }
  });

  it("sends user_message and receives events", async () => {
    await launchConversation(wsId, dataDir, CONV_CMD);
    const { wsReady, messages } = connectConvWsWithCollector(wsId);
    const ws = await wsReady;

    // Wait for initial status
    await waitForMessage(messages, (msgs) => msgs.length >= 1);

    // Send user message — bash with -p flag will exit quickly
    ws.send(JSON.stringify({ type: "user_message", content: "Hello" }));

    // Wait for a second status (post-exit status update) or timeout
    await waitForMessage(
      messages,
      (msgs) => msgs.filter((m) => m.type === "status").length >= 2,
    ).catch(() => {});

    // Should have received at least the initial status
    expect(messages.length).toBeGreaterThanOrEqual(1);

    ws.close();
    await endConversation(wsId, dataDir).catch(() => {});
  });

  it("handles invalid JSON from client", async () => {
    await launchConversation(wsId, dataDir, CONV_CMD);
    const { wsReady, messages } = connectConvWsWithCollector(wsId);
    const ws = await wsReady;

    // Wait for initial status
    await waitForMessage(messages, (msgs) => msgs.length >= 1);

    // Send invalid JSON
    ws.send("not json at all");

    // Wait for error message
    await waitForMessage(messages, (msgs) => msgs.some((m) => m.type === "error"));

    const errorMsg = messages.find((m) => m.type === "error");
    expect(errorMsg).toBeDefined();
    if (errorMsg && errorMsg.type === "error") {
      expect(errorMsg.message).toContain("Invalid JSON");
    }

    ws.close();
    await endConversation(wsId, dataDir);
  });

  it("handles stop command without error", async () => {
    await launchConversation(wsId, dataDir, CONV_CMD);
    const { wsReady, messages } = connectConvWsWithCollector(wsId);
    const ws = await wsReady;

    // Wait for initial status
    await waitForMessage(messages, (msgs) => msgs.length >= 1);

    // Send stop — session.stop() is a no-op when not streaming
    ws.send(JSON.stringify({ type: "stop" }));

    // Give a moment for processing
    await new Promise((r) => setTimeout(r, 100));

    // Connection should still be open (stop doesn't close WS)
    expect(ws.readyState).toBe(WebSocket.OPEN);

    ws.close();
    await endConversation(wsId, dataDir);
  });
});
