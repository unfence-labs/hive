import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { createTempDir } from "../utils/test-helpers.js";
import { saveProject } from "../state/state.js";
import { projectEnvRoutes } from "./project-env.js";
import type { ProjectState } from "../types.js";

let tempDir: string;
let dataDir: string;
let app: ReturnType<typeof Fastify>;

const project: ProjectState = {
  id: "proj-1",
  name: "Alpha",
  url: "https://github.com/acme/alpha.git",
  createdAt: "2026-05-12T00:00:00.000Z",
  workspaces: [],
};

beforeEach(async () => {
  tempDir = await createTempDir("hive-project-env-api-test-");
  dataDir = join(tempDir, "data");
  await mkdir(dataDir, { recursive: true });
  await saveProject(project, dataDir);

  app = Fastify();
  await app.register((instance: FastifyInstance) => projectEnvRoutes(instance, dataDir));
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await rm(tempDir, { recursive: true, force: true });
});

describe("project environment routes", () => {
  it("returns not configured by default", async () => {
    const res = await app.inject({ method: "GET", url: "/api/projects/proj-1/env" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ exists: false, content: "" });
  });

  it("saves and returns project environment content", async () => {
    const put = await app.inject({
      method: "PUT",
      url: "/api/projects/proj-1/env",
      payload: { content: "API_KEY=secret\n" },
    });

    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({
      exists: true,
      content: "API_KEY=secret\n",
      sizeBytes: Buffer.byteLength("API_KEY=secret\n"),
    });

    const get = await app.inject({ method: "GET", url: "/api/projects/proj-1/env" });
    expect(get.json().content).toBe("API_KEY=secret\n");
  });

  it("deletes project environment content", async () => {
    await app.inject({
      method: "PUT",
      url: "/api/projects/proj-1/env",
      payload: { content: "API_KEY=secret\n" },
    });

    const del = await app.inject({ method: "DELETE", url: "/api/projects/proj-1/env" });
    expect(del.statusCode).toBe(204);

    const get = await app.inject({ method: "GET", url: "/api/projects/proj-1/env" });
    expect(get.json()).toEqual({ exists: false, content: "" });
  });

  it("returns 404 for unknown projects", async () => {
    const res = await app.inject({ method: "GET", url: "/api/projects/missing/env" });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Project not found" });
  });

  it("validates request content", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/projects/proj-1/env",
      payload: { content: 123 },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Content is required" });
  });
});
