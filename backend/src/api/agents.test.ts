import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { createTempDir, createFixtureRepo } from "../utils/test-helpers.js";
import { projectRoutes } from "./projects.js";
import { workspaceRoutes } from "./workspaces.js";
import { agentRoutes } from "./agents.js";
import {
  _clearActiveAgents,
  _clearActiveConversations,
  getActiveProcess,
} from "../agents/agent-manager.js";

const MOCK_CMD = { command: "echo", args: ["agent output"] };
const SLOW_CMD = { command: "sleep", args: ["30"] };

let tempDir: string;
let dataDir: string;
let app: ReturnType<typeof Fastify>;
let projectId: string;
let wsId: string;

function waitForAgent(agentId: string): Promise<void> {
  return new Promise((resolve) => {
    const proc = getActiveProcess(agentId);
    if (!proc || proc.status !== "running") return resolve();
    proc.on("exit", () => resolve());
    proc.on("error", () => resolve());
  });
}

beforeEach(async () => {
  tempDir = await createTempDir("hive-api-agent-test-");
  dataDir = join(tempDir, "data");
  const fixtureDir = join(tempDir, "fixtures");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(dataDir, { recursive: true });
  await mkdir(fixtureDir, { recursive: true });
  const fixtureRepoUrl = await createFixtureRepo(fixtureDir);

  app = Fastify();
  await app.register((instance: FastifyInstance) => projectRoutes(instance, dataDir));
  await app.register((instance: FastifyInstance) => workspaceRoutes(instance, dataDir));
  await app.register((instance: FastifyInstance) => agentRoutes(instance, { dataDir, launchOptions: MOCK_CMD }));
  await app.ready();

  const projRes = await app.inject({
    method: "POST",
    url: "/api/projects",
    payload: { url: fixtureRepoUrl },
  });
  projectId = projRes.json().id;

  const wsRes = await app.inject({
    method: "POST",
    url: `/api/projects/${projectId}/workspaces`,
  });
  wsId = wsRes.json().id;
});

afterEach(async () => {
  _clearActiveAgents();
  _clearActiveConversations();
  await new Promise((r) => setTimeout(r, 50));
  await app.close();
  await rm(tempDir, { recursive: true, force: true });
});

describe("POST /api/workspaces/:wsId/agents", () => {
  it("launches agent and returns 201", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/workspaces/${wsId}/agents`,
      payload: { prompt: "do something" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toMatch(/^agent-/);
    expect(body.status).toBe("running");

    await waitForAgent(body.id);
  });

  it("returns 400 for missing prompt", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/workspaces/${wsId}/agents`,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 409 when workspace is busy", async () => {
    // Register a separate app instance with slow command to keep agent running
    const slowApp = Fastify();
    await slowApp.register((instance: FastifyInstance) => projectRoutes(instance, dataDir));
    await slowApp.register((instance: FastifyInstance) => workspaceRoutes(instance, dataDir));
    await slowApp.register((instance: FastifyInstance) =>
      agentRoutes(instance, { dataDir, launchOptions: SLOW_CMD })
    );
    await slowApp.ready();

    // Launch a slow agent
    const res1 = await slowApp.inject({
      method: "POST",
      url: `/api/workspaces/${wsId}/agents`,
      payload: { prompt: "slow task" },
    });
    expect(res1.statusCode).toBe(201);

    // Try launching another
    const res2 = await slowApp.inject({
      method: "POST",
      url: `/api/workspaces/${wsId}/agents`,
      payload: { prompt: "second task" },
    });
    expect(res2.statusCode).toBe(409);

    _clearActiveAgents();
    await slowApp.close();
  });

  it("returns 404 for non-existent workspace", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/workspaces/nonexistent/agents",
      payload: { prompt: "test" },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /api/workspaces/:wsId/agents", () => {
  it("returns agent history", async () => {
    const launchRes = await app.inject({
      method: "POST",
      url: `/api/workspaces/${wsId}/agents`,
      payload: { prompt: "history test" },
    });
    await waitForAgent(launchRes.json().id);

    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${wsId}/agents`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    expect(res.json()[0].prompt).toBe("history test");
  });
});

describe("GET /api/agents/:agentId", () => {
  it("returns agent details", async () => {
    const launchRes = await app.inject({
      method: "POST",
      url: `/api/workspaces/${wsId}/agents`,
      payload: { prompt: "detail test" },
    });
    const agentId = launchRes.json().id;
    await waitForAgent(agentId);

    const res = await app.inject({ method: "GET", url: `/api/agents/${agentId}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().prompt).toBe("detail test");
  });

  it("returns 404 for non-existent agent", async () => {
    const res = await app.inject({ method: "GET", url: "/api/agents/nonexistent" });
    expect(res.statusCode).toBe(404);
  });
});

// ── Conversation routes ──────────────────────────────────────────────

describe("POST /api/workspaces/:wsId/conversation", () => {
  it("creates a conversation session and returns 201", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/workspaces/${wsId}/conversation`,
      payload: {},
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.sessionId).toBeTruthy();
    expect(body.status).toBe("idle");
    expect(body.messages).toEqual([]);
  });

  it("accepts optional sessionId", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/workspaces/${wsId}/conversation`,
      payload: { sessionId: "custom-session-123" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().sessionId).toBe("custom-session-123");
  });

  it("returns 409 when workspace already has a conversation", async () => {
    const res1 = await app.inject({
      method: "POST",
      url: `/api/workspaces/${wsId}/conversation`,
      payload: {},
    });
    expect(res1.statusCode).toBe(201);

    const res2 = await app.inject({
      method: "POST",
      url: `/api/workspaces/${wsId}/conversation`,
      payload: {},
    });
    expect(res2.statusCode).toBe(409);
  });

  it("returns 404 for non-existent workspace", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/workspaces/nonexistent/conversation",
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /api/workspaces/:wsId/conversation", () => {
  it("returns conversation state when session is active", async () => {
    await app.inject({
      method: "POST",
      url: `/api/workspaces/${wsId}/conversation`,
      payload: {},
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${wsId}/conversation`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.sessionId).toBeTruthy();
    expect(body.status).toBe("idle");
    expect(body.messages).toEqual([]);
  });

  it("returns 404 when no conversation is active", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${wsId}/conversation`,
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /api/workspaces/:wsId/conversation/messages", () => {
  it("returns empty messages array for active session", async () => {
    await app.inject({
      method: "POST",
      url: `/api/workspaces/${wsId}/conversation`,
      payload: {},
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${wsId}/conversation/messages`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it("returns 404 when no conversation is active", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${wsId}/conversation/messages`,
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("DELETE /api/workspaces/:wsId/conversation", () => {
  it("ends conversation and returns 204", async () => {
    await app.inject({
      method: "POST",
      url: `/api/workspaces/${wsId}/conversation`,
      payload: {},
    });

    const res = await app.inject({
      method: "DELETE",
      url: `/api/workspaces/${wsId}/conversation`,
    });
    expect(res.statusCode).toBe(204);

    // Workspace should be idle again
    const wsRes = await app.inject({
      method: "GET",
      url: `/api/workspaces/${wsId}`,
    });
    expect(wsRes.json().status).toBe("idle");
  });

  it("returns 404 when no conversation is active", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/api/workspaces/${wsId}/conversation`,
    });
    expect(res.statusCode).toBe(404);
  });

  it("allows starting a new conversation after ending one", async () => {
    // Start first conversation
    const res1 = await app.inject({
      method: "POST",
      url: `/api/workspaces/${wsId}/conversation`,
      payload: {},
    });
    expect(res1.statusCode).toBe(201);

    // End it
    await app.inject({
      method: "DELETE",
      url: `/api/workspaces/${wsId}/conversation`,
    });

    // Start second conversation
    const res2 = await app.inject({
      method: "POST",
      url: `/api/workspaces/${wsId}/conversation`,
      payload: {},
    });
    expect(res2.statusCode).toBe(201);
  });
});
