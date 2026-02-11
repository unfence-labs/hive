import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { createTempDir, createFixtureRepo } from "../utils/test-helpers.js";
import { projectRoutes } from "./projects.js";

let tempDir: string;
let dataDir: string;
let fixtureRepoUrl: string;
let app: ReturnType<typeof Fastify>;

beforeEach(async () => {
  tempDir = await createTempDir("hive-api-proj-test-");
  dataDir = join(tempDir, "data");
  const fixtureDir = join(tempDir, "fixtures");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(dataDir, { recursive: true });
  await mkdir(fixtureDir, { recursive: true });
  fixtureRepoUrl = await createFixtureRepo(fixtureDir);

  app = Fastify();
  await app.register((instance: FastifyInstance) => projectRoutes(instance, dataDir));
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await rm(tempDir, { recursive: true, force: true });
});

describe("POST /api/projects", () => {
  it("creates a project and returns 201", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { url: fixtureRepoUrl },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toMatch(/^proj-/);
    expect(body.name).toBe("fixture");
  });

  it("returns 400 for missing url", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /api/projects", () => {
  it("returns empty array initially", async () => {
    const res = await app.inject({ method: "GET", url: "/api/projects" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it("returns created projects", async () => {
    await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { url: fixtureRepoUrl },
    });
    const res = await app.inject({ method: "GET", url: "/api/projects" });
    expect(res.json()).toHaveLength(1);
  });
});

describe("GET /api/projects/:id", () => {
  it("returns project details", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { url: fixtureRepoUrl },
    });
    const { id } = createRes.json();
    const res = await app.inject({ method: "GET", url: `/api/projects/${id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(id);
  });

  it("returns 404 for non-existent project", async () => {
    const res = await app.inject({ method: "GET", url: "/api/projects/nonexistent" });
    expect(res.statusCode).toBe(404);
  });
});

describe("DELETE /api/projects/:id", () => {
  it("deletes a project and returns 204", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { url: fixtureRepoUrl },
    });
    const { id } = createRes.json();
    const res = await app.inject({ method: "DELETE", url: `/api/projects/${id}` });
    expect(res.statusCode).toBe(204);

    const getRes = await app.inject({ method: "GET", url: `/api/projects/${id}` });
    expect(getRes.statusCode).toBe(404);
  });
});

describe("POST /api/projects/:id/fetch", () => {
  it("fetches successfully", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { url: fixtureRepoUrl },
    });
    const { id } = createRes.json();
    const res = await app.inject({ method: "POST", url: `/api/projects/${id}/fetch` });
    expect(res.statusCode).toBe(200);
  });

  it("returns 404 for non-existent project", async () => {
    const res = await app.inject({ method: "POST", url: "/api/projects/nonexistent/fetch" });
    expect(res.statusCode).toBe(404);
  });
});
