import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTempDir, createFixtureRepo } from "../utils/test-helpers.js";
import { projectRoutes } from "./projects.js";
import { workspaceRoutes } from "./workspaces.js";
import { sessionRoutes } from "./agents.js";
import { _clearActiveSessions } from "../agents/agent-manager.js";

const CONV_CMD = { command: "bash" };

let tempDir: string;
let dataDir: string;
let app: ReturnType<typeof Fastify>;
let projectId: string;
let wsId: string;

beforeEach(async () => {
  tempDir = await createTempDir("hive-api-session-test-");
  dataDir = join(tempDir, "data");
  const fixtureDir = join(tempDir, "fixtures");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(dataDir, { recursive: true });
  await mkdir(fixtureDir, { recursive: true });
  const fixtureRepoUrl = await createFixtureRepo(fixtureDir);

  app = Fastify();
  await app.register((instance: FastifyInstance) => projectRoutes(instance, dataDir));
  await app.register((instance: FastifyInstance) => workspaceRoutes(instance, dataDir));
  await app.register((instance: FastifyInstance) =>
    sessionRoutes(instance, { dataDir, sessionOptions: CONV_CMD }),
  );
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
  _clearActiveSessions();
  await new Promise((r) => setTimeout(r, 50));
  await app.close();
  await rm(tempDir, { recursive: true, force: true });
});

describe("POST /api/workspaces/:wsId/session", () => {
  it("creates a session and returns 201", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/workspaces/${wsId}/session`,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.sessionId).toBeTruthy();
    expect(body.workspaceId).toBe(wsId);
  });

  it("returns 200 for existing session", async () => {
    await app.inject({ method: "POST", url: `/api/workspaces/${wsId}/session` });

    const res = await app.inject({
      method: "POST",
      url: `/api/workspaces/${wsId}/session`,
    });
    expect(res.statusCode).toBe(200);
  });

  it("handles concurrent create calls when session already exists", async () => {
    const first = await app.inject({
      method: "POST",
      url: `/api/workspaces/${wsId}/session`,
    });
    expect(first.statusCode).toBe(201);
    const firstSessionId = first.json().sessionId;

    const [resA, resB] = await Promise.all([
      app.inject({ method: "POST", url: `/api/workspaces/${wsId}/session` }),
      app.inject({ method: "POST", url: `/api/workspaces/${wsId}/session` }),
    ]);

    expect(resA.statusCode).toBe(200);
    expect(resB.statusCode).toBe(200);
    expect(resA.json().sessionId).toBe(firstSessionId);
    expect(resB.json().sessionId).toBe(firstSessionId);
  });

  it("handles concurrent create calls on a fresh workspace", async () => {
    const [resA, resB] = await Promise.all([
      app.inject({ method: "POST", url: `/api/workspaces/${wsId}/session` }),
      app.inject({ method: "POST", url: `/api/workspaces/${wsId}/session` }),
    ]);

    const statuses = [resA.statusCode, resB.statusCode].sort();
    expect(statuses).toEqual([200, 201]);
    expect(resA.json().sessionId).toBe(resB.json().sessionId);
  });

  it("returns 404 for non-existent workspace", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/workspaces/nonexistent/session",
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /api/workspaces/:wsId/session", () => {
  it("returns session metadata when active", async () => {
    await app.inject({ method: "POST", url: `/api/workspaces/${wsId}/session` });

    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${wsId}/session`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().sessionId).toBeTruthy();
  });

  it("returns 404 when no session exists", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${wsId}/session`,
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /api/workspaces/:wsId/session/messages", () => {
  it("returns empty array for fresh session", async () => {
    await app.inject({ method: "POST", url: `/api/workspaces/${wsId}/session` });

    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${wsId}/session/messages`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it("returns empty array when no session exists", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${wsId}/session/messages`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it("returns persisted messages after ending a session", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: `/api/workspaces/${wsId}/session`,
    });
    const { sessionId } = createRes.json() as { sessionId: string };

    const sessionDir = join(dataDir, projectId, "sessions", sessionId);
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, "metadata.json"),
      JSON.stringify({
        sessionId,
        workspaceId: wsId,
        createdAt: "2026-02-11T00:00:00.000Z",
        updatedAt: "2026-02-11T00:00:01.000Z",
        messageCount: 1,
      }),
      "utf-8",
    );
    await writeFile(
      join(sessionDir, "messages.jsonl"),
      JSON.stringify({
        id: "m-1",
        sessionId,
        role: "user",
        content: "hello from disk",
        timestamp: "2026-02-11T00:00:00.000Z",
      }) + "\n",
      "utf-8",
    );

    await app.inject({ method: "DELETE", url: `/api/workspaces/${wsId}/session` });

    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${wsId}/session/messages`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      expect.objectContaining({
        content: "hello from disk",
        role: "user",
      }),
    ]);
  });

  it("returns 404 for non-existent workspace", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/workspaces/nonexistent/session/messages",
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("DELETE /api/workspaces/:wsId/session", () => {
  it("ends session and returns 204", async () => {
    await app.inject({ method: "POST", url: `/api/workspaces/${wsId}/session` });

    const res = await app.inject({
      method: "DELETE",
      url: `/api/workspaces/${wsId}/session`,
    });
    expect(res.statusCode).toBe(204);

    // Workspace should be idle again
    const wsRes = await app.inject({
      method: "GET",
      url: `/api/workspaces/${wsId}`,
    });
    expect(wsRes.json().status).toBe("idle");
  });

  it("returns 204 when no session exists", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/api/workspaces/${wsId}/session`,
    });
    expect(res.statusCode).toBe(204);
  });

  it("allows creating a new session after ending one", async () => {
    await app.inject({ method: "POST", url: `/api/workspaces/${wsId}/session` });
    await app.inject({ method: "DELETE", url: `/api/workspaces/${wsId}/session` });

    const res = await app.inject({
      method: "POST",
      url: `/api/workspaces/${wsId}/session`,
    });
    expect(res.statusCode).toBe(201);
  });
});
