import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { brainRoutes } from "./brain.js";
import { createTempDir, createFixtureRepo } from "../utils/test-helpers.js";
import { brainRepoPath } from "../utils/paths.js";

let tempDir: string;
let dataDir: string;

beforeEach(async () => {
  tempDir = await createTempDir("hive-brain-api-test-");
  dataDir = join(tempDir, "data");
  await mkdir(dataDir, { recursive: true });
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

async function buildTestApp() {
  const app = Fastify();
  await app.register((instance) => brainRoutes(instance, dataDir));
  return app;
}

describe("brain routes", () => {
  it("GET /api/brain returns an empty state before setup", async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: "GET", url: "/api/brain" });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ exists: false });
  });

  it("POST /api/brain connects to an existing local origin", async () => {
    const fixtureDir = join(tempDir, "fixtures");
    await mkdir(fixtureDir, { recursive: true });
    const origin = await createFixtureRepo(fixtureDir);
    const app = await buildTestApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/brain",
      payload: { mode: "connect", url: origin },
    });
    await app.close();

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({
      exists: true,
      repoUrl: origin,
      createdAt: expect.any(String),
    });
    expect(existsSync(join(brainRepoPath(dataDir), ".git"))).toBe(true);
  });

  it("POST /api/brain returns 409 when a Brain already exists", async () => {
    const fixtureDir = join(tempDir, "fixtures");
    await mkdir(fixtureDir, { recursive: true });
    const origin = await createFixtureRepo(fixtureDir);
    const app = await buildTestApp();

    await app.inject({
      method: "POST",
      url: "/api/brain",
      payload: { mode: "connect", url: origin },
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/brain",
      payload: { mode: "connect", url: origin },
    });
    await app.close();

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("Brain already exists");
  });

  it("DELETE /api/brain removes state and clone", async () => {
    const fixtureDir = join(tempDir, "fixtures");
    await mkdir(fixtureDir, { recursive: true });
    const origin = await createFixtureRepo(fixtureDir);
    const app = await buildTestApp();

    await app.inject({
      method: "POST",
      url: "/api/brain",
      payload: { mode: "connect", url: origin },
    });
    expect(existsSync(brainRepoPath(dataDir))).toBe(true);

    const res = await app.inject({ method: "DELETE", url: "/api/brain" });
    const getRes = await app.inject({ method: "GET", url: "/api/brain" });
    await app.close();

    expect(res.statusCode).toBe(204);
    expect(existsSync(brainRepoPath(dataDir))).toBe(false);
    expect(getRes.json()).toEqual({ exists: false });
  });
});
