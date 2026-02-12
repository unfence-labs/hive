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

async function writeSessionFixture(
  sessionId: string,
  workspaceId: string,
  options?: {
    updatedAt?: string;
    messageCount?: number;
    messages?: Array<Record<string, unknown> | string>;
  },
) {
  const sessionDir = join(dataDir, projectId, "sessions", sessionId);
  await mkdir(sessionDir, { recursive: true });
  await writeFile(
    join(sessionDir, "metadata.json"),
    JSON.stringify({
      sessionId,
      workspaceId,
      createdAt: "2026-02-11T00:00:00.000Z",
      updatedAt: options?.updatedAt ?? "2026-02-11T00:00:01.000Z",
      messageCount: options?.messageCount ?? 0,
    }),
    "utf-8",
  );

  if (options?.messages) {
    const content = options.messages
      .map((message) => typeof message === "string" ? message : JSON.stringify(message))
      .join("\n");
    await writeFile(join(sessionDir, "messages.jsonl"), content + "\n", "utf-8");
  }
}

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

describe("GET /api/workspaces/:wsId/sessions", () => {
  it("lists all sessions for a workspace", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: `/api/workspaces/${wsId}/session`,
    });
    const activeSessionId = createRes.json().sessionId as string;
    await writeSessionFixture("persisted-1", wsId, {
      updatedAt: "2099-02-12T00:00:00.000Z",
      messageCount: 2,
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${wsId}/sessions`,
    });

    expect(res.statusCode).toBe(200);
    const sessions = res.json() as Array<{ sessionId: string }>;
    expect(sessions.map((s) => s.sessionId)).toEqual([
      "persisted-1",
      activeSessionId,
    ]);
  });

  it("returns 404 for non-existent workspace", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/workspaces/missing/sessions",
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("POST /api/workspaces/:wsId/sessions", () => {
  it("creates a new session even when one is already active", async () => {
    const firstRes = await app.inject({
      method: "POST",
      url: `/api/workspaces/${wsId}/session`,
    });
    const firstSessionId = firstRes.json().sessionId as string;

    const secondRes = await app.inject({
      method: "POST",
      url: `/api/workspaces/${wsId}/sessions`,
    });

    expect(secondRes.statusCode).toBe(201);
    const secondSessionId = secondRes.json().sessionId as string;
    expect(secondSessionId).not.toBe(firstSessionId);

    const metaRes = await app.inject({
      method: "GET",
      url: `/api/workspaces/${wsId}/session`,
    });
    expect(metaRes.statusCode).toBe(200);
    expect(metaRes.json().sessionId).toBe(secondSessionId);
  });
});

describe("POST /api/workspaces/:wsId/sessions/:sessionId/activate", () => {
  it("activates a persisted session", async () => {
    await writeSessionFixture("sess-activate", wsId, { messageCount: 3 });

    const res = await app.inject({
      method: "POST",
      url: `/api/workspaces/${wsId}/sessions/sess-activate/activate`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      sessionId: "sess-activate",
      workspaceId: wsId,
      messageCount: 3,
    });

    const wsRes = await app.inject({
      method: "GET",
      url: `/api/workspaces/${wsId}`,
    });
    expect(wsRes.json()).toMatchObject({
      status: "busy",
      activeSessionId: "sess-activate",
    });
  });

  it("returns 404 for missing session id", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/workspaces/${wsId}/sessions/missing/activate`,
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("DELETE /api/workspaces/:wsId/sessions/:sessionId", () => {
  it("hard deletes an inactive session", async () => {
    await writeSessionFixture("sess-delete", wsId);

    const res = await app.inject({
      method: "DELETE",
      url: `/api/workspaces/${wsId}/sessions/sess-delete`,
    });

    expect(res.statusCode).toBe(204);

    const listRes = await app.inject({
      method: "GET",
      url: `/api/workspaces/${wsId}/sessions`,
    });
    expect(listRes.json()).toEqual([]);
  });

  it("hard deletes an active session and marks workspace idle", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: `/api/workspaces/${wsId}/session`,
    });
    const sessionId = createRes.json().sessionId as string;

    const res = await app.inject({
      method: "DELETE",
      url: `/api/workspaces/${wsId}/sessions/${sessionId}`,
    });
    expect(res.statusCode).toBe(204);

    const wsRes = await app.inject({
      method: "GET",
      url: `/api/workspaces/${wsId}`,
    });
    expect(wsRes.json().status).toBe("idle");
    expect(wsRes.json().activeSessionId).toBeUndefined();
  });
});

describe("GET /api/workspaces/:wsId/sessions/:sessionId/messages", () => {
  it("returns messages from a specific persisted session", async () => {
    await writeSessionFixture("sess-msgs", wsId, {
      messages: [
        {
          id: "m-1",
          sessionId: "sess-msgs",
          role: "user",
          content: "hello specific",
          timestamp: "2026-02-11T00:00:00.000Z",
        },
        "not-json-line",
        {
          id: "m-2",
          sessionId: "sess-msgs",
          role: "assistant",
          content: "response specific",
          timestamp: "2026-02-11T00:00:01.000Z",
        },
      ],
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${wsId}/sessions/sess-msgs/messages`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      expect.objectContaining({ id: "m-1", content: "hello specific", role: "user" }),
      expect.objectContaining({ id: "m-2", content: "response specific", role: "assistant" }),
    ]);
  });

  it("returns empty array when specific session file is missing", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${wsId}/sessions/missing/messages`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});
