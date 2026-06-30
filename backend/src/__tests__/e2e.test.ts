import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import type WebSocket from "ws";
import { rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createTempDir, createFixtureRepo } from "../utils/test-helpers.js";
import { projectRoutes } from "../api/projects.js";
import { workspaceRoutes } from "../api/workspaces.js";
import { sessionRoutes } from "../api/agents.js";
import { streamRoutes } from "../ws/stream.js";
import { _clearActiveSessions } from "../agents/agent-manager.js";
import type { WsOutgoing, HubOutgoing } from "../types.js";

const CONV_CMD = { command: "bash" };

let tempDir: string;
let dataDir: string;
let fixtureRepoUrl: string;
let app: ReturnType<typeof Fastify>;

beforeEach(async () => {
  tempDir = await createTempDir("hive-e2e-test-");
  dataDir = join(tempDir, "data");
  const fixtureDir = join(tempDir, "fixtures");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(dataDir, { recursive: true });
  await mkdir(fixtureDir, { recursive: true });
  fixtureRepoUrl = await createFixtureRepo(fixtureDir);

  app = Fastify();
  await app.register(websocket, { options: { maxPayload: 10 * 1024 * 1024 } });
  await app.register((instance: FastifyInstance) => projectRoutes(instance, dataDir));
  await app.register((instance: FastifyInstance) => workspaceRoutes(instance, dataDir));
  await app.register((instance: FastifyInstance) =>
    sessionRoutes(instance, { dataDir, sessionOptions: CONV_CMD }),
  );
  await app.register((instance: FastifyInstance) =>
    streamRoutes(instance, { dataDir, sessionOptions: CONV_CMD }),
  );

  app.get("/health", async () => ({ status: "ok" }));
  await app.ready();
});

afterEach(async () => {
  _clearActiveSessions();
  await new Promise((r) => setTimeout(r, 100));
  await app.close();
  await rm(tempDir, { recursive: true, force: true });
});

async function connectHub(
  workspaceId: string,
): Promise<{ ws: WebSocket; messages: WsOutgoing[]; send: (msg: unknown) => void }> {
  const messages: WsOutgoing[] = [];
  const ws = await app.injectWS("/ws/hub", {}, {
    onInit: (clientWs: WebSocket) => {
      clientWs.on("message", (data: Buffer) => {
        const envelope = JSON.parse(data.toString()) as HubOutgoing;
        if ("workspaceId" in envelope && envelope.workspaceId === workspaceId) {
          messages.push(envelope.event);
        }
      });
    },
  });
  ws.send(JSON.stringify({ type: "sync_workspaces", workspaceIds: [workspaceId] }));
  const send = (msg: unknown) => {
    ws.send(JSON.stringify({ workspaceId, event: msg }));
  };
  return { ws, messages, send };
}

describe("E2E: conversation-only lifecycle", () => {
  it("creates project -> workspace -> session -> WS connect -> end session -> workspace idle", async () => {
    // 1. Health check
    const healthRes = await app.inject({ method: "GET", url: "/health" });
    expect(healthRes.statusCode).toBe(200);

    // 2. Create project
    const projRes = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { url: fixtureRepoUrl },
    });
    expect(projRes.statusCode).toBe(201);
    const project = projRes.json();

    // 3. Create workspace
    const wsRes = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/workspaces`,
    });
    expect(wsRes.statusCode).toBe(201);
    const workspace = wsRes.json();
    expect(workspace.status).toBe("idle");

    // 4. Create session via REST
    const sessRes = await app.inject({
      method: "POST",
      url: `/api/workspaces/${workspace.id}/session`,
    });
    expect(sessRes.statusCode).toBe(201);
    const sessionMeta = sessRes.json();
    expect(sessionMeta.sessionId).toBeTruthy();

    // 5. Workspace should be busy
    const wsCheckRes = await app.inject({
      method: "GET",
      url: `/api/workspaces/${workspace.id}`,
    });
    expect(wsCheckRes.json().status).toBe("busy");

    // 6. Get session metadata
    const sessGetRes = await app.inject({
      method: "GET",
      url: `/api/workspaces/${workspace.id}/session`,
    });
    expect(sessGetRes.statusCode).toBe(200);
    expect(sessGetRes.json().sessionId).toBe(sessionMeta.sessionId);

    // 7. Connect WebSocket
    const { ws: wsClient, messages } = await connectHub(workspace.id);

    // Wait for initial status message
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (messages.length >= 1) {
          clearInterval(check);
          resolve();
        }
      }, 20);
      setTimeout(() => { clearInterval(check); resolve(); }, 2000);
    });

    expect(messages.length).toBeGreaterThanOrEqual(1);
    expect(messages[0].type).toBe("status");

    wsClient.close();

    // 8. End session
    const endRes = await app.inject({
      method: "DELETE",
      url: `/api/workspaces/${workspace.id}/session`,
    });
    expect(endRes.statusCode).toBe(204);

    // 9. Workspace should be idle
    const wsFinalRes = await app.inject({
      method: "GET",
      url: `/api/workspaces/${workspace.id}`,
    });
    expect(wsFinalRes.json().status).toBe("idle");

    // 10. Session should be gone
    const sessGoneRes = await app.inject({
      method: "GET",
      url: `/api/workspaces/${workspace.id}/session`,
    });
    expect(sessGoneRes.statusCode).toBe(404);

    // 11. Can create a new session
    const sessRes2 = await app.inject({
      method: "POST",
      url: `/api/workspaces/${workspace.id}/session`,
    });
    expect(sessRes2.statusCode).toBe(201);
  }, 15000);

  it("WS auto-creates session on user_message when no session exists", async () => {
    // Create project and workspace
    const projRes = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { url: fixtureRepoUrl },
    });
    const project = projRes.json();
    const wsRes = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/workspaces`,
    });
    const workspace = wsRes.json();

    // Connect WS directly (no session created yet)
    const { ws: wsClient, messages, send } = await connectHub(workspace.id);


    // Should get initial idle status
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (messages.length >= 1) { clearInterval(check); resolve(); }
      }, 20);
      setTimeout(() => { clearInterval(check); resolve(); }, 2000);
    });

    expect(messages[0]).toEqual({ type: "status", status: "idle", streaming: false });

    // Send a message — should auto-create session
    send({ type: "user_message", content: "Hello" });

    // Wait for status with sessionId
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (messages.some((m) => m.type === "status" && "sessionId" in m && m.sessionId)) {
          clearInterval(check);
          resolve();
        }
      }, 20);
      setTimeout(() => { clearInterval(check); resolve(); }, 3000);
    });

    const statusWithSession = messages.find(
      (m) => m.type === "status" && "sessionId" in m && m.sessionId,
    );
    expect(statusWithSession).toBeDefined();

    // Workspace should now be busy
    const wsCheckRes = await app.inject({
      method: "GET",
      url: `/api/workspaces/${workspace.id}`,
    });
    expect(wsCheckRes.json().status).toBe("busy");

    wsClient.close();
    await _clearActiveSessions();
  }, 15000);

  it("WS receives idle status after endSession via HTTP DELETE", async () => {
    const projRes = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { url: fixtureRepoUrl },
    });
    const project = projRes.json();
    const wsRes = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/workspaces`,
    });
    const workspace = wsRes.json();

    // Create session via REST so the workspace becomes busy
    await app.inject({
      method: "POST",
      url: `/api/workspaces/${workspace.id}/session`,
    });

    // Connect WS
    const { ws: wsClient, messages } = await connectHub(workspace.id);


    // Wait for initial status from existing, non-streaming session
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (messages.length >= 1) { clearInterval(check); resolve(); }
      }, 20);
      setTimeout(() => { clearInterval(check); resolve(); }, 2000);
    });
    expect(messages[0]).toMatchObject({ type: "status", status: "idle" });

    // End session via HTTP DELETE
    const endRes = await app.inject({
      method: "DELETE",
      url: `/api/workspaces/${workspace.id}/session`,
    });
    expect(endRes.statusCode).toBe(204);

    // Wait for WS to receive idle status
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (messages.some((m) => m.type === "status" && m.status === "idle")) {
          clearInterval(check);
          resolve();
        }
      }, 20);
      setTimeout(() => { clearInterval(check); resolve(); }, 3000);
    });

    const idleMsg = messages.find((m) => m.type === "status" && m.status === "idle");
    expect(idleMsg).toMatchObject({ type: "status", status: "idle", streaming: false });

    wsClient.close();
  }, 15000);

  it("diff and merge still work with conversation-only mode", async () => {
    // Setup project + workspace
    const projRes = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { url: fixtureRepoUrl },
    });
    const project = projRes.json();
    const wsRes = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/workspaces`,
    });
    const workspace = wsRes.json();

    // Make changes manually (simulating agent work)
    const { writeFile } = await import("node:fs/promises");
    const { git } = await import("../utils/git.js");
    const wsPath = join(dataDir, project.id, "workspaces", workspace.name);
    await writeFile(join(wsPath, "refactored.ts"), "export const auth = true;\n");
    await git(["add", "."], wsPath);
    await git(["config", "user.email", "test@hive.dev"], wsPath);
    await git(["config", "user.name", "Test Agent"], wsPath);
    await git(["commit", "-m", "refactor auth module"], wsPath);

    // Diff should show changes
    const diffRes = await app.inject({
      method: "GET",
      url: `/api/workspaces/${workspace.id}/diff`,
    });
    expect(diffRes.json().diff).toContain("refactored.ts");

    // Merge
    const mergeRes = await app.inject({
      method: "POST",
      url: `/api/workspaces/${workspace.id}/merge`,
    });
    expect(mergeRes.statusCode).toBe(200);

    // Workspace should be gone
    const wsGoneRes = await app.inject({
      method: "GET",
      url: `/api/workspaces/${workspace.id}`,
    });
    expect(wsGoneRes.statusCode).toBe(404);

    // Verify changes on main via new workspace
    const newWsRes = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/workspaces`,
    });
    const newWs = newWsRes.json();
    const newWsPath = join(dataDir, project.id, "workspaces", newWs.name);
    expect(existsSync(join(newWsPath, "refactored.ts"))).toBe(true);
  }, 15000);
});
