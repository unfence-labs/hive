import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createTempDir, createFixtureRepo } from "../utils/test-helpers.js";
import { brainRoutes } from "./brain.js";
import { sessionRoutes } from "./agents.js";
import { connectBrain } from "../brain/brain-repo.js";
import { _clearBrainSessions } from "../agents/brain-manager.js";

const CONV_CMD = { command: "bash" };

let tempDir: string;
let dataDir: string;
let app: ReturnType<typeof Fastify>;

beforeEach(async () => {
  tempDir = await createTempDir("hive-api-brain-session-test-");
  dataDir = join(tempDir, "data");
  await mkdir(dataDir, { recursive: true });

  app = Fastify();
  await app.register((instance: FastifyInstance) => brainRoutes(instance, dataDir));
  await app.register((instance: FastifyInstance) =>
    sessionRoutes(instance, { dataDir, sessionOptions: CONV_CMD }),
  );
  await app.ready();
});

afterEach(async () => {
  _clearBrainSessions();
  await new Promise((r) => setTimeout(r, 50));
  await app.close();
  await rm(tempDir, { recursive: true, force: true });
});

async function connectFixtureBrain(): Promise<void> {
  const fixtureDir = join(tempDir, "fixtures");
  await mkdir(fixtureDir, { recursive: true });
  const origin = await createFixtureRepo(fixtureDir);
  await connectBrain(origin, dataDir);
}

describe("brain session routes via /api/workspaces/brain/*", () => {
  it("returns 409 when the Brain is not connected", async () => {
    const res = await app.inject({ method: "GET", url: "/api/workspaces/brain/sessions" });
    expect(res.statusCode).toBe(409);
  });

  it("lists, creates, and deletes Brain sessions", async () => {
    await connectFixtureBrain();

    const empty = await app.inject({ method: "GET", url: "/api/workspaces/brain/sessions" });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual([]);

    const created = await app.inject({ method: "POST", url: "/api/workspaces/brain/sessions" });
    expect(created.statusCode).toBe(201);
    const sessionId = created.json().sessionId as string;
    expect(created.json().workspaceId).toBe("brain");

    const listed = await app.inject({ method: "GET", url: "/api/workspaces/brain/sessions" });
    expect(listed.json()).toHaveLength(1);

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/workspaces/brain/sessions/${sessionId}`,
    });
    expect(deleted.statusCode).toBe(204);

    const after = await app.inject({ method: "GET", url: "/api/workspaces/brain/sessions" });
    expect(after.json()).toEqual([]);
  });
});
